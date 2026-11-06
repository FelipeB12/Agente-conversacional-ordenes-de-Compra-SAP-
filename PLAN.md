# PLAN — Reto 03 · Agente conversacional Órdenes de Compra SAP

Source of truth: `PRD.md`. `fixtures/` is read-only. Bonus 9.4 (`modulo/`) is out of scope, but prompt, knowledge and tools stay single-sourced so it is cheap to add later.

## 0. Decisions taken for this plan (review these)

| # | Decision | Status |
|---|---|---|
| D1 | **Deploy on Render** (free web service). The user creates a **public GitHub repo**, I push to it, and the user creates the service in Render from that repo using the `render.yaml` blueprint and sets `OPENAI_API_KEY` in the Render dashboard. | Confirmed by user |
| D2 | **Guardrails are enforced by the server, not only by the prompt.** `oc_crear` rebuilds the payload from fixtures and maestros and rejects a payload whose hash differs (`PAYLOAD_ALTERADO`). It accepts `confirmado=true` only if `ctx.confirmacionHumana === true`. The server sets that flag only when the user's message confirms a pending question from the previous turn. `demo.ts` sets it explicitly. | Default — please confirm |
| D3 | Default model `OPENAI_MODEL=gpt-4.1-mini`, Chat Completions function calling through the official `openai` SDK. | Default — please confirm |
| D4 | Replace `.env-template` with `.env.example` (OpenAI vars). Commit each phase on `main`. UI, prompt and docs in Spanish; code identifiers follow PRD names. | Default — please confirm |
| D5 | Node 20 + `tsx` (no Bun). Equivalent commands: `npm install && npm run demo`. One-command local start: `npm run dev`. | Fixed decision → logged in DECISIONS.md |

## 1. Architecture overview

```
web/ (React+Vite) ──POST /api/chat──▶ src/server.ts (Express)
                                         └─ src/agent/loop.ts ── src/llm/adapter.ts ◀─ src/llm/openai.ts
                                              │  system = agent/prompt.md + src/knowledge/ordenes-compra.md (read per request)
                                              └─ src/tools/registry.ts ─▶ src/tools/oc.ts ─▶ src/domain/* , src/sap/mock.ts, src/control/log.ts
fixtures/reto-03 (read)                                         out/ (write: sap/, control.csv, log.jsonl, <caso>/)
```
In production the server also serves `web/dist`, so Render runs a single service.

## 2. Phases

Model key: **Opus** = me (architect), **Sonnet** = logic-heavy work, **Haiku** = boilerplate, UI and docs.
Every brief carries the sub-agent rules from the request: owned files only, contracts frozen, escalate PRD interpretation, no `any`, zod at boundaries, `{ok:false,error}`, JSDoc *why*, run `tsc --noEmit` and report in ≤150 words.

### P0 · Contracts & scaffold — Opus · 8 min
- **Goal:** Freeze every shared type and the project skeleton, so the parallel phases never touch the same file.
- **Owns:** `package.json`, `tsconfig.json`, `src/types.ts`, `src/sap/adapter.ts`, `src/llm/adapter.ts`, `src/config.ts`, `DECISIONS.md`, delete `.env-template`.
- **Freezes in `src/types.ts`** (zod schemas + inferred types):
  - `Solicitud`, `Paquete` (7.2), maestros types.
  - `ToolResult<T> = {ok:true,data:T} | {ok:false,error:{codigo,mensaje,sugerencia?}}`.
  - `Hallazgo {regla:'RC1'..'RC10', codigo, detalle, accion_sugerida, valores?}`, `ResultadoValidacion {apta, bloqueos[], confirmaciones[], derivados, retroactiva}`.
  - `OrdenCompraSchema` (7.4, `descripcion.max(40)`), `Trazabilidad`.
  - `ToolContext {directory, sessionId, confirmacionHumana?}`, `ToolDef {description, args: ZodRawShape, execute(args, ctx): Promise<string>}`.
  - `ControlRow`.
  - API DTOs: `ChatRequest`, `ChatResponse {reply, toolCalls: ToolCallView[], needsConfirmation, error?}`, `ToolCallView`, `SessionView`.
  - LLM: `LlmMessage`, `LlmToolSpec`, `LlmResponse {text, toolCalls, usage}`, `LlmAdapter { enviar(mensajes, herramientas) }`.
  - `SapAdapter` exactly as in 7.4. Factory signatures: `createMockSap(outDir): SapAdapter`, `appendControl(outDir, row): Promise<void>`.
