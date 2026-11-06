/**
 * Verifies the purchase-order tools without any LLM or API key (PRD §6.6).
 * It calls the tools directly, in the order the agent would, so a regression in
 * the controls, the payload hash or the SAP mock shows up here before the chat is
 * involved. Exit code 1 means an expected outcome (PRD §3.1, PLAN §4) was not met.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { PROJECT_ROOT, rutas } from "./src/config.js"
import { leer_paquete, validar, construir_payload, generar_evidencia, crear } from "./src/tools/oc.js"
import type {
  ConstruirPayloadData,
  CrearData,
  Derivado,
  GenerarEvidenciaData,
  Hallazgo,
  OrdenCompra,
  ResultadoValidacion,
  ToolContext,
  ToolResult,
} from "./src/types.js"

type Esperado = "creada" | "bloqueada" | "confirmada"
type Obtenido = Esperado | "error"

/** PRD §3.1 / PLAN §4: the outcome each fixture must produce. */
const ESPERADO: Record<string, Esperado> = {
  "sol-001": "creada",
  "sol-002": "bloqueada",
  "sol-003": "bloqueada",
  "sol-004": "confirmada",
  "sol-005": "confirmada",
  "sol-006": "confirmada",
}

type Resumen = { caso: string; resultado: string; oc: string; retro: boolean; obtenido: Obtenido }

const ctx: ToolContext = { directory: PROJECT_ROOT, sessionId: "demo" }
/** Only the demo (standing in for the analyst) may set this; the model cannot. */
const ctxHumano: ToolContext = { ...ctx, confirmacionHumana: true }

const fallos: string[] = []

/**
 * Parses a tool's JSON envelope. The tools never throw, so a malformed envelope
 * is a bug in the contract and is reported loudly rather than guessed at.
 */
function resultado<T = unknown>(texto: string): ToolResult<T> {
  const crudo: unknown = JSON.parse(texto)
  if (typeof crudo !== "object" || crudo === null || !("ok" in crudo)) {
    throw new Error(`Respuesta de herramienta malformada: ${texto.slice(0, 120)}`)
  }
  return crudo as ToolResult<T>
}

function fallaTecnica(caso: string, detalle: string): Resumen {
  console.log(`  ✗ ${detalle}`)
  fallos.push(`${caso}: ${detalle}`)
  return { caso, resultado: "error técnico", oc: "—", retro: false, obtenido: "error" }
}

function imprimirHallazgo(h: Hallazgo): void {
  console.log(`    - ${h.codigo} (${h.regla}): ${h.detalle}`)
  console.log(`      acción: ${h.accion_sugerida}`)
  if (h.valores) console.log(`      valores: ${JSON.stringify(h.valores)}`)
}

function imprimirValidacion(v: ResultadoValidacion): void {
  console.log(`  apta: ${v.apta ? "sí" : "no"}`)
  if (v.bloqueos.length === 0) console.log("  bloqueos: ninguno")
  else {
    console.log("  bloqueos:")
    v.bloqueos.forEach(imprimirHallazgo)
  }
  if (v.confirmaciones.length === 0) console.log("  confirmaciones: ninguna")
  else {
    console.log("  confirmaciones:")
    v.confirmaciones.forEach(imprimirHallazgo)
  }
  const derivados = [v.derivados.indicador_iva, v.derivados.condiciones_pago].filter(
    (d): d is Derivado => d !== undefined,
  )
  if (derivados.length === 0) console.log("  derivados: ninguno")
  else {
    console.log("  derivados:")
    for (const d of derivados) console.log(`    - ${d.regla} ${d.valor} (${d.fuente}): ${d.detalle}`)
  }
  console.log(`  retroactiva: ${v.retroactiva ? "sí" : "no"}`)
}

