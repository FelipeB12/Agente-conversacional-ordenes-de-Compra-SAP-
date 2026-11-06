import type { ReactNode } from "react"

type Props = {
  tipo: "error" | "info"
  children: ReactNode
}

/**
 * Inline notice. Errors use role="alert" so screen readers announce them at once;
 * they are plain sentences, never raw stack traces or payloads.
 */
export function Aviso({ tipo, children }: Props) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      {children}
    </div>
  )
}