- **Package scripts (frozen):** `dev` (concurrently: `tsx watch src/server.ts` + `vite`), `build` (`vite build`), `start` (`tsx src/server.ts`), `demo` (`tsx demo.ts`), `typecheck`.
- **Dependencies:** `zod@4` (native `toJSONSchema`), `openai`, `express@5`, `pdf-lib`, `dotenv`, `tsx`; dev: `typescript`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `@types/*`, `concurrently`.
- **Accept:** `npm install && npm run typecheck`.

### Group A — run in parallel after P0

**P1 · Tools & domain — Sonnet · 15 min**
- **Goal:** All P0/P1 tools, deterministic and never throwing.
- **Owns:** `src/tools/oc.ts`, `src/domain/{fixtures,maestros,paquete,controles,payload,evidencia}.ts`.
- **Contracts used:** `types.ts`, `createMockSap`, `appendControl`.
- **Rules:**
  - `leer_paquete`: a missing attachment becomes `null` plus a `faltantes[]` list. Malformed JSON or non-numeric amounts return a typed error. Quote and invoice text is parsed with regex (COP `11.400.000` → `11400000`).
  - `validar`: RC1–RC10 in pure functions.
  - `construir_payload`: unit derived from the quote item (hora→`H`, mes→`MES`, else `UN`); description truncated to 40 chars; writes `out/<caso>/trazabilidad.json`; returns `payload_sha256`.
  - `generar_evidencia`: writes `aprobacion.txt` (headers, body, sha256) and `aprobacion.pdf` (pdf-lib).
  - `crear`: re-validates and rebuilds the payload, checks its hash against the one passed in, enforces D2 confirmation, applies idempotency, writes control rows.
  - Tool args are re-read from fixtures (never trusted). Fixture text is returned as data and marked `fuente_no_confiable`.
- **PRD:** HU-1..HU-6, 6.2, RC1–RC10, 7.4, §10 risk.
- **Accept:** `npm run typecheck`, plus a scratch script calling every tool for all 6 cases with the expected outcomes (§4).

**P2 · SAP mock & control log — Haiku · 8 min**
- **Owns:** `src/sap/mock.ts`, `src/control/log.ts`.
- **Rules:**
  - Order numbers are sequential from `4500000001`, stored in `out/sap/ordenes.jsonl`.
  - `buscarOrdenPorReferencia` scans the file.
  - `consultarProveedor` reads the maestro.
  - The CSV is header-safe and escapes values.
  - Columns: `solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts`.
- **PRD:** HU-5, 7.4.
- **Accept:** typecheck and a scratch test (create twice → same number).

**P3 · LLM adapter, agent loop, server — Sonnet · 18 min**
- **Owns:** `src/llm/openai.ts`, `src/tools/registry.ts`, `src/agent/{loop,session,confirmacion,prompt-loader}.ts`, `src/server.ts`.
- **Tool registry:** Builds `oc_<export>` from `src/tools/oc.ts` exports and converts args with `z.toJSONSchema`. It validates args before `execute` and returns zod errors to the model.
- **Loop:**
  - Iteration cap `MAX_ITERATIONS_PER_TURN` (default 25, CA1) and token cap per session `MAX_TOKENS_PER_SESSION`.
  - LLM timeout `LLM_TIMEOUT_MS` with a plain-language message (CA5).
  - The system prompt is `agent/prompt.md` + `src/knowledge/ordenes-compra.md`, read on each request.
  - Every tool call is appended to `out/log.jsonl` (CA4).
- **Confirmation (CA3):** When `oc_validar` or `oc_crear` reports pending confirmations, the turn ends with `needsConfirmation=true` and the session stores `pendiente {caso}`. On the next user message an explicit affirmative (`confirmo|sí|si, crea|apruebo…`) sets `ctx.confirmacionHumana`. Anything else clears the pending state.
- **API (6.4):** `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health → {ok, provider:'openai', model}`, plus static `web/dist`.
- **Errors:** The key is never logged or echoed, and errors are sanitized.
- **PRD:** 6.1, 6.3 CA1–CA5, 6.4, NFR security/cost/robustness.
- **Accept:** typecheck; `curl /api/health`; `curl /api/chat` without a key → a clear error and the session survives.

