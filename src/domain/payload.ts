/** Builds the OrdenCompra (PRD §7.4) with per-field traceability (HU-3) and its canonical hash. */
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { rutas } from "../config.js"
import {
  OrdenCompraSchema,
  type Fuente,
  type Maestros,
  type OrdenCompra,
  type Paquete,
  type ResultadoValidacion,
  type Trazabilidad,
} from "../types.js"
import { hashEvidencia } from "./evidencia.js"
import { ToolFail } from "./fixtures.js"
import { buscarProveedor } from "./maestros.js"

/** JSON with recursively sorted keys so equal payloads always hash equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}

/** sha256 hex over the canonical JSON; the tamper check of crear compares these. */
export function hashPayload(v: unknown): string {
  return createHash("sha256").update(canonicalJson(v), "utf8").digest("hex")
}

/** Flat map of control-relevant values, keyed by dotted path (e.g. `posiciones[0].precio_unitario`). */
export type Proyeccion = Record<string, string | number | boolean | null | undefined>

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function escalar(v: unknown): string | number | boolean | null | undefined {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null ? v : undefined
}

/**
 * Extracts only the values that matter for control (who, what, how much, who approved).
 * Accepts `unknown` so it can read a model-supplied payload loosely: anything missing or
 * of an unexpected shape becomes `undefined` and therefore differs from the server value.
 */
export function proyeccionCritica(orden: unknown): Proyeccion {
  const o = obj(orden)
  const ref = obj(o?.referencia)
  const prov = obj(o?.proveedor)
  const apr = obj(o?.aprobador)
  const pos = Array.isArray(o?.posiciones) ? (o.posiciones as unknown[]) : undefined
  const r: Proyeccion = {
    "referencia.solicitud_id": escalar(ref?.solicitud_id),
    "proveedor.codigo_sap": escalar(prov?.codigo_sap),
    "proveedor.nit": escalar(prov?.nit),
    moneda: escalar(o?.moneda),
    condiciones_pago: escalar(o?.condiciones_pago),
    "aprobador.email": escalar(apr?.email),
    "posiciones.length": pos?.length,
  }
  ;(pos ?? []).forEach((raw, i) => {
    const p = obj(raw)
    for (const k of ["numero", "cantidad", "unidad", "precio_unitario", "centro_costo", "subarea", "indicador_iva"]) {
      r[`posiciones[${i}].${k}`] = escalar(p?.[k])
    }
  })
  return r
}

/** Differences between two projections: `{campo: {servidor, recibido}}`; empty when they agree. */
export function diferenciasProyeccion(servidor: Proyeccion, recibido: Proyeccion): Record<string, { servidor: unknown; recibido: unknown }> {
  const d: Record<string, { servidor: unknown; recibido: unknown }> = {}
  for (const k of new Set([...Object.keys(servidor), ...Object.keys(recibido)])) {
    if (servidor[k] !== recibido[k]) d[k] = { servidor: servidor[k] ?? null, recibido: recibido[k] ?? null }
  }
  return d
}

/** Unit of measure from the quote item (or the description): hours, months, else units. */
export function derivarUnidad(p: Paquete): "UN" | "H" | "MES" {
  const item = p.cotizacion ? /^\s*1\.\s*(.+?)\s*\|/m.exec(p.cotizacion.texto)?.[1] : undefined
  const t = item ?? p.solicitud.descripcion
  if (/hora/i.test(t)) return "H"
  // \b so "12 meses" of a license term is not mistaken for a monthly service.
  if (/\bmes\b|mensual/i.test(t)) return "MES"
  return "UN"
}

/** Builds and zod-validates the payload from the solicitud (never the quote) and masters. */
export function construirOrden(
  p: Paquete,
  v: ResultadoValidacion,
  m: Maestros,
): { payload: OrdenCompra; trazabilidad: Trazabilidad } {
  const s = p.solicitud
  const prov = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre)
  if (!prov || !p.aprobacion || !v.apta) {
    throw new ToolFail({ codigo: "BLOQUEADO", mensaje: "La solicitud no es apta; no se puede construir el payload.", detalle: v.bloqueos })
  }
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor ?? prov.indicador_iva_default
  const pago = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor ?? prov.condiciones_pago_default
  const payload = OrdenCompraSchema.parse({
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: { email: p.aprobacion.de, fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: hashEvidencia(p.aprobacion) },
    posiciones: [
      {
        numero: 10,
        descripcion: s.descripcion.slice(0, 40),
        cantidad: s.cantidad,
        unidad: derivarUnidad(p),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  })
  const t: Record<string, Fuente> = {
    "referencia.solicitud_id": "solicitud",
    "referencia.correo_id": "correo",
    "referencia.cotizacion_ref": p.cotizacion ? "cotizacion" : "constante",
    sociedad: "constante",
    organizacion_compras: "constante",
    "proveedor.codigo_sap": "maestro.proveedores",
    "proveedor.nit": "maestro.proveedores",
    "proveedor.nombre": "maestro.proveedores",
    moneda: "solicitud",
    condiciones_pago: s.condiciones_pago ? "solicitud" : "derivado",
    "aprobador.email": "aprobacion",
    "aprobador.fecha_aprobacion": "aprobacion",
    "aprobador.evidencia_sha256": "evidencia",
    "posiciones[0].numero": "constante",
    "posiciones[0].descripcion": "solicitud",
    "posiciones[0].cantidad": "solicitud",
    "posiciones[0].unidad": "derivado",
    "posiciones[0].precio_unitario": "solicitud",
    "posiciones[0].centro_costo": "solicitud",
    "posiciones[0].subarea": "solicitud",
    "posiciones[0].indicador_iva": s.indicador_iva ? "solicitud" : "derivado",
  }
  payload.excepciones.forEach((_, i) => {
    t[`excepciones[${i}]`] = "derivado"
  })
  return { payload, trazabilidad: t }
}

/** Persists out/<caso>/trazabilidad.json and returns its absolute path. */
export async function escribirTrazabilidad(directory: string, caso: string, t: Trazabilidad): Promise<string> {
  const dir = rutas(directory).caso(caso)
  await fs.mkdir(dir, { recursive: true })
  const ruta = path.join(dir, "trazabilidad.json")
  await fs.writeFile(ruta, JSON.stringify(t, null, 2) + "\n", "utf8")
  return ruta
}
