/** Master-data loading and supplier lookup (RC1 / RC6 / RC7 depend on it). */
import path from "node:path"
import { z } from "zod"
import { rutas } from "../config.js"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
  type Proveedor,
} from "../types.js"
import { ToolFail, leerTextoOpcional, parsearJson } from "./fixtures.js"

async function cargar<T extends z.ZodType>(dir: string, archivo: string, schema: T): Promise<z.infer<T>[]> {
  const texto = await leerTextoOpcional(path.join(dir, archivo))
  if (texto === null) {
    throw new ToolFail({ codigo: "INTERNO", mensaje: `Falta el maestro ${archivo}.` })
  }
  const r = z.array(schema).safeParse(parsearJson(texto, archivo))
  if (!r.success) throw new ToolFail({ codigo: "JSON_INVALIDO", mensaje: `El maestro ${archivo} tiene un formato inválido.` })
  return r.data
}

/** Loads and validates the four masters from fixtures. */
export async function cargarMaestros(directory: string): Promise<Maestros> {
  const dir = rutas(directory).maestros
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    cargar(dir, "proveedores.json", ProveedorSchema),
    cargar(dir, "centros-costo.json", CentroCostoSchema),
    cargar(dir, "indicadores-iva.json", IndicadorIvaSchema),
    cargar(dir, "condiciones-pago.json", CondicionPagoSchema),
  ])
  return { proveedores, centrosCosto, indicadoresIva, condicionesPago }
}

/** Digits only, dropping the verification digit of a dotted NIT ("900.555.111-2" -> "900555111"). */
export function normalizarNit(nit: string): string {
  const sinDv = nit.includes("-") ? nit.slice(0, nit.lastIndexOf("-")) : nit
  return sinDv.replace(/\D/g, "")
}

/** Lowercase, no accents/punctuation, ignoring corporate suffixes so "S.A.S." vs none still matches. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s\.?|ltda\.?|s\.?\s?a\.?)(?=\s|$)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Finds the supplier by NIT when the request has one, otherwise by normalized name. */
export function buscarProveedor(proveedores: Proveedor[], nit: string | undefined, nombre: string): Proveedor | null {
  if (nit) {
    const n = normalizarNit(nit)
    return proveedores.find((p) => normalizarNit(p.nit) === n) ?? null
  }
  const nn = normalizarNombre(nombre)
  return proveedores.find((p) => normalizarNombre(p.nombre) === nn) ?? null
}
