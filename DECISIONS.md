# DECISIONS

Non-critical decisions taken during the build. Feeds SOLUCION.md §8 (trade-offs) and §11 (AI usage).
Format: decision · alternative rejected · why.

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D1 | Deploy on Render (free web service, `render.yaml` blueprint) from a public GitHub repo. | Fly.io / Railway / tunnel | User choice; one service serves API + built UI, no card needed. |
| D2 | Guardrails enforced server-side: `oc_crear` rebuilds the payload from fixtures and rejects hash mismatches (`PAYLOAD_ALTERADO`); `confirmado=true` is honoured only when `ctx.confirmacionHumana` is set by the server after an explicit user confirmation. | Trust the `confirmado` arg and the model-supplied payload. | PRD §10 risk ("model fixes an amount") and CA3: the prompt forbids it, the design makes it impossible. |
| D3 | OpenAI `gpt-4.1-mini` via Chat Completions function calling, behind `LlmAdapter`. | Larger model / Responses API | Cheap, reliable tool calling; the model never computes values, so reasoning depth matters less. |
| D4 | `.env-template` replaced by `.env.example`; phases committed on `main`; UI/docs in Spanish. | Keep both env files / feature branch | PRD names `.env.example`; history is part of the deliverable. |
| D5 | Node 20+ with `tsx` instead of Bun; `npm run demo` ≡ `bun run demo.ts`. | Bun | Fixed decision of the build; same TS sources run unchanged. |
| D6 | All shared types and zod schemas in `src/types.ts`; `src/sap/adapter.ts` and `src/llm/adapter.ts` re-export them at the PRD paths. | Types spread per module | Lets parallel phases build against one frozen contract. |
| D7 | Tool args `paquete` / `derivados` / `payload` are accepted as loose records and treated as untrusted; tools always re-read fixtures. | Strict `PaqueteSchema` as tool arg | The model re-serializing a big object must not break the loop, and its copy must never be the source of truth. |
| D8 | `Paquete` gains additive fields `faltantes[]`, `cotizacion.referencia`, `aprobacion.para/asunto`. | Stick to the exact 7.2 shape | HU-1 needs to name missing attachments; payload needs `cotizacion_ref`; evidence needs de/para/fecha/asunto headers. |
| D9 | TypeScript 7, zod 4 (`z.toJSONSchema` for tool specs), Express 5, React 19 + Vite. | zod-to-json-schema, Hono | Current stable versions; fewer dependencies. |
