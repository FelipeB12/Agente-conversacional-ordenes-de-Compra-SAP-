import { useCallback, useEffect, useRef, useState } from "react"
import type { HealthResponse, MensajeView } from "../../src/types"
import { enviarMensaje, obtenerSalud, obtenerSesion } from "./api"
import { BannerConfirmacion } from "./components/BannerConfirmacion"
import { Aviso } from "./components/Aviso"
import { BienvenidaRapida } from "./components/BienvenidaRapida"
import { Cabecera } from "./components/Cabecera"
import { Compositor } from "./components/Compositor"
import { IndicadorPensando, MensajeChat } from "./components/MensajeChat"

const CLAVE_SESION = "oc-agente.sessionId"

function nuevoSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // randomUUID is missing on non-secure origins (e.g. plain http on a LAN IP).
  return `sesion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** localStorage can throw (private mode, blocked storage). Then the session simply lives until reload. */
function leerSessionGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE_SESION)
  } catch {
    return null
  }
}

function guardarSessionId(id: string): void {
  try {
    localStorage.setItem(CLAVE_SESION, id)
  } catch {
    // Storage unavailable: the chat still works, it just starts fresh on reload.
  }
}

function obtenerSessionIdInicial(): string {
  const guardado = leerSessionGuardado()
  if (guardado) return guardado
  const id = nuevoSessionId()
  guardarSessionId(id)
  return id
}

/**
 * Single-screen chat. The server is the source of truth for history: every time
 * the session id changes we reload it, so a refresh shows the same conversation.
 * Errors never block the composer; the user can always retry.
 */
export function App() {
  const [sessionId, setSessionId] = useState(obtenerSessionIdInicial)
  const [mensajes, setMensajes] = useState<MensajeView[]>([])
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [avisoCarga, setAvisoCarga] = useState<string | null>(null)
  const [salud, setSalud] = useState<HealthResponse | "error" | null>(null)
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let activo = true
    obtenerSalud()
      .then((estado) => {
        if (activo) setSalud(estado)
      })
      .catch(() => {
        if (activo) setSalud("error")
      })
    return () => {
      activo = false
    }
  }, [])

  useEffect(() => {
    let activo = true
    setCargando(true)
    setAvisoCarga(null)
    obtenerSesion(sessionId)
      .then((sesion) => {
        if (activo) setMensajes(sesion?.mensajes ?? [])
      })
      .catch(() => {
        if (activo) {
          setMensajes([])
          setAvisoCarga("No se pudo cargar el historial de la conversación. Puedes seguir escribiendo.")
        }
      })
      .finally(() => {
        if (activo) setCargando(false)
      })
    return () => {
      activo = false
    }
  }, [sessionId])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [mensajes.length, enviando])

  const enviar = useCallback(
    async (texto: string) => {
      const limpio = texto.trim()
      if (!limpio || enviando || cargando) return

      setMensajes((previos) => [...previos, { rol: "user", texto: limpio, ts: new Date().toISOString() }])
      setEnviando(true)
      try {
        const respuesta = await enviarMensaje(sessionId, limpio)
        setMensajes((previos) => [
          ...previos,
          {
            rol: "assistant",
            texto: respuesta.reply,
            toolCalls: respuesta.toolCalls,
            needsConfirmation: respuesta.needsConfirmation,
            error: respuesta.error,
            ts: new Date().toISOString(),
          },
        ])
      } finally {
        setEnviando(false)
      }
    },
    [enviando, cargando, sessionId],
  )

  const nuevaSesion = useCallback(() => {
    const id = nuevoSessionId()
    guardarSessionId(id)
    setSessionId(id)
  }, [])

  const ultimo = mensajes[mensajes.length - 1]
  const requiereConfirmacion = !enviando && ultimo?.rol === "assistant" && ultimo.needsConfirmation === true

  return (
    <div className="app">
      <Cabecera salud={salud} deshabilitado={enviando} onNuevaSesion={nuevaSesion} />

      <main className="hilo" role="log" aria-live="polite">
        <div className="contenedor">
          {avisoCarga && <Aviso tipo="error">{avisoCarga}</Aviso>}
          {cargando && <p className="estado-carga">Cargando conversación…</p>}
          {!cargando && mensajes.length === 0 && <BienvenidaRapida deshabilitado={enviando} onElegir={enviar} />}
          {mensajes.map((mensaje, indice) => (
            <MensajeChat
              key={`${indice}-${mensaje.ts}`}
              mensaje={mensaje}
              destacado={requiereConfirmacion && indice === mensajes.length - 1}
            />
          ))}
          {enviando && <IndicadorPensando />}
          <div ref={finRef} />
        </div>
      </main>

      <footer className="pie">
        <div className="contenedor">
          {requiereConfirmacion && (
            <BannerConfirmacion
              deshabilitado={enviando}
              onConfirmar={() => void enviar("Confirmo")}
              onCancelar={() => void enviar("No, cancela")}
            />
          )}
          <Compositor deshabilitado={enviando || cargando} onEnviar={(texto) => void enviar(texto)} />
        </div>
      </footer>
    </div>
  )
}
