/** Approval evidence (HU-4): text + PDF and the shared hash that the payload embeds. */
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { rutas } from "../config.js"
import type { GenerarEvidenciaData, Paquete } from "../types.js"
import { ToolFail, relativa } from "./fixtures.js"

type Aprobacion = NonNullable<Paquete["aprobacion"]>

/** Canonical evidence text; the single source for both the hash and the files. */
export function contenidoEvidencia(a: Aprobacion): string {
  return `De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.texto}`
}

/** sha256 hex of the evidence content (same function used by construir_payload). */
export function hashEvidencia(a: Aprobacion): string {
  return createHash("sha256").update(contenidoEvidencia(a), "utf8").digest("hex")
}

function envolver(linea: string, max: number): string[] {
  if (linea.length <= max) return [linea]
  const out: string[] = []
  let actual = ""
  for (const palabra of linea.split(" ")) {
    if ((actual + " " + palabra).trim().length > max) {
      if (actual) out.push(actual)
      actual = palabra
    } else actual = (actual + " " + palabra).trim()
  }
  if (actual) out.push(actual)
  return out
}

async function crearPdf(contenido: string, sha: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fecha = new Date("2026-01-01T00:00:00Z")
  doc.setCreationDate(fecha)
  doc.setModificationDate(fecha)
  doc.setProducer("reto-03")
  doc.setCreator("reto-03")
  doc.setTitle("Evidencia de aprobación")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const soportados = new Set(font.getCharacterSet())
  const limpio = (s: string) => [...s].map((c) => (soportados.has(c.codePointAt(0) ?? 0) ? c : "?")).join("")
  const lineas = [...contenido.split("\n"), "", `sha256: ${sha}`].flatMap((l) => envolver(limpio(l.replace(/\t/g, " ").replace(/\r/g, "")), 90))
  const size = 10
  const alto = 14
  const margen = 50
  let page = doc.addPage()
  let y = page.getHeight() - margen
  for (const l of lineas) {
    if (y < margen) {
      page = doc.addPage()
      y = page.getHeight() - margen
    }
    page.drawText(l, { x: margen, y, size, font })
    y -= alto
  }
  return doc.save()
}

/** Writes out/<caso>/aprobacion.txt and .pdf; idempotent for identical input. */
export async function escribirEvidencia(directory: string, caso: string, paquete: Paquete): Promise<GenerarEvidenciaData> {
  const a = paquete.aprobacion
  if (!a) {
    throw new ToolFail({
      codigo: "PAQUETE_INCOMPLETO",
      mensaje: "No hay correo de aprobación para generar la evidencia.",
      sugerencia: "Pida al solicitante el correo de aprobación de su líder.",
    })
  }
  const contenido = contenidoEvidencia(a)
  const sha = hashEvidencia(a)
  const dir = rutas(directory).caso(caso)
  await fs.mkdir(dir, { recursive: true })
  const txt = path.join(dir, "aprobacion.txt")
  const pdf = path.join(dir, "aprobacion.pdf")
  await fs.writeFile(txt, `${contenido}\n\nsha256: ${sha}\n`, "utf8")
  await fs.writeFile(pdf, await crearPdf(contenido, sha))
  return { ruta: relativa(directory, txt), ruta_pdf: relativa(directory, pdf), sha256: sha }
}
