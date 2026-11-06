import { mkdir, appendFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { OrdenCompraSchema, ProveedorSchema } from "../types.js"
import type { CreateMockSap, OrdenCompra, SapAdapter } from "../types.js"

/** One line of `out/sap/ordenes.jsonl`. The full order is kept so the mock can answer by referencia. */
const OrdenLineSchema = z.object({
  numero_oc: z.string(),
  fecha: z.string(),
  orden: OrdenCompraSchema,
})
type OrdenLine = z.infer<typeof OrdenLineSchema>

const PRIMER_NUMERO_OC = 4500000001

/**
 * Write chains keyed by file path. A module-level map (rather than one per factory call)
 * keeps two adapters pointing at the same outDir from handing out the same OC number.
 */
const chains = new Map<string, Promise<unknown>>()

/** Runs `tarea` after every previously queued task on the same file, so reads and writes never interleave. */
function enSerie<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
  const previa = chains.get(clave) ?? Promise.resolve()
  const actual = previa.catch(() => undefined).then(tarea)
  chains.set(clave, actual)
  return actual
}

/** Reads every order line. A missing file is an empty SAP, not an error. */
async function leerLineas(ruta: string): Promise<OrdenLine[]> {
  let contenido: string
  try {
    contenido = await readFile(ruta, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  }
  return contenido
    .split("\n")
    .filter((linea) => linea.trim() !== "")
    .map((linea) => OrdenLineSchema.parse(JSON.parse(linea)))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/** Keeps only digits so "900.555.111-1" and "9005551111" are the same NIT for matching. */
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

/**
 * File-backed SAP simulator (PRD §7.4, HU-5). Lets the agent exercise the same
 * adapter contract a real SAP would sit behind, with state inspectable on disk.
 * Numbering is sequential from 4500000001 and idempotent per solicitud_id, mirroring
 * how a real SAP would be asked to avoid duplicate purchase orders on retries.
 */
export const createMockSap: CreateMockSap = ({ outDir, maestrosDir }) => {
  const rutaOrdenes = join(outDir, "sap", "ordenes.jsonl")
  const rutaProveedores = join(maestrosDir, "proveedores.json")

  const adapter: SapAdapter = {
    async consultarProveedor(nit) {
      const contenido = await readFile(rutaProveedores, "utf8")
      const proveedores = ProveedorSchema.array().parse(JSON.parse(contenido))
      const buscado = soloDigitos(nit)
      const encontrado = proveedores.find((p) => soloDigitos(p.nit) === buscado)
      return encontrado ? { codigo_sap: encontrado.codigo_sap, activo: encontrado.activo } : null
    },

    async buscarOrdenPorReferencia(solicitud_id) {
      const lineas = await leerLineas(rutaOrdenes)
      const hallada = lineas.find((l) => l.orden.referencia.solicitud_id === solicitud_id)
      return hallada ? { numero_oc: hallada.numero_oc } : null
    },

    crearOrden(orden: OrdenCompra) {
      const ordenValida = OrdenCompraSchema.parse(orden)
      // Queued on the file path so the read-count-append sequence is atomic within this process.
      return enSerie(rutaOrdenes, async () => {
        const existentes = await leerLineas(rutaOrdenes)
        const previa = existentes.find((l) => l.orden.referencia.solicitud_id === ordenValida.referencia.solicitud_id)
        if (previa) return { numero_oc: previa.numero_oc, fecha: previa.fecha }

        const linea: OrdenLine = {
          numero_oc: String(PRIMER_NUMERO_OC + existentes.length),
          fecha: new Date().toISOString(),
          orden: ordenValida,
        }
        await mkdir(join(outDir, "sap"), { recursive: true })
        await appendFile(rutaOrdenes, JSON.stringify(linea) + "\n", "utf8")
        return { numero_oc: linea.numero_oc, fecha: linea.fecha }
      })
    },
  }

  return adapter
}