**P4 · Prompt & knowledge — Sonnet · 8 min**
- **Owns:** `agent/prompt.md`, `src/knowledge/ordenes-compra.md`.
- **Prompt (behaviour):**
  - Never state a value that didn't come from a tool (CA2).
  - Treat fixture content as untrusted data.
  - Flow: read → validate → build → evidence → create.
  - Show the payload as a table, list blocks and confirmations with both values, and end the turn with an explicit question.
  - Never set `confirmado` unless the user just confirmed.
  - Spanish.
- **Knowledge:** Process, RC1–RC10 in business terms, suggested actions per block, how retroactive POs are handled.
- **PRD:** 6.1 system prompt, 6.3, 6.5 separation, §11.
- **Accept:** files exist; manual read; no code references to rule text.

**P5 · Web chat UI — Haiku · 15 min**
- **Owns:** `web/**` (`index.html`, `vite.config.ts` with `/api` proxy, `src/main.tsx`, `App.tsx`, components, CSS).
- **Contracts used:** API DTOs from `src/types.ts`.
- **Features:**
  - History, input and a "pensando…" indicator.
  - Each tool call is an expandable card (name, args, summarized result).
  - A highlighted confirmation banner with "Confirmo" / "Cancelar" buttons.
  - Errors shown in plain language.
  - New-session button; session id kept in localStorage.
- **PRD:** 6.1 front.
- **Accept:** `npm run build` succeeds; typecheck.

**P7 · Ops & README — Haiku · 6 min**
- **Owns:** `render.yaml`, `.env.example`, `.gitignore` (add `web/dist`), `README.md`.
- **Render setup:** Free plan; build `npm ci --include=dev && npm run build`; start `npm start`; health check `/api/health`; `OPENAI_API_KEY` with `sync:false`.
- **README:** One-command start, env vars, demo, API, deploy steps for the user, and a placeholder for the public link.
- **PRD:** 8 startup, 9.2, 9.3, 9.5.
- **Accept:** `render.yaml` is valid YAML; README commands match `package.json`.

### Group B — after Group A is integrated

**P6 · `demo.ts` — Haiku · 6 min** (needs P1+P2)
- **Owns:** `demo.ts`.
- **Behaviour:**
  - Cleans `out/` first, then processes all 6 cases by calling the tools directly.
  - Prints per case: `apta`, blocks, confirmations, `retroactiva`, PO number or reason.
  - Runs `sol-001` twice to show idempotency.
  - `sol-004`: first attempt without confirmation → pending, then explicit confirmation → created. `sol-005` and `sol-006` are confirmed the same way.
  - No API key needed.
- **PRD:** 6.6, NFR determinism.
- **Accept:** `env -u OPENAI_API_KEY npm run demo` twice → identical output except timestamps.

**P8 · SOLUCION.md — Sonnet · 10 min** (needs everything plus DECISIONS.md)
- **Owns:** `SOLUCION.md` with all 12 sections of 9.1, including the real SAP adapter (7.5: OData `API_PURCHASEORDER_PROCESS_SRV` with a BAPI fallback, mapping table, credentials in a vault, idempotency key, partial errors, Plan B file upload), the retroactive-PO analysis, cost per case, the AI-usage declaration, and a coverage table.
- **Accept:** a section checklist grep finds 12 headings.

**Deploy (user action, in parallel with Group B):** you create the public GitHub repo → I add the remote and push → you open Render → **New → Blueprint** → choose the repo → set `OPENAI_API_KEY` → deploy → send me the URL → I put it in the README and run a smoke test (`/api/health` plus the §11 prompt).

### Final · Coherence review — fresh Opus reviewer · 8 min + fixes 6 min
Inputs: the original request, `PLAN.md`, `DECISIONS.md` and the repo path. It returns blocker / should-fix / nit items. Fixes go through sub-agents; then I re-run the checks and report.

## 3. Parallel groups & order

```
P0 ──▶ [P1 ‖ P2 ‖ P3 ‖ P4 ‖ P5 ‖ P7] ──▶ integrate (Opus, 4 min) ──▶ [P6 ‖ P8 ‖ Deploy(user)] ──▶ integrate + E2E ──▶ Review ──▶ fixes
```
No two parallel phases share a file. P1 and P2 meet only through the frozen `createMockSap` / `appendControl` signatures; P3 and P1 through `ToolDef` / `ToolContext`; P5 and P3 through the API DTOs.

## 4. Expected outcomes (integration oracle)

