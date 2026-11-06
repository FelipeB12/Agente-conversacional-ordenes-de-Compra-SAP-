type Props = {
  deshabilitado: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

/**
 * Shown when the agent waits for a human decision before creating the order.
 * The buttons send plain chat messages ("Confirmo" / "No, cancela"), so the
 * decision goes through the same path as typing it, and the server's guardrails
 * apply unchanged.
 */
export function BannerConfirmacion({ deshabilitado, onConfirmar, onCancelar }: Props) {
  return (
    <section className="banner" aria-label="Confirmación requerida">
      <div className="banner-texto">
        <strong>El agente necesita tu confirmación</strong>
        <span>Revisa la propuesta de la orden de compra y decide si se crea.</span>
      </div>
      <div className="banner-acciones">
        <button type="button" className="btn btn-primario" onClick={onConfirmar} disabled={deshabilitado}>
          Confirmo
        </button>
        <button type="button" className="btn btn-secundario" onClick={onCancelar} disabled={deshabilitado}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
