import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles.css"

const contenedor = document.getElementById("root")
if (!contenedor) throw new Error("Falta el elemento #root en index.html")

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
