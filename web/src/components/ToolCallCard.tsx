import { useId, useState } from "react"
import type { ToolCallView } from "../../../src/types"

type Props = {
  llamada: ToolCallView
}

function formatearJson(valor: unknown): string {
  return JSON.stringify(valor, null, 2) ?? "undefined"
}

function formatearDuracion(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * Compact, collapsed-by-default card for one tool call. Showing name, status and
 * summary keeps the chat readable; expanding reveals the exact arguments and
 * result so every value the agent states can be traced back to a tool output.
 */
export function ToolCallCard({ llamada }: Props) {
  const [abierta, setAbierta] = useState(false)
  const idDetalle = useId()

  return (
    <div className={`tool ${llamada.ok ? "tool-ok" : "tool-fallo"}`}>
      <button
        type="button"
        className="tool-cabecera"
        aria-expanded={abierta}
        aria-controls={idDetalle}
        onClick={() => setAbierta((valor) => !valor)}
      >
        <span className="tool-estado" aria-label={llamada.ok ? "Correcta" : "Con error"}>
          {llamada.ok ? "✓" : "✗"}
        </span>
        <code className="tool-nombre">{llamada.nombre}</code>
        <span className="tool-resumen">{llamada.resumen}</span>
        <span className="tool-duracion">{formatearDuracion(llamada.duracion_ms)}</span>
        <span className="tool-flecha" aria-hidden="true">
          {abierta ? "▾" : "▸"}
        </span>
      </button>
      {abierta && (
        <div id={idDetalle} className="tool-detalle">
          <h4>Argumentos</h4>
          <pre>{formatearJson(llamada.argumentos)}</pre>
          <h4>Resultado</h4>
          <pre>{formatearJson(llamada.resultado)}</pre>
        </div>
      )}
    </div>
  )
}
