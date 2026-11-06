/**
 * Agent loop: model -> tool calls -> results until a text answer, with caps on
 * iterations (CA1) and tokens, a visible tool trail (CA4), server-enforced
 * human confirmation (CA3) and graceful errors (CA5).
 */
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { config, PROJECT_ROOT, rutas } from "../config.js"
import { LlmError } from "../llm/adapter.js"
import type { LlmAdapter, LlmMessage } from "../llm/adapter.js"
import type { Registry } from "../tools/registry.js"
import type { ApiError, ChatResponse, ToolCallView } from "../types.js"
import { contextoParaLlamada, esConfirmacion } from "./confirmacion.js"
import { cargarSystemPrompt } from "./prompt-loader.js"
import { getSession } from "./session.js"

export type LoopDeps = {
  llm: LlmAdapter
  registry: Registry
  /** Overridable for tests; defaults to reading the Markdown files. */
  cargarPrompt?: () => Promise<string>
  directory?: string
}

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** One-line Spanish summary of a tool result, for the chat and the log. */
function resumir(nombre: string, resultado: unknown): { ok: boolean; resumen: string } {
  if (!esObj(resultado) || typeof resultado.ok !== "boolean") return { ok: false, resumen: "Respuesta de herramienta no reconocida" }
  if (!resultado.ok) {
    const e = esObj(resultado.error) ? resultado.error : {}
    const msg = typeof e.mensaje === "string" ? e.mensaje : "Error en la herramienta"
    return { ok: false, resumen: typeof e.codigo === "string" ? `${e.codigo}: ${msg}` : msg }
  }
  const d = esObj(resultado.data) ? resultado.data : {}
  if (nombre === "oc_validar") {
    const bl = Array.isArray(d.bloqueos) ? d.bloqueos : []
    const co = Array.isArray(d.confirmaciones) ? d.confirmaciones : []
    const cod = bl.map((b) => (esObj(b) ? (b.codigo ?? b.regla ?? b.id) : b)).filter((x): x is string => typeof x === "string")
    return {
      ok: true,
      resumen: `apta=${String(d.apta)} · ${bl.length} bloqueo${bl.length === 1 ? "" : "s"}${cod.length ? ` (${cod.join(", ")})` : ""} · ${co.length} confirmación${co.length === 1 ? "" : "es"}`,
    }
  }
  if (nombre === "oc_crear") {
    return { ok: true, resumen: `OC ${String(d.numero_oc ?? "?")} creada${d.idempotente === true ? " (ya existía)" : ""}` }
  }
  if (nombre === "oc_generar_evidencia" && typeof d.ruta === "string") return { ok: true, resumen: `Evidencia en ${d.ruta}` }
  if (nombre === "oc_leer_paquete") return { ok: true, resumen: "Paquete leído" }
  if (nombre === "oc_construir_payload") return { ok: true, resumen: "Payload construido" }
  return { ok: true, resumen: "OK" }
}

async function registrarLog(directory: string, entrada: Obj): Promise<void> {
  try {
    const f = rutas(directory).logJsonl
    await mkdir(path.dirname(f), { recursive: true })
    await appendFile(f, JSON.stringify(entrada) + "\n", "utf8")
  } catch {
    // A logging failure must never break the chat.
  }
}

function mensajeError(e: unknown): ApiError {
  if (e instanceof LlmError) return { codigo: e.codigo, mensaje: e.message }
  return { codigo: "INTERNO", mensaje: "Ocurrió un error inesperado en el servidor. Puedes reintentar; tu sesión sigue activa." }
}

const INSTRUCCION_CIERRE =
  "Se alcanzó el tope de pasos de este turno. No llames más herramientas: resume en español lo que ya lograste y lo que falta por hacer, usando solo datos obtenidos de las herramientas."

