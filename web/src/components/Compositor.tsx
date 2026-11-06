import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

type Props = {
  deshabilitado: boolean
  onEnviar: (texto: string) => void
}

/** Matches the API limit (ChatRequest.message max 4000) so the server never rejects a typed message. */
const LARGO_MAXIMO = 4000

/**
 * Message input. Enter sends and Shift+Enter adds a line, the usual chat
 * convention. It is disabled while the agent is working so turns never overlap.
 */
export function Compositor({ deshabilitado, onEnviar }: Props) {
  const [texto, setTexto] = useState("")
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const puedeEnviar = !deshabilitado && texto.trim().length > 0

  useEffect(() => {
    if (!deshabilitado) areaRef.current?.focus()
  }, [deshabilitado])

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!puedeEnviar) return
    onEnviar(texto)
    setTexto("")
  }

  function alPulsarTecla(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Ignore Enter while an IME is composing text (e.g. some Asian keyboards).
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault()
      evento.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="compositor" onSubmit={alEnviar}>
      <textarea
        ref={areaRef}
        className="compositor-campo"
        rows={1}
        maxLength={LARGO_MAXIMO}
        placeholder="Escribe una instrucción, por ejemplo: Procesa la solicitud sol-001"
        aria-label="Mensaje para el agente"
        value={texto}
        disabled={deshabilitado}
        onChange={(evento) => setTexto(evento.target.value)}
        onKeyDown={alPulsarTecla}
      />
      <button type="submit" className="btn btn-primario" disabled={!puedeEnviar}>
        Enviar
      </button>
    </form>
  )
}