/** Runs the full pipeline for one case; `sol-004`-style confirmations are answered by the simulated analyst. */
async function procesarCaso(
  caso: string,
  payloads: Map<string, OrdenCompra>,
  evidencias: string[],
): Promise<Resumen> {
  console.log(`\n== ${caso} ==`)

  const paquete = resultado(await leer_paquete.execute({ caso }, ctx))
  if (!paquete.ok) return fallaTecnica(caso, `leer_paquete: ${paquete.error.codigo} — ${paquete.error.mensaje}`)

  const val = resultado<ResultadoValidacion>(await validar.execute({ caso }, ctx))
  if (!val.ok) return fallaTecnica(caso, `validar: ${val.error.codigo} — ${val.error.mensaje}`)
  const v = val.data
  imprimirValidacion(v)

  if (!v.apta) {
    const codigos = v.bloqueos.map((b) => b.codigo).join(", ")
    console.log(`  → sin OC: BLOQUEADO (${codigos}); no se construye payload`)
    return { caso, resultado: `bloqueada (${codigos})`, oc: "—", retro: v.retroactiva, obtenido: "bloqueada" }
  }

  const cp = resultado<ConstruirPayloadData>(await construir_payload.execute({ caso }, ctx))
  if (!cp.ok) return fallaTecnica(caso, `construir_payload: ${cp.error.codigo} — ${cp.error.mensaje}`)
  const payload = cp.data.payload
  payloads.set(caso, payload)

  const ev = resultado<GenerarEvidenciaData>(await generar_evidencia.execute({ caso }, ctx))
  if (!ev.ok) return fallaTecnica(caso, `generar_evidencia: ${ev.error.codigo} — ${ev.error.mensaje}`)
  console.log(`  evidencia: ${ev.data.ruta}${ev.data.ruta_pdf ? `, ${ev.data.ruta_pdf}` : ""}`)
  evidencias.push(ev.data.ruta, ...(ev.data.ruta_pdf ? [ev.data.ruta_pdf] : []))

  const primero = resultado<CrearData>(await crear.execute({ caso, payload }, ctx))
  if (primero.ok) {
    console.log(`  → OC ${primero.data.numero_oc}`)
    console.log(`  ruta_evidencia: ${JSON.stringify(primero.data.ruta_evidencia)}`)
    return { caso, resultado: "creada", oc: primero.data.numero_oc, retro: v.retroactiva, obtenido: "creada" }
  }
  if (primero.error.codigo !== "CONFIRMACION_REQUERIDA") {
    return fallaTecnica(caso, `crear: ${primero.error.codigo} — ${primero.error.mensaje}`)
  }

  console.log(`  crear (sin confirmación): ${primero.error.codigo} — ${primero.error.mensaje}`)
  console.log("  → requiere confirmación humana")
  console.log("  [analista] Confirmo")
  const segundo = resultado<CrearData>(await crear.execute({ caso, payload, confirmado: true }, ctxHumano))
  if (!segundo.ok) return fallaTecnica(caso, `crear (confirmado): ${segundo.error.codigo} — ${segundo.error.mensaje}`)
  console.log(`  → OC ${segundo.data.numero_oc} (creada tras confirmación humana)`)
  console.log(`  ruta_evidencia: ${JSON.stringify(segundo.data.ruta_evidencia)}`)
  return {
    caso,
    resultado: "creada tras confirmación",
    oc: segundo.data.numero_oc,
    retro: v.retroactiva,
    obtenido: "confirmada",
  }
}

function comprobar(cumple: boolean, mensaje: string): void {
  if (!cumple) fallos.push(mensaje)
}

function imprimirTabla(filas: Resumen[]): void {
  const cabecera = ["caso", "resultado", "OC", "retroactiva"]
  const cuerpo = filas.map((r) => [r.caso, r.resultado, r.oc, r.retro ? "sí" : "no"])
  const anchos = cabecera.map((c, i) => Math.max(c.length, ...cuerpo.map((f) => (f[i] ?? "").length)))
  const linea = (celdas: string[]) => celdas.map((c, i) => c.padEnd(anchos[i] ?? 0)).join(" | ").trimEnd()
  console.log(linea(cabecera))
  console.log(anchos.map((a) => "-".repeat(a)).join("-+-"))
  cuerpo.forEach((f) => console.log(linea(f)))
}

