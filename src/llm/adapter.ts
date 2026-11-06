/**
 * LLM provider interface (PRD §6.1). The agent loop depends only on this file,
 * so switching providers means adding a sibling implementation, not touching the loop.
 */
import type { LlmErrorCodigo } from "../types.js"

export type { LlmAdapter, LlmMessage, LlmResponse, LlmToolCall, LlmToolSpec, LlmErrorCodigo } from "../types.js"

/**
 * Typed provider failure. Implementations throw only this, with a message that
 * is already safe to show in the chat (never includes the API key or raw headers).
 */
export class LlmError extends Error {
  constructor(
    readonly codigo: LlmErrorCodigo,
    message: string,
  ) {
    super(message)
    this.name = "LlmError"
  }
}
