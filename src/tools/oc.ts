/**
 * The five purchase-order tools (PRD §6.2). Each `execute` returns a JSON
 * ToolResult and never throws: domain failures are ToolFail, anything else
 * becomes INTERNO.
 */
import { appendControl } from "../control/log.js"
import { rutas } from "../config.js"
import { construirOrden, escribirTrazabilidad, hashPayload } from "../domain/payload.js"
import { validarPaquete } from "../domain/controles.js"
import { escribirEvidencia } from "../domain/evidencia.js"
import { ToolFail, relativa } from "../domain/fixtures.js"
import { cargarMaestros } from "../domain/maestros.js"
import { leerPaquete } from "../domain/paquete.js"
import { createMockSap } from "../sap/mock.js"
import {
  ToolArgs,
  type ConstruirPayloadData,
  type ControlRow,
  type CrearData,
  type GenerarEvidenciaData,
  type LeerPaqueteData,
  type ToolDef,
  type ToolError,
  type ToolResult,
  type ValidarData,
} from "../types.js"

/** Runs a tool body and serializes its outcome; the single place that guarantees "never throws". */
async function envolver<T>(fn: () => Promise<T>): Promise<string> {
  let r: ToolResult<T>
  try {
    r = { ok: true, data: await fn() }
  } catch (e) {
    const error: ToolError =
      e instanceof ToolFail
        ? e.error
        : { codigo: "INTERNO", mensaje: "Ocurrió un error interno inesperado.", detalle: e instanceof Error ? e.message : String(e) }
    r = { ok: false, error }
  }
  return JSON.stringify(r)
}

/** Reads the case and runs the controls against the masters (source of truth, ignoring model-supplied copies). */
async function evaluar(directory: string, caso: string) {
  const [paquete, maestros] = await Promise.all([leerPaquete(directory, caso), cargarMaestros(directory)])
  const validacion = validarPaquete(paquete, maestros)
  return { paquete, maestros, validacion }
}

function fila(
  paquete: { solicitud: { solicitud_id: string } },
  v: { retroactiva: boolean; bloqueos: { codigo: string }[]; confirmaciones: { codigo: string }[] },
  resultado: ControlRow["resultado"],
  numero_oc: string | null = null,
): ControlRow {
  return {
    solicitud_id: paquete.solicitud.solicitud_id,
    resultado,
    numero_oc,
    retroactiva: v.retroactiva,
    bloqueos: v.bloqueos.map((b) => b.codigo),
    confirmaciones: v.confirmaciones.map((c) => c.codigo),
    ts: new Date().toISOString(),
  }
}

export const leer_paquete = {
  description: "Lee y normaliza el paquete de una solicitud (correo, solicitud, cotización, aprobación, factura) e informa lo que falta.",
  args: ToolArgs.leer_paquete,
  async execute(args, ctx) {
    return envolver<LeerPaqueteData>(() => leerPaquete(ctx.directory, args.caso))
  },
} satisfies ToolDef<typeof ToolArgs.leer_paquete>

export const validar = {
  description: "Aplica los controles RC1-RC10 contra los maestros y devuelve apta, bloqueos, confirmaciones y derivados.",
  args: ToolArgs.validar,
  async execute(args, ctx) {
    return envolver<ValidarData>(async () => {
      const { paquete, validacion } = await evaluar(ctx.directory, args.caso)
      if (!validacion.apta) await appendControl(rutas(ctx.directory).out, fila(paquete, validacion, "bloqueada"))
      return validacion
    })
  },
} satisfies ToolDef<typeof ToolArgs.validar>

