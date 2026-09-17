// The seam between the policy and any model provider (spec §3.4). The
// policy tests inject a fake; production injects OpenRouterClient. Errors
// are typed so the policy can file the right fallback reason.
export interface LlmRequest {
  system: string
  user: string
  schema: Record<string, unknown>
  maxTokens: number
  temperature: number
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