/** Processes one user message and returns what the UI needs. Never throws. */
export async function procesarMensaje(sessionId: string, message: string, deps: LoopDeps): Promise<ChatResponse> {
  const directory = deps.directory ?? PROJECT_ROOT
  const session = getSession(sessionId)
  const pendienteAntes = session.pendiente
  const usuarioConfirma = pendienteAntes !== null && esConfirmacion(message)
  session.pendiente = null // any message resolves the previous pending state

  const ts = () => new Date().toISOString()
  session.history.push({ role: "user", content: message })
  session.mensajes.push({ rol: "user", texto: message, ts: ts() })

  const toolCalls: ToolCallView[] = []
  const porConfirmar = new Set<string>() // casos validated apta with confirmaciones, not yet created
  let error: ApiError | undefined
  let reply = ""

  const terminar = (): ChatResponse => {
    const needsConfirmation = porConfirmar.size > 0
    if (needsConfirmation) session.pendiente = { caso: [...porConfirmar].at(-1) as string }
    session.mensajes.push({
      rol: "assistant",
      texto: reply,
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(needsConfirmation ? { needsConfirmation } : {}),
      ...(error ? { error } : {}),
      ts: ts(),
    })
    return { reply, toolCalls, needsConfirmation, ...(error ? { error } : {}) }
  }

  try {
    const system: LlmMessage = { role: "system", content: await (deps.cargarPrompt ?? (() => cargarSystemPrompt(directory)))() }
    const llamar = async (extra: LlmMessage[], conTools: boolean) => {
      if (session.tokensUsados >= config.MAX_TOKENS_PER_SESSION) {
        throw Object.assign(new Error("tokens"), { limiteTokens: true })
      }
      const r = await deps.llm.enviar([system, ...session.history, ...extra], conTools ? deps.registry.specs : [])
      session.tokensUsados += r.uso.entrada + r.uso.salida
      return r
    }

    let texto: string | null = null
    for (let ronda = 0; ronda <= config.MAX_ITERATIONS_PER_TURN; ronda++) {
      if (ronda === config.MAX_ITERATIONS_PER_TURN) {
        const r = await llamar([{ role: "user", content: INSTRUCCION_CIERRE }], false)
        texto = r.texto ?? "Alcancé el tope de pasos de este turno. Dime cómo continuar."
        break
      }
      const r = await llamar([], true)
      if (r.toolCalls.length === 0) {
        texto = r.texto ?? ""
        break
      }
      const resultados: LlmMessage[] = []
      for (const tc of r.toolCalls) {
        const inicio = Date.now()
        const args = parseJson(tc.argumentos)
        const ctx = contextoParaLlamada({ directory, sessionId }, pendienteAntes, usuarioConfirma, args)
        const raw = await deps.registry.ejecutar(tc.name, tc.argumentos, ctx)
        const duracion_ms = Date.now() - inicio
        const resultado = parseJson(raw) ?? { ok: false, error: { codigo: "RESULTADO_INVALIDO", mensaje: "Resultado no es JSON" } }
        const { ok, resumen } = resumir(tc.name, resultado)
        toolCalls.push({ id: tc.id, nombre: tc.name, argumentos: args ?? tc.argumentos, ok, resumen, resultado, duracion_ms })
        await registrarLog(directory, { ts: ts(), sessionId, tool: tc.name, args: args ?? tc.argumentos, ok, resumen, duracion_ms })

        const caso = esObj(args) && typeof args.caso === "string" ? args.caso : undefined
        if (caso && esObj(resultado)) {
          const d = esObj(resultado.data) ? resultado.data : {}
          const e = esObj(resultado.error) ? resultado.error : {}
          if (tc.name === "oc_validar" && ok && d.apta === true && Array.isArray(d.confirmaciones) && d.confirmaciones.length > 0) porConfirmar.add(caso)
          else if (tc.name === "oc_crear" && ok) porConfirmar.delete(caso)
          else if (tc.name === "oc_crear" && e.codigo === "CONFIRMACION_REQUERIDA") porConfirmar.add(caso)
        }
        resultados.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: raw })
      }
      // Assistant tool_calls and all their results are appended together so history never dangles.
      session.history.push({ role: "assistant", content: r.texto, toolCalls: r.toolCalls }, ...resultados)
    }
    reply = texto ?? ""
    session.history.push({ role: "assistant", content: reply })
  } catch (e) {
    if (e instanceof Error && "limiteTokens" in e) {
      error = { codigo: "LIMITE_TOKENS", mensaje: "Esta sesión alcanzó el límite de uso de la conversación. Inicia una sesión nueva para continuar." }
    } else {
      error = mensajeError(e)
    }
    reply = error.mensaje
  }
  return terminar()
}
