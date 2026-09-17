import { EMPTY_USAGE, LlmHttpError, LlmTimeoutError } from './llmClient.ts'
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from './llmClient.ts'
import { OPENROUTER_URL } from './llmSettings.ts'

// Plain fetch against OpenRouter's chat-completions endpoint (spec §3.4).
// No SDK: this file runs verbatim inside Deno edge functions. The system
// message goes first so a provider-side prompt cache can hit the primer;
// `usage.include` asks for the cost per call; the strict JSON schema is
// re-validated by planSchema.ts regardless of what the provider promises.
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

export class OpenRouterClient implements LlmClient {
  private readonly apiKey: string
  readonly model: string
  private readonly fetchImpl: typeof fetch
  private readonly url: string

  constructor(apiKey: string, model: string, fetchImpl: typeof fetch = fetch, url: string = OPENROUTER_URL) {
    this.apiKey = apiKey
    this.model = model
    this.fetchImpl = fetchImpl
    this.url = url
  }

  async complete(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const started = Date.now()
    let res: Response
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'FtD Card Game',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
          response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: req.schema } },
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          usage: { include: true },
        }),
      })
    } catch (e) {
      if (signal.aborted) throw new LlmTimeoutError()
      throw new LlmHttpError(0, e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) throw new LlmHttpError(res.status, `OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    let body: {
      choices?: { message?: { content?: unknown } }[]
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } }
    }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new LlmHttpError(res.status, 'OpenRouter answer was not JSON')
    }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new LlmHttpError(res.status, 'OpenRouter answer carried no message content')
    const u = body.usage
    const usage: LlmUsage = u
      ? { promptTokens: num(u.prompt_tokens), completionTokens: num(u.completion_tokens), cachedTokens: num(u.prompt_tokens_details?.cached_tokens), costUsd: num(u.cost) }
      : EMPTY_USAGE
    return { text, usage, latencyMs: Date.now() - started }
  }
}
