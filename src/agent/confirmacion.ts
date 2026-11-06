/**
 * Server-side human confirmation (decision D2): only the user's own message can
 * unlock oc_crear, never the model, and only for the case that was pending.
 */
import type { ToolContext } from "../types.js"

const NEGACION = /(?<![\p{L}])(no|nunca|cancela\w*|cancelar|detente|detener|rechazo|rechazar|espera|aún no|todavia no|todavía no)(?![\p{L}])/iu
const AFIRMATIVO =
  /(?<![\p{L}])(confirmo|confirmado|confirmar|s[ií]|apruebo|aprobado|aprobar|adelante|procede|proceder|proceda|crear|cr[eé]ala|cr[eé]a|ok|de acuerdo|dale|hazlo)(?![\p{L}])/iu

/** True for an explicit affirmative with no negation/cancel word. */
export function esConfirmacion(text: string): boolean {
  const t = text.trim()
  if (!t || NEGACION.test(t)) return false
  return AFIRMATIVO.test(t)
}

/** Whether a tool call may carry confirmacionHumana: user confirmed AND args.caso matches the pending case. */
export function contextoParaLlamada(
  base: ToolContext,
  pendiente: { caso: string } | null,
  usuarioConfirma: boolean,
  args: unknown,
): ToolContext {
  let caso: unknown
  if (typeof args === "object" && args !== null && "caso" in args) caso = (args as { caso?: unknown }).caso
  const ok = usuarioConfirma && pendiente !== null && caso === pendiente.caso
  return { ...base, confirmacionHumana: ok }
}
