type Props = {
  deshabilitado: boolean
  onElegir: (texto: string) => void
}

const SOLICITUDES = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]

/** The PRD §11 demo prompt, sent verbatim so the demo is reproducible from the UI. */
const PROMPT_DEMO =
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.'

/**
 * Empty-chat state. Quick-start chips remove the blank-page problem for the
 * reviewer: one click runs a case, and the demo prompt reproduces PRD §11.
 */
export function BienvenidaRapida({ deshabilitado, onElegir }: Props) {
  return (
    <section className="bienvenida">
      <h2>¿Qué solicitud quieres procesar?</h2>
      <p>
        El agente lee la solicitud, valida el paquete contra los maestros, prepara la orden de compra y pide tu
        confirmación antes de crearla en SAP.
      </p>
      <div className="chips">
        {SOLICITUDES.map((caso) => (
          <button
            key={caso}
            type="button"
            className="chip"
            disabled={deshabilitado}
            onClick={() => onElegir(`Procesa la solicitud ${caso}`)}
          >
            Procesa la solicitud {caso}
          </button>
        ))}
      </div>
      <p className="bienvenida-subtitulo">Ejemplo de demo</p>
      <button type="button" className="chip chip-ancho" disabled={deshabilitado} onClick={() => onElegir(PROMPT_DEMO)}>
        {PROMPT_DEMO}
      </button>
    </section>
  )
}
