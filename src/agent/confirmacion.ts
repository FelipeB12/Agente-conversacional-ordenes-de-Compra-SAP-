/**
 * Server-side human confirmation (decision D2): only the user's own message can
 * unlock oc_crear, never the model, and only for the case that was pending.
 */
import type { ToolContext } from "../types.js"

const AFIRMATIVOS = ["confirmo", "confirmado", "si", "apruebo", "adelante", "procede a crear", "procede", "creala", "crea la oc", "de acuerdo"]
const INICIA_AFIRMATIVO = new RegExp(`^(${AFIRMATIVOS.join("|")})(?![a-z])`)
const INICIA_NO = /^no(?![a-z])/
const CONTIENE_RECHAZO = /(?<![a-z])(cancela\w*|cancelar|no la crees|detente)(?![a-z])/
const MAX_PALABRAS = 12

/** Lowercase, strip accents, trim and drop trailing punctuation so matching is deterministic. */
function normalizar(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/[\s.,;:!?¡¿…]+$/u, "")
}

/**
 * Classifies a user reply to a pending confirmation. Exists so that the decision to unlock
 * oc_crear is a fixed rule (starts-with, short, no negation) instead of a loose keyword search
 * that would confirm things like "no, no la crees" or a long unrelated question.
 */
export function clasificarRespuesta(text: string): "confirma" | "rechaza" | "otro" {
  const t = normalizar(text)
  if (!t) return "otro"
  if (INICIA_NO.test(t) || CONTIENE_RECHAZO.test(t)) return "rechaza"
  if (t.split(/\s+/).length <= MAX_PALABRAS && INICIA_AFIRMATIVO.test(t)) return "confirma"
  return "otro"
}

/** Boolean wrapper over clasificarRespuesta, kept so callers only needing a yes/no stay simple. */
export function esConfirmacion(text: string): boolean {
  return clasificarRespuesta(text) === "confirma"
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
