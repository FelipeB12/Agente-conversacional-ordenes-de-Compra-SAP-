/** HTTP server: chat API plus the built web UI. Keeps all agent logic out of the transport layer. */
import express from "express"
import { existsSync } from "node:fs"
import path from "node:path"
import { procesarMensaje } from "./agent/loop.js"
import { verSession } from "./agent/session.js"
import { config, PROJECT_ROOT } from "./config.js"
import { createOpenAiAdapter } from "./llm/openai.js"
import * as ocTools from "./tools/oc.js"
import { buildRegistry } from "./tools/registry.js"
import { ChatRequestSchema } from "./types.js"
import type { ApiError, ChatResponse, HealthResponse } from "./types.js"

const llm = createOpenAiAdapter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, timeoutMs: config.LLM_TIMEOUT_MS })
const registry = buildRegistry({ oc: ocTools })

const app = express()
app.use(express.json({ limit: "100kb" }))

app.post("/api/chat", async (req, res) => {
  const p = ChatRequestSchema.safeParse(req.body)
  if (!p.success) {
    const error: ApiError = { codigo: "SOLICITUD_INVALIDA", mensaje: "Solicitud inválida: se requiere sessionId y message (1-4000 caracteres)." }
    res.status(400).json({ error })
    return
  }
  const out: ChatResponse = await procesarMensaje(p.data.sessionId, p.data.message, { llm, registry })
  res.json(out)
})

app.get("/api/sessions/:id", (req, res) => {
  res.json(verSession(String(req.params.id)))
})

app.get("/api/health", (_req, res) => {
  const body: HealthResponse = { ok: true, provider: llm.provider, model: llm.model }
  res.json(body)
})

const dist = path.join(PROJECT_ROOT, "web", "dist")
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"))
  })
}

// Malformed JSON / oversized body -> same error shape as validation failures.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void err
  const error: ApiError = { codigo: "SOLICITUD_INVALIDA", mensaje: "No pude leer la solicitud (JSON inválido o demasiado grande)." }
  res.status(400).json({ error })
})

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`API escuchando en http://localhost:${config.PORT} (${llm.provider}/${llm.model})`)
})
