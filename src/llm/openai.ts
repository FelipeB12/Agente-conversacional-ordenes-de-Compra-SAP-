/**
 * OpenAI Chat Completions implementation of LlmAdapter. Isolated here so the
 * agent loop never sees provider types; swapping providers = a sibling file.
 */
import OpenAI from "openai"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions"
import { LlmError } from "./adapter.js"
import type { LlmAdapter, LlmMessage, LlmResponse, LlmToolSpec } from "./adapter.js"

function aOpenAi(m: LlmMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content }
    case "user":
      return { role: "user", content: m.content }
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
    case "assistant":
      return m.toolCalls && m.toolCalls.length > 0
        ? {
            role: "assistant",
            content: m.content,
            tool_calls: m.toolCalls.map((t) => ({
              id: t.id,
              type: "function" as const,
              function: { name: t.name, arguments: t.argumentos },
            })),
          }
        : { role: "assistant", content: m.content ?? "" }
  }
}

function traducirError(e: unknown): LlmError {
  if (e instanceof LlmError) return e
  const status = typeof e === "object" && e !== null && "status" in e ? (e as { status?: unknown }).status : undefined
  const name = e instanceof Error ? e.name : ""
  if (name === "AbortError" || name === "APIUserAbortError" || name === "APIConnectionTimeoutError" || name === "TimeoutError")
    return new LlmError("TIMEOUT", "El modelo tardó demasiado en responder. Intenta de nuevo en un momento.")
  if (status === 401 || status === 403)
    return new LlmError("AUTH", "La clave de OpenAI fue rechazada. Revisa OPENAI_API_KEY.")
  if (status === 429)
    return new LlmError("RATE_LIMIT", "OpenAI está limitando las solicitudes (límite de uso). Espera un momento e intenta de nuevo.")
  return new LlmError("PROVEEDOR", "El proveedor del modelo no pudo procesar la solicitud. Intenta de nuevo.")
}

/** Builds the adapter lazily: the client is created per call so a missing key doesn't stop the server booting. */
export function createOpenAiAdapter(opts: { apiKey?: string; model: string; timeoutMs: number }): LlmAdapter {
  let client: OpenAI | null = null
  return {
    provider: "openai",
    model: opts.model,
    async enviar(mensajes, herramientas: LlmToolSpec[], opciones): Promise<LlmResponse> {
      if (!opts.apiKey)
        throw new LlmError("SIN_CLAVE", "Falta configurar OPENAI_API_KEY en el servidor, por lo que no puedo contactar al modelo.")
      try {
        client ??= new OpenAI({ apiKey: opts.apiKey, maxRetries: 1 })
        const timeout = AbortSignal.timeout(opts.timeoutMs)
        const signal = opciones?.signal ? AbortSignal.any([timeout, opciones.signal]) : timeout
        const tools: ChatCompletionTool[] = herramientas.map((h) => ({
          type: "function",
          function: { name: h.name, description: h.description, parameters: h.parameters },
        }))
        const res = await client.chat.completions.create(
          {
            model: opts.model,
            messages: mensajes.map(aOpenAi),
            ...(tools.length > 0 ? { tools } : {}),
          },
          { signal },
        )
        const msg = res.choices[0]?.message
        const toolCalls = (msg?.tool_calls ?? []).flatMap((t) =>
          t.type === "function" ? [{ id: t.id, name: t.function.name, argumentos: t.function.arguments }] : [],
        )
        return {
          texto: msg?.content ?? null,
          toolCalls,
          uso: { entrada: res.usage?.prompt_tokens ?? 0, salida: res.usage?.completion_tokens ?? 0 },
        }
      } catch (e) {
        throw traducirError(e)
      }
    },
  }
}
