import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { MensajeView } from "../../../src/types"
import { Aviso } from "./Aviso"
import { ToolCallCard } from "./ToolCallCard"

type Props = {
  mensaje: MensajeView
  /** True for the latest agent turn when it is waiting for confirmation. */
  destacado: boolean
}

function formatearHora(ts: string): string {
  const fecha = new Date(ts)
  if (Number.isNaN(fecha.getTime())) return ""
  return fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
}

/**
 * One turn of the conversation. Agent turns list their tool calls above the
 * answer: the reviewer should see what the agent actually ran before reading
 * what it claims. The answer is Markdown without raw HTML, so model output
 * cannot inject markup.
 */
export function MensajeChat({ mensaje, destacado }: Props) {
  const hora = formatearHora(mensaje.ts)

  if (mensaje.rol === "user") {
    return (
      <div className="fila fila-usuario">
        <div className="burbuja burbuja-usuario">{mensaje.texto}</div>
        {hora && <time className="hora" dateTime={mensaje.ts}>{hora}</time>}
      </div>
    )
  }

  const llamadas = mensaje.toolCalls ?? []
  return (
    <div className="fila fila-agente">
      {llamadas.length > 0 && (
        <div className="llamadas">
          {llamadas.map((llamada) => (
            <ToolCallCard key={llamada.id} llamada={llamada} />
          ))}
        </div>
      )}
      {mensaje.texto && (
        <div className={`burbuja burbuja-agente${destacado ? " destacada" : ""}`}>
          <div className="md">
            <Markdown remarkPlugins={[remarkGfm]}>{mensaje.texto}</Markdown>
          </div>
        </div>
      )}
      {mensaje.error && <Aviso tipo="error">{mensaje.error.mensaje}</Aviso>}
      {hora && <time className="hora" dateTime={mensaje.ts}>{hora}</time>}
    </div>
  )
}

/** Shown while a request is in flight. The composer is disabled at the same time. */
export function IndicadorPensando() {
  return (
    <div className="fila fila-agente" role="status">
      <div className="burbuja burbuja-agente pensando">
        <span className="puntos" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>pensando…</span>
      </div>
    </div>
  )
}