async function main(): Promise<void> {
  const ruta = rutas(PROJECT_ROOT)
  await fs.rm(ruta.out, { recursive: true, force: true })

  const casos = (await fs.readdir(ruta.solicitudes, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const payloads = new Map<string, OrdenCompra>()
  const evidencias: string[] = []
  const resumen: Resumen[] = []

  for (const caso of casos) {
    const r = await procesarCaso(caso, payloads, evidencias)
    resumen.push(r)
    const esperado = ESPERADO[caso]
    if (esperado === undefined) fallos.push(`${caso}: caso sin resultado esperado definido`)
    else if (r.obtenido !== "error") comprobar(r.obtenido === esperado, `${caso}: esperado ${esperado}, obtenido ${r.obtenido}`)
    if (caso === "sol-005") comprobar(r.retro, "sol-005: retroactiva debe ser true")
  }

  // Idempotency: the same sol-001 request must return the same number, flagged as idempotente.
  console.log("\n== Idempotencia (sol-001 por segunda vez) ==")
  const oc1 = resumen.find((r) => r.caso === "sol-001")?.oc
  const payload1 = payloads.get("sol-001")
  if (oc1 === undefined || payload1 === undefined) fallos.push("idempotencia: sol-001 no quedó creada")
  else {
    const r = resultado<CrearData>(await crear.execute({ caso: "sol-001", payload: payload1 }, ctx))
    if (!r.ok) fallos.push(`idempotencia: ${r.error.codigo} — ${r.error.mensaje}`)
    else {
      console.log(`  → OC ${r.data.numero_oc} · idempotente: ${r.data.idempotente}`)
      console.log(`  ruta_evidencia: ${JSON.stringify(r.data.ruta_evidencia)}`)
      comprobar(r.data.numero_oc === oc1 && r.data.idempotente === true, "idempotencia: número distinto o idempotente=false")
    }
  }

  // Tamper check (CA2): a changed payload must be rejected, never sent to SAP.
  console.log("\n== Manipulación (sol-001 con precio alterado) ==")
  if (payload1 === undefined) fallos.push("manipulación: sol-001 sin payload")
  else {
    const alterado = structuredClone(payload1)
    const primera = alterado.posiciones[0]
    if (primera === undefined) fallos.push("manipulación: payload sin posiciones")
    else {
      const original = primera.precio_unitario
      primera.precio_unitario = original + 1
      console.log(`  precio_unitario ${original} → ${primera.precio_unitario}`)
      const r = resultado<CrearData>(await crear.execute({ caso: "sol-001", payload: alterado }, ctx))
      if (!r.ok && r.error.codigo === "PAYLOAD_ALTERADO") {
        console.log(`  → rechazada: ${r.error.codigo} — ${r.error.mensaje}`)
      } else {
        fallos.push(`manipulación: se esperaba PAYLOAD_ALTERADO, obtenido ${r.ok ? "OC creada" : r.error.codigo}`)
      }
    }
  }

  // Cosmetic drift: only the description changes; critical values match, so it is accepted (idempotent).
  console.log("\n== Deriva cosmética (sol-001 con descripción distinta) ==")
  if (payload1 === undefined) fallos.push("deriva cosmética: sol-001 sin payload")
  else {
    const cosmetico = structuredClone(payload1)
    const pos0 = cosmetico.posiciones[0]
    if (pos0 === undefined) fallos.push("deriva cosmética: payload sin posiciones")
    else {
      pos0.descripcion = pos0.descripcion + " (texto distinto)"
      const r = resultado<CrearData>(await crear.execute({ caso: "sol-001", payload: cosmetico }, ctx))
      if (!r.ok) fallos.push(`deriva cosmética: ${r.error.codigo} — ${r.error.mensaje}`)
      else {
        console.log(`  → aceptada · OC ${r.data.numero_oc} · idempotente: ${r.data.idempotente}`)
        console.log(`  ruta_evidencia: ${JSON.stringify(r.data.ruta_evidencia)}`)
        comprobar(r.data.numero_oc === oc1 && r.data.idempotente === true, "deriva cosmética: debía ser idempotente con el mismo número")
      }
    }
  }

  console.log("\n== Resumen ==")
  imprimirTabla(resumen)

  console.log("\nRegistros:")
  console.log(`  ${path.relative(PROJECT_ROOT, path.join(ruta.sap, "ordenes.jsonl"))}`)
  console.log(`  ${path.relative(PROJECT_ROOT, ruta.controlCsv)}`)
  for (const e of [...new Set(evidencias)].sort()) console.log(`  ${e}`)

  if (fallos.length > 0) {
    console.log("\nResultado: NO se cumplen los resultados esperados")
    fallos.forEach((f) => console.log(`  - ${f}`))
    process.exitCode = 1
  } else {
    console.log("\nResultado: todos los resultados esperados se cumplen")
  }
}

await main()