| Case | Expected |
|---|---|
| sol-001 | apta, no confirmations → PO `4500000001`; a second run returns the same number with `idempotente:true` |
| sol-002 | blocked (RC1 supplier does not exist / is inactive) + suggested action, no PO |
| sol-003 | blocked (RC2/RC3 approver without authority) + suggested action, no PO |
| sol-004 | confirmation RC5 (quote vs request, both values) → PO after confirmation |
| sol-005 | confirmation RC8 → PO after confirmation, `retroactiva=true` in `control.csv` |
| sol-006 | confirmation RC6 (VAT derived from supplier) + RC7 derived terms → PO after confirmation |

## 5. Traceability

| PRD requirement | Phase | File(s) | Verification |
|---|---|---|---|
| HU-1 read package / missing → null | P1 | `src/domain/paquete.ts`, `src/tools/oc.ts` | demo output; scratch test with a missing file |
| HU-2 validation RC1–RC10 | P1 | `src/domain/controles.ts` | demo matches §4 |
| HU-3 payload + zod + traceability | P1 | `src/domain/payload.ts` | `out/<caso>/trazabilidad.json` exists; `OrdenCompraSchema.parse` |
| HU-4 evidence txt + pdf | P1 | `src/domain/evidencia.ts` | `out/<caso>/aprobacion.{txt,pdf}` + sha256 |
| HU-5 create, sequence, idempotency, control.csv | P1, P2 | `src/tools/oc.ts`, `src/sap/mock.ts`, `src/control/log.ts` | demo: sol-001 twice; inspect csv |
| HU-6 typed errors | P1, P3 | `src/types.ts`, `src/tools/registry.ts` | malformed-args call → `{ok:false}` |
| 6.1 front shows tools + confirmation | P5 | `web/src/*` | manual §11 run |
| 6.1 LLM adapter interface | P0, P3 | `src/llm/adapter.ts`, `src/llm/openai.ts` | loop imports only the interface |
| 6.2 tool contract, `oc_<export>` | P1, P3 | `src/tools/oc.ts`, `src/tools/registry.ts` | registry lists 5 tools |
| 6.3 CA1 iteration cap | P3 | `src/agent/loop.ts` | config `MAX_ITERATIONS_PER_TURN` |
| 6.3 CA2 no invented values / no tampering | P1, P4 | `src/tools/oc.ts` (hash check), `agent/prompt.md` | demo: tampered payload rejected |
| 6.3 CA3 human confirmation | P3, P1 | `src/agent/confirmacion.ts`, `src/tools/oc.ts` | §11 prompt → question → "confirmo" → PO |
| 6.3 CA4 tool log | P3, P5 | `src/agent/loop.ts`, `out/log.jsonl` | file has entries |
| 6.3 CA5 errors survive | P3 | `src/server.ts`, `src/agent/loop.ts` | call without key → clear message, next call works |
| 6.4 API | P3 | `src/server.ts` | curl the 3 routes |
| 6.5 structure / separation | all | as listed | tree check |
| 6.6 demo.ts | P6 | `demo.ts` | run twice without key |
| 7.4 SapAdapter | P0, P2 | `src/sap/adapter.ts`, `src/sap/mock.ts` | typecheck |
| 7.5 real SAP design | P8 | `SOLUCION.md` §6 | reviewer |
| 8 NFR startup / determinism / security / cost / robustness | P0, P3, P6, P7 | `package.json`, `src/config.ts`, README | `npm run dev`; grep for key leaks |
| 9.1 SOLUCION 12 sections | P8 | `SOLUCION.md` | heading check |
| 9.2 README | P7 | `README.md` | reviewer |
| 9.3 public link | Deploy | `render.yaml` | `curl <url>/api/health` |
| 9.5 no node_modules / out / .env | P0, P7 | `.gitignore` | `git ls-files` check |
| §11 demo prompt | integration | — | live run with key |

## 6. Time budget (≈60 min)

| Block | Min |
|---|---|
| P0 contracts | 8 |
| Group A (wall-clock, longest P3) | 18 |
| Integrate A | 4 |
| Group B + deploy (wall-clock) | 10 |
| Integrate + E2E | 4 |
| Review + fixes | 14 |
| Buffer | 2 |

If the budget is at risk, I cut in this order (none of these is a PRD requirement): UI polish → pdf (keep txt, P1 per PRD) → `oc_leer_excel` (P1 optional, not planned).