export const construir_payload = {
  description: "Construye el payload de la orden de compra (solo si es apta), con su hash y la trazabilidad de cada valor.",
  args: ToolArgs.construir_payload,
  async execute(args, ctx) {
    return envolver<ConstruirPayloadData>(async () => {
      const { paquete, maestros, validacion } = await evaluar(ctx.directory, args.caso)
      if (!validacion.apta) {
        throw new ToolFail({
          codigo: "BLOQUEADO",
          mensaje: "La solicitud tiene bloqueos; no se construye el payload.",
          sugerencia: "Resuelva los bloqueos con el solicitante.",
          detalle: validacion.bloqueos,
        })
      }
      const { payload, trazabilidad } = construirOrden(paquete, validacion, maestros)
      const ruta = await escribirTrazabilidad(ctx.directory, args.caso, trazabilidad)
      return { payload, payload_sha256: hashPayload(payload), ruta_trazabilidad: relativa(ctx.directory, ruta) }
    })
  },
} satisfies ToolDef<typeof ToolArgs.construir_payload>

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación (texto y PDF con sha256) del correo de aprobación del caso.",
  args: ToolArgs.generar_evidencia,
  async execute(args, ctx) {
    return envolver<GenerarEvidenciaData>(async () => {
      const paquete = await leerPaquete(ctx.directory, args.caso)
      return escribirEvidencia(ctx.directory, args.caso, paquete)
    })
  },
} satisfies ToolDef<typeof ToolArgs.generar_evidencia>

export const crear = {
  description: "Crea la orden de compra en SAP simulado con el payload sin modificar; exige confirmación humana si hay confirmaciones pendientes.",
  args: ToolArgs.crear,
  async execute(args, ctx) {
    return envolver<CrearData>(async () => {
      const out = rutas(ctx.directory).out
      const { paquete, maestros, validacion } = await evaluar(ctx.directory, args.caso)

      if (!validacion.apta) {
        await appendControl(out, fila(paquete, validacion, "bloqueada"))
        throw new ToolFail({
          codigo: "BLOQUEADO",
          mensaje: "La solicitud tiene bloqueos; no se puede crear la OC.",
          sugerencia: "Resuelva los bloqueos con el solicitante.",
          detalle: validacion.bloqueos,
        })
      }
      const { payload } = construirOrden(paquete, validacion, maestros)
      if (hashPayload(args.payload) !== hashPayload(payload)) {
        await appendControl(out, fila(paquete, validacion, "rechazada"))
        throw new ToolFail({
          codigo: "PAYLOAD_ALTERADO",
          mensaje: "El payload recibido no coincide con el calculado desde las fuentes; se rechaza.",
          sugerencia: "Vuelva a llamar a oc_construir_payload y use su resultado sin modificarlo.",
        })
      }

      const sap = createMockSap({ outDir: out, maestrosDir: rutas(ctx.directory).maestros })
      const solicitudId = paquete.solicitud.solicitud_id
      const existente = await sap.buscarOrdenPorReferencia(solicitudId)
      if (existente) {
        await appendControl(out, fila(paquete, validacion, "idempotente", existente.numero_oc))
        return { numero_oc: existente.numero_oc, fecha: new Date().toISOString().slice(0, 10), idempotente: true, retroactiva: validacion.retroactiva }
      }

      if (validacion.confirmaciones.length > 0 && !(args.confirmado === true && ctx.confirmacionHumana === true)) {
        await appendControl(out, fila(paquete, validacion, "pendiente_confirmacion"))
        const sinHumano = args.confirmado === true && ctx.confirmacionHumana !== true
        throw new ToolFail({
          codigo: "CONFIRMACION_REQUERIDA",
          mensaje: sinHumano
            ? "Se indicó confirmado=true, pero no se recibió confirmación humana explícita del analista; no se crea la OC."
            : "Hay confirmaciones pendientes; el analista debe confirmarlas explícitamente antes de crear la OC.",
          sugerencia: "Presente las confirmaciones al analista y espere su respuesta en un mensaje nuevo.",
          detalle: validacion.confirmaciones,
        })
      }

      await escribirEvidencia(ctx.directory, args.caso, paquete)
      const sello = `analista (sesión ${ctx.sessionId})`
      const orden = {
        ...payload,
        excepciones: payload.excepciones.map((e) => ({ ...e, confirmado_por: sello })),
      }
      const { numero_oc, fecha } = await sap.crearOrden(orden)
      await appendControl(out, fila(paquete, validacion, "creada", numero_oc))
      return { numero_oc, fecha, idempotente: false, retroactiva: validacion.retroactiva }
    })
  },
} satisfies ToolDef<typeof ToolArgs.crear>
