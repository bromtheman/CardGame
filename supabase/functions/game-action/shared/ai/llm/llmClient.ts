import type { OpenRouterRouting, ReasoningEffort } from './llmSettings.ts'

// The seam between the policy and any model provider (spec §3.4). The
// policy tests inject a fake; production injects OpenRouterClient. Errors
// are typed so the policy can file the right fallback reason.
export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage { role: ChatRole; content: string }
export interface LlmRequest {
  messages: ChatMessage[]             // the primer first; the sectioned flow appends a whole history
  schema: Record<string, unknown>
  schemaName: string                  // response_format's json_schema.name: 'plan' or 'answer'
  maxTokens: number
  temperature: number
  reasoningEffort?: ReasoningEffort   // absent: the model's own default
  routing?: OpenRouterRouting         // OpenRouter's provider preferences; absent: its default routing
}
export interface LlmUsage {
  promptTokens: number | null
  completionTokens: number | null
  cachedTokens: number | null
  costUsd: number | null
}
export interface LlmResponse { text: string; usage: LlmUsage; latencyMs: number }
export interface LlmClient {
  readonly model: string
  complete(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>
}
export const EMPTY_USAGE: LlmUsage = { promptTokens: null, completionTokens: null, cachedTokens: null, costUsd: null }

export class LlmHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'LlmHttpError'
    this.status = status
  }
}
export class LlmTimeoutError extends Error {
  constructor(message = 'model call timed out') { super(message); this.name = 'LlmTimeoutError' }
}
