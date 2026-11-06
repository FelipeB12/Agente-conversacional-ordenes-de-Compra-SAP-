/**
 * Fixture I/O helpers. Centralizing file access and the internal failure type
 * keeps every domain function pure-ish and lets the tool layer turn any
 * failure into a `{ ok: false, error }` without try/catch noise.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { rutas } from "../config.js"
import type { ToolError } from "../types.js"

/** Internal carrier of a ToolError; caught at the tool boundary, never escapes `execute`. */
export class ToolFail extends Error {
  constructor(public readonly error: ToolError) {
    super(error.mensaje)
  }
}

/** Reads a UTF-8 file, returning null when it does not exist (missing attachments are data, not errors). */
export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await fs.readFile(ruta, "utf8")
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null
    throw e
  }
}

/** JSON.parse that reports malformed input as JSON_INVALIDO naming the offending file. */
export function parsearJson(texto: string, archivo: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    throw new ToolFail({
      codigo: "JSON_INVALIDO",
      mensaje: `El archivo ${archivo} no es un JSON válido.`,
      sugerencia: `Pida al solicitante que reenvíe ${archivo} sin errores de formato.`,
    })
  }
}

/** Resolves and checks the case folder; unknown or malformed names are CASO_NO_ENCONTRADO. */
export async function directorioCaso(directory: string, caso: string): Promise<string> {
  const dir = path.join(rutas(directory).solicitudes, caso)
  const valido = /^[a-z0-9-]+$/.test(caso)
  const existe = valido && (await fs.stat(dir).then((s) => s.isDirectory(), () => false))
  if (!existe) {
    throw new ToolFail({
      codigo: "CASO_NO_ENCONTRADO",
      mensaje: `No existe el caso '${caso}'.`,
      sugerencia: "Verifique el nombre de la carpeta del caso (p. ej. sol-001).",
    })
  }
  return dir
}

/** Path relative to the project root with forward slashes, as tools report them. */
export function relativa(directory: string, abs: string): string {
  return path.relative(directory, abs).split(path.sep).join("/")
}
