/**
 * Importable tool set for other agent platforms: the same tool objects the app
 * uses (single source: src/tools/oc.ts). Host tool names become `oc_<export>`.
 */
import { crear as crearApp } from "../../src/tools/oc.js"
import type { ToolDef } from "../../src/types.js"

export { leer_paquete, validar, construir_payload, generar_evidencia } from "../../src/tools/oc.js"

/**
 * Thin wrapper over the app's `crear`: same description and args. WHY: outside
 * our server nobody sets `ctx.confirmacionHumana`, so the host platform's
 * permission prompt is the human gate. Configure `oc_crear` with an "ask"
 * permission in the host; when it is approved the call carries `confirmado: true`
 * and that is mapped to `confirmacionHumana`. Amount protection (critical-field
 * check, server-rebuilt payload) is unchanged.
 */
export const crear = {
  description: crearApp.description,
  args: crearApp.args,
  async execute(args, ctx) {
    return crearApp.execute(args, { ...ctx, confirmacionHumana: args.confirmado === true })
  },
} satisfies ToolDef<typeof crearApp.args>
