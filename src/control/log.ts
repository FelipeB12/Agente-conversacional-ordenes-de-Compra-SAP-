import { mkdir, appendFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { AppendControl, ControlRow } from "../types.js"

const CABECERA = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

/** Serializes appends so two concurrent first writes cannot both emit the header. */
let cola: Promise<void> = Promise.resolve()

/**
 * RFC-4180 field escaping: quote only when the value would otherwise break the row,
 * and double any embedded quotes. Keeps the audit CSV openable in Excel without surprises.
 */
function escaparCampo(valor: string): string {
  if (/[",\r\n]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`
  return valor
}

function serializarFila(row: ControlRow): string {
  const campos = [
    row.solicitud_id,
    row.resultado,
    row.numero_oc ?? "",
    row.retroactiva ? "true" : "false",
    row.bloqueos.join("|"),
    row.confirmaciones.join("|"),
    row.ts,
  ]
  return campos.map(escaparCampo).join(",") + "\n"
}

async function esNuevo(ruta: string): Promise<boolean> {
  try {
    const info = await stat(ruta)
    return info.size === 0
  } catch {
    return true
  }
}

/**
 * Appends one attempt to `<outDir>/control.csv` (HU-5). Every attempt is logged, including
 * blocked and pending ones, because the audit trail must show what was tried, not only successes.
 */
export const appendControl: AppendControl = (outDir: string, row: ControlRow) => {
  const siguiente = cola.then(async () => {
    const ruta = join(outDir, "control.csv")
    await mkdir(outDir, { recursive: true })
    const contenido = (await esNuevo(ruta)) ? CABECERA + "\n" : ""
    await appendFile(ruta, contenido + serializarFila(row), "utf8")
  })
  cola = siguiente.catch(() => undefined)
  return siguiente
}
