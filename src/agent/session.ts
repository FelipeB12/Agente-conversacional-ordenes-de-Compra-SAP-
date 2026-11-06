/** In-memory sessions (PRD: persistence optional). One Map, lost on restart by design. */
import { config } from "../config.js"
import type { LlmMessage, MensajeView, SessionView } from "../types.js"

export type Session = {
  sessionId: string
  history: LlmMessage[] // without the system message; it is rebuilt each request
  mensajes: MensajeView[]
  tokensUsados: number
  pendiente: { caso: string } | null
}

const sessions = new Map<string, Session>()

const global = { dia: "", tokens: 0 }
const hoyUtc = () => new Date().toISOString().slice(0, 10)

function rotarDia(): void {
  const hoy = hoyUtc()
  if (global.dia !== hoy) {
    global.dia = hoy
    global.tokens = 0
  }
}

/** Adds tokens to the UTC-day total shared by all sessions, so a public link cannot spend the key without bound. */
export function registrarTokensGlobales(n: number): void {
  rotarDia()
  global.tokens += n
}

/** True when the shared daily budget is spent; checked before each LLM call to stop spending early. */
export function presupuestoGlobalAgotado(): boolean {
  rotarDia()
  return global.tokens >= config.MAX_TOKENS_GLOBAL_PER_DAY
}

/** Gets or creates the session; marks it most-recently-used and evicts the oldest beyond MAX_SESSIONS to bound memory. */
export function getSession(sessionId: string): Session {
  let s = sessions.get(sessionId)
  if (s) {
    sessions.delete(sessionId) // re-insert at the end: Map order = recency
  } else {
    s = { sessionId, history: [], mensajes: [], tokensUsados: 0, pendiente: null }
    while (sessions.size >= config.MAX_SESSIONS) {
      const viejo = sessions.keys().next()
      if (viejo.done) break
      sessions.delete(viejo.value)
    }
  }
  sessions.set(sessionId, s)
  return s
}

/** Read-only DTO (does not touch recency); unknown ids yield an empty view without creating state. */
export function verSession(sessionId: string): SessionView {
  const s = sessions.get(sessionId)
  return {
    sessionId,
    mensajes: s?.mensajes ?? [],
    tokensUsados: s?.tokensUsados ?? 0,
    pendiente: s?.pendiente ?? null,
  }
}
