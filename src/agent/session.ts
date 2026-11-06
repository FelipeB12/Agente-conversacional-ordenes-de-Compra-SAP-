/** In-memory sessions (PRD: persistence optional). One Map, lost on restart by design. */
import type { LlmMessage, MensajeView, SessionView } from "../types.js"

export type Session = {
  sessionId: string
  history: LlmMessage[] // without the system message; it is rebuilt each request
  mensajes: MensajeView[]
  tokensUsados: number
  pendiente: { caso: string } | null
}

const sessions = new Map<string, Session>()

/** Gets or creates the session. */
export function getSession(sessionId: string): Session {
  let s = sessions.get(sessionId)
  if (!s) {
    s = { sessionId, history: [], mensajes: [], tokensUsados: 0, pendiente: null }
    sessions.set(sessionId, s)
  }
  return s
}

/** Read-only DTO; unknown ids yield an empty view without creating state. */
export function verSession(sessionId: string): SessionView {
  const s = sessions.get(sessionId)
  return {
    sessionId,
    mensajes: s?.mensajes ?? [],
    tokensUsados: s?.tokensUsados ?? 0,
    pendiente: s?.pendiente ?? null,
  }
}
