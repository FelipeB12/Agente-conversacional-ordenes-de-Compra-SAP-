import type { HealthResponse } from "../../../src/types"

type Props = {
  salud: HealthResponse | "error" | null
  deshabilitado: boolean
  onNuevaSesion: () => void
}

/**
 * Top bar. Shows the provider and model so the reviewer can see which LLM is
 * behind the agent; the health endpoint never exposes keys, so this is safe.
 * "Nueva sesión" is disabled mid-turn so a late reply can't land in a new chat.
 */
export function Cabecera({ salud, deshabilitado, onNuevaSesion }: Props) {
  let subtitulo = "Conectando con el servidor…"
  if (salud === "error") subtitulo = "Servidor no disponible"
  else if (salud) subtitulo = `${salud.provider} · ${salud.model}`

  return (
    <header className="cabecera">
      <div className="contenedor cabecera-interior">
        <div className="marca">
          <span className="marca-icono" aria-hidden="true">
            OC
          </span>
          <div>
            <h1 className="marca-titulo">Agente Órdenes de Compra SAP</h1>
            <p className="marca-subtitulo">{subtitulo}</p>
          </div>
        </div>
        <button type="button" className="btn btn-secundario" onClick={onNuevaSesion} disabled={deshabilitado}>
          Nueva sesión
        </button>
      </div>
    </header>
  )
}
