import { describe, expect, it } from 'vitest'
import { LlmHttpError, LlmTimeoutError } from './llmClient'
import { OPENROUTER_URL } from './llmSettings'
import { OpenRouterClient } from './openRouterClient'

const req = {
  messages: [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'usr' }],
  schema: { type: 'object' }, schemaName: 'plan', maxTokens: 50, temperature: 0.5,
}

function fetchReturning(status: number, body: unknown, capture: { init?: RequestInit; url?: string } = {}): typeof fetch {
  return (async (url, init) => {
    capture.url = String(url)
    capture.init = init
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

describe('OpenRouterClient', () => {
  it('posts a structured-output chat completion and reads content + usage', async () => {
    const capture: { init?: RequestInit; url?: string } = {}
    const client = new OpenRouterClient('sk-test', 'inception/mercury-2.5', fetchReturning(200, {
      choices: [{ message: { content: '{"plan":[1]}' } }],
      usage: { prompt_tokens: 5000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 4000 }, cost: 0.00021 },
    }, capture))
    const res = await client.complete(req, new AbortController().signal)
    expect(res.text).toBe('{"plan":[1]}')
    expect(res.usage).toEqual({ promptTokens: 5000, completionTokens: 40, cachedTokens: 4000, costUsd: 0.00021 })
    expect(capture.url).toBe(OPENROUTER_URL)
    const headers = capture.init!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(capture.init!.body as string)
    expect(body.model).toBe('inception/mercury-2.5')
    expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }])
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: { type: 'object' } } })
    expect(body.max_tokens).toBe(50)
    expect(body.temperature).toBe(0.5)
    expect(body.usage).toEqual({ include: true })
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('provider')
  })
  it('sends the whole message history and the schema name it is given', async () => {
    const capture: { init?: RequestInit } = {}
    const client = new OpenRouterClient('k', 'm', fetchReturning(200, { choices: [{ message: { content: '{}' } }] }, capture))
    const messages = [
      { role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: '{"actions":[1]}' }, { role: 'user' as const, content: 'u2' },
    ]
    await client.complete({ ...req, messages, schemaName: 'answer' }, new AbortController().signal)
    const body = JSON.parse(capture.init!.body as string)
    expect(body.messages).toEqual(messages)
    expect(body.response_format.json_schema.name).toBe('answer')
  })
  it('sends the routing preferences as OpenRouter\'s provider object', async () => {
    const capture: { init?: RequestInit } = {}
    const client = new OpenRouterClient('k', 'deepseek/deepseek-v4.1-flash', fetchReturning(200, { choices: [{ message: { content: '{}' } }] }, capture))
    await client.complete({ ...req, routing: { sort: 'throughput', require_parameters: true, only: ['modal'] } }, new AbortController().signal)
    expect(JSON.parse(capture.init!.body as string).provider).toEqual({ sort: 'throughput', require_parameters: true, only: ['modal'] })
  })
  it('sends OpenRouter\'s unified reasoning field only when the request names an effort', async () => {
    const capture: { init?: RequestInit } = {}
    const client = new OpenRouterClient('k', 'deepseek/deepseek-v4-flash', fetchReturning(200, { choices: [{ message: { content: '{}' } }] }, capture))
    await client.complete({ ...req, reasoningEffort: 'high' }, new AbortController().signal)
    expect(JSON.parse(capture.init!.body as string).reasoning).toEqual({ effort: 'high' })
    await client.complete({ ...req, reasoningEffort: 'none' }, new AbortController().signal)
    expect(JSON.parse(capture.init!.body as string).reasoning).toEqual({ effort: 'none' })
  })
  it('reports missing usage as nulls', async () => {
    const client = new OpenRouterClient('k', 'm', fetchReturning(200, { choices: [{ message: { content: 'x' } }] }))
    const res = await client.complete(req, new AbortController().signal)
    expect(res.usage).toEqual({ promptTokens: null, completionTokens: null, cachedTokens: null, costUsd: null })
  })
  it('throws LlmHttpError on a non-2xx and on a body without content', async () => {
    await expect(new OpenRouterClient('k', 'm', fetchReturning(429, 'slow down')).complete(req, new AbortController().signal))
      .rejects.toBeInstanceOf(LlmHttpError)
    await expect(new OpenRouterClient('k', 'm', fetchReturning(200, { choices: [] })).complete(req, new AbortController().signal))
      .rejects.toBeInstanceOf(LlmHttpError)
  })
  it('throws LlmTimeoutError when the signal aborts the fetch', async () => {
    const hanging = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch
    const ac = new AbortController()
    const pending = new OpenRouterClient('k', 'm', hanging).complete(req, ac.signal)
    ac.abort()
    await expect(pending).rejects.toBeInstanceOf(LlmTimeoutError)
  })
  it('throws LlmHttpError with status 0 when fetch rejects without abort', async () => {
    const failing = ((_url: unknown, _init?: RequestInit) => {
      throw new TypeError('network down')
    }) as typeof fetch
    try {
      await new OpenRouterClient('k', 'm', failing).complete(req, new AbortController().signal)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(LlmHttpError)
      expect((e as LlmHttpError).status).toBe(0)
    }
  })
  it('throws LlmHttpError for non-JSON 2xx response', async () => {
    const client = new OpenRouterClient('k', 'm', fetchReturning(200, 'not json'))
    await expect(client.complete(req, new AbortController().signal)).rejects.toBeInstanceOf(LlmHttpError)
  })
})
