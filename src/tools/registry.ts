/**
 * Tool registry: maps `<file>_<export>` names to typed ToolDefs, validates
 * model-supplied args with zod before executing, and never throws, so a bad
 * call becomes feedback to the model (PRD §6.2) instead of a crash.
 */
import { z } from "zod"
import type { LlmToolSpec, ToolContext, ToolDef } from "../types.js"

export type Registry = {
  specs: LlmToolSpec[]
  ejecutar(name: string, rawJson: string, ctx: ToolContext): Promise<string>
}

function errorJson(codigo: string, mensaje: string, sugerencia?: string): string {
  return JSON.stringify({ ok: false, error: { codigo, mensaje, ...(sugerencia ? { sugerencia } : {}) } })
}

/** Builds specs and a safe executor from tool modules, e.g. `{ oc: ocTools }`. */
export function buildRegistry(modules: Record<string, Record<string, ToolDef>>): Registry {
  const tools = new Map<string, { def: ToolDef; schema: z.ZodObject }>()
  const specs: LlmToolSpec[] = []
  for (const [file, exports] of Object.entries(modules)) {
    for (const [exp, def] of Object.entries(exports)) {
      const name = `${file}_${exp}`
      const schema = z.object(def.args)
      tools.set(name, { def, schema })
      const { $schema: _omit, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>
      specs.push({ name, description: def.description, parameters })
    }
  }
  return {
    specs,
    async ejecutar(name, rawJson, ctx) {
      const t = tools.get(name)
      if (!t) return errorJson("ARGS_INVALIDOS", `La herramienta "${name}" no existe.`, `Usa solo: ${[...tools.keys()].join(", ")}`)
      let parsed: unknown
      try {
        parsed = rawJson.trim() === "" ? {} : JSON.parse(rawJson)
      } catch {
        return errorJson("ARGS_INVALIDOS", "Los argumentos no son JSON válido.", "Reenvía la llamada con JSON válido.")
      }
      const r = t.schema.safeParse(parsed)
      if (!r.success) {
        const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
        return errorJson("ARGS_INVALIDOS", `Argumentos inválidos: ${detalle}`, "Corrige los argumentos según el esquema.")
      }
      try {
        return await t.def.execute(r.data, ctx)
      } catch {
        return errorJson("ERROR_HERRAMIENTA", "La herramienta falló de forma inesperada.")
      }
    },
  }
}
