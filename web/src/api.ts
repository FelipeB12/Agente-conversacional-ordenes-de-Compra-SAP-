/**
 * Client for the chat API (PRD §6.4). Failures are mapped to plain Spanish
 * messages here, so the UI never shows raw network errors and stays usable.
 */
import type { ApiError, ChatRequest, ChatResponse, HealthResponse, SessionView } from "../../src/types"

const BASE = "/api"

export const MENSAJE_SIN_CONEXION = "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."
const MENSAJE_RESPUESTA_INESPERADA = "El servidor devolvió una respuesta inesperada. Inténtalo de nuevo."

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null
}

function esChatResponse(valor: unknown): valor is ChatResponse {
  return (
    esRegistro(valor) &&
    typeof valor.reply === "string" &&
    Array.isArray(valor.toolCalls) &&
    typeof valor.needsConfirmation === "boolean"
  )
}

function extraerApiError(valor: unknown): ApiError | null {
  if (!esRegistro(valor)) return null
  const error = valor.error
  if (esRegistro(error) && typeof error.codigo === "string" && typeof error.mensaje === "string") {
    return error as ApiError
  }
  return null
}

/** Builds a response-shaped error so the chat can show it like any other turn. */
function respuestaConError(mensaje: string): ChatResponse {
  return { reply: "", toolCalls: [], needsConfirmation: false, error: { codigo: "INTERNO", mensaje } }
}

/** POST /api/chat. Never rejects: network and server failures come back as `error`. */
export async function enviarMensaje(sessionId: string, message: string): Promise<ChatResponse> {
  const cuerpo: ChatRequest = { sessionId, message }
  let res: Response
  try {
    res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    return respuestaConError(MENSAJE_SIN_CONEXION)
  }

  const datos: unknown = await res.json().catch(() => null)
  if (esChatResponse(datos)) return datos
  return respuestaConError(extraerApiError(datos)?.mensaje ?? MENSAJE_RESPUESTA_INESPERADA)
}

/** GET /api/sessions/:id. Returns null for an unknown session (a brand-new chat has no history yet). */
export async function obtenerSesion(sessionId: string): Promise<SessionView | null> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const datos: unknown = await res.json()
  if (!esRegistro(datos) || !Array.isArray(datos.mensajes)) throw new Error("Historial con formato inválido")
  return datos as SessionView
}

/** GET /api/health. Only provider and model are shown; no keys ever reach the browser. */
export async function obtenerSalud(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const datos: unknown = await res.json()
  if (!esRegistro(datos) || typeof datos.provider !== "string" || typeof datos.model !== "string") {
    throw new Error("Estado del servidor con formato inválido")
  }
  return datos as HealthResponse
}
