/** Reads a case folder into the normalized Paquete (PRD §7.2, HU-1). */
import path from "node:path"

import {
  AprobacionFixtureSchema,
  CorreoFixtureSchema,
  SolicitudSchema,
  type Paquete,
} from "../types.js"
import { ToolFail, directorioCaso, leerTextoOpcional, parsearJson } from "./fixtures.js"
import { normalizarNit } from "./maestros.js"

/** Parses Colombian-formatted money ("11.400.000" or "1.234,50") into a number; null if not numeric. */
function parsearMonto(s: string): number | null {
  const limpio = s.trim().replace(/\./g, "").replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null
  return Number(limpio)
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Extracts reference, supplier, NIT, total and validity from the quote text. */
export function parsearCotizacion(texto: string): NonNullable<Paquete["cotizacion"]> {
  const referencia = /COTIZACI[ÓO]N\s+(\S+)/i.exec(texto)?.[1] ?? null
  const proveedor = /^\s*Proveedor:\s*(.+?)\s*$/im.exec(texto)?.[1] ?? ""
  const nitRaw = /^\s*NIT:\s*(.+?)\s*$/im.exec(texto)?.[1]
  const nit = nitRaw ? normalizarNit(nitRaw) || null : null
  const totalLinea = /^\s*TOTAL[^\n:]*:\s*(.+?)\s*$/im.exec(texto)?.[1]
  const m = totalLinea ? /^([A-Z]{3})?\s*([\d.,]+)/.exec(totalLinea) : null
  const total = m?.[2] ? parsearMonto(m[2]) : null
  if (total === null) {
    throw new ToolFail({
      codigo: "MONTO_INVALIDO",
      mensaje: "No se pudo leer un total numérico en la cotización.",
      sugerencia: "Pida al proveedor o al solicitante una cotización con la línea TOTAL clara.",
    })
  }
  const fecha = /^\s*Fecha:\s*(\d{4}-\d{2}-\d{2})/im.exec(texto)?.[1]
  const dias = /Validez[^\n:]*:\s*(\d+)\s*d[ií]as/i.exec(texto)?.[1]
  return {
    proveedor,
    nit,
    total,
    moneda: m?.[1] ?? "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    referencia,
    texto,
  }
}

function parsearFactura(texto: string): NonNullable<Paquete["factura"]> {
  const numero = /No\.\s*(\S+)/i.exec(texto)?.[1]
  const fecha = /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i.exec(texto)?.[1]
  const totalRaw = /^\s*TOTAL[^\n:]*:\s*(?:[A-Z]{3}\s*)?([\d.,]+)/im.exec(texto)?.[1]
  const total = totalRaw ? parsearMonto(totalRaw) : null
  if (total === null) {
    throw new ToolFail({
      codigo: "MONTO_INVALIDO",
      mensaje: "No se pudo leer un total numérico en la factura.",
      sugerencia: "Pida la factura legible con su total.",
    })
  }
  if (!numero || !fecha) {
    throw new ToolFail({
      codigo: "PAQUETE_INCOMPLETO",
      mensaje: "La factura no tiene número o fecha de emisión legibles.",
      sugerencia: "Pida la factura electrónica completa.",
    })
  }
  return { numero, fecha, total }
}

/** True when the body says "aprobado" and it is not negated ("no aprobado"). */
export function esAprobado(cuerpo: string): boolean {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\b(no|sin)\s+(est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo)
}

/** Reads and normalizes all files of a case. Throws ToolFail for the HU-6 error cases. */
export async function leerPaquete(directory: string, caso: string): Promise<Paquete> {
  const dir = await directorioCaso(directory, caso)
  const leer = (f: string) => leerTextoOpcional(path.join(dir, f))
  const [correoT, solicitudT, cotizacionT, aprobacionT, facturaT] = await Promise.all([
    leer("correo.json"),
    leer("solicitud.json"),
    leer("cotizacion.txt"),
    leer("aprobacion.json"),
    leer("factura.txt"),
  ])

  if (solicitudT === null || correoT === null) {
    const falta = [solicitudT === null ? "solicitud.json" : null, correoT === null ? "correo.json" : null].filter(Boolean)
    throw new ToolFail({
      codigo: "PAQUETE_INCOMPLETO",
      mensaje: `Falta ${falta.join(" y ")} en el caso ${caso}.`,
      sugerencia: `Pida al solicitante que reenvíe el correo con la solicitud de compra (Excel) y el correo original; falta: ${falta.join(", ")}.`,
      detalle: { faltantes: falta },
    })
  }

  const solicitudRaw = parsearJson(solicitudT, "solicitud.json")
  const solObj =
    solicitudRaw && typeof solicitudRaw === "object" && !Array.isArray(solicitudRaw)
      ? Object.fromEntries(Object.entries(solicitudRaw).filter(([, v]) => v !== null))
      : solicitudRaw
  for (const campo of ["cantidad", "valor_unitario", "valor_total"]) {
    const v = (solObj as Record<string, unknown> | null)?.[campo]
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
      throw new ToolFail({
        codigo: "MONTO_INVALIDO",
        mensaje: `El campo '${campo}' de la solicitud no es numérico (valor: ${JSON.stringify(v)}).`,
        sugerencia: `Pida al solicitante corregir '${campo}' en el Excel con un número válido.`,
      })
    }
  }
  const sol = SolicitudSchema.safeParse(solObj)
  if (!sol.success) {
    const campos = [...new Set(sol.error.issues.map((i) => i.path.join(".") || "(raíz)"))]
    throw new ToolFail({
      codigo: "PAQUETE_INCOMPLETO",
      mensaje: `La solicitud está incompleta o mal formada: ${campos.join(", ")}.`,
      sugerencia: `Pida al solicitante completar en el Excel: ${campos.join(", ")}.`,
      detalle: sol.error.issues.map((i) => ({ campo: i.path.join("."), problema: i.message })),
    })
  }
  const cor = CorreoFixtureSchema.safeParse(parsearJson(correoT, "correo.json"))
  if (!cor.success) {
    throw new ToolFail({
      codigo: "PAQUETE_INCOMPLETO",
      mensaje: "El correo de la solicitud está incompleto.",
      sugerencia: "Pida al solicitante reenviar el correo original.",
    })
  }

  const faltantes: string[] = []
  const cotizacion = cotizacionT === null ? (faltantes.push("cotizacion.txt"), null) : parsearCotizacion(cotizacionT)
  let aprobacion: Paquete["aprobacion"] = null
  if (aprobacionT === null) faltantes.push("aprobacion.json")
  else {
    const a = AprobacionFixtureSchema.safeParse(parsearJson(aprobacionT, "aprobacion.json"))
    if (!a.success) {
      throw new ToolFail({
        codigo: "JSON_INVALIDO",
        mensaje: "aprobacion.json no tiene los campos esperados (de, para, fecha, asunto, cuerpo).",
        sugerencia: "Pida reenviar el correo de aprobación.",
      })
    }
    aprobacion = {
      de: a.data.de,
      para: a.data.para,
      asunto: a.data.asunto,
      fecha: a.data.fecha,
      aprobado: esAprobado(a.data.cuerpo),
      texto: a.data.cuerpo,
    }
  }
  const factura = facturaT === null ? (faltantes.push("factura.txt"), null) : parsearFactura(facturaT)

  return {
    correo: { id: cor.data.id, de: cor.data.de, asunto: cor.data.asunto, fecha: cor.data.fecha },
    solicitud: sol.data,
    cotizacion,
    aprobacion,
    factura,
    faltantes,
  }
}

