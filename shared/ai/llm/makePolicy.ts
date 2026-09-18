import { basicPolicy } from '../basicPolicy.ts'
import { DEFAULT_LLM_POLICY_SETTINGS, LlmPolicy } from './llmPolicy.ts'
import { DEFAULT_BOT_MODEL, MODEL_REASONING_EFFORT, MODEL_ROUTING, REASONING_EFFORTS } from './llmSettings.ts'
import type { OpenRouterRouting, ReasoningEffort } from './llmSettings.ts'
import { OpenRouterClient } from './openRouterClient.ts'

// Env → policy (spec §3.4). No key, or the kill switch, means the heuristic
// plays through a disabled LlmPolicy — one wiring path, and the fallback is
// visible in telemetry. Both functions call this; nothing else constructs a
// policy in production.
export interface BotEnv {
  OPENROUTER_API_KEY?: string
  BOT_MODEL?: string
  BOT_LLM_DISABLED?: string
  BOT_REASONING_EFFORT?: string
  BOT_PROVIDERS?: string
}

// BOT_REASONING_EFFORT, when it names a level, beats the model's row in
// MODEL_REASONING_EFFORT; anything else (unset, blank, a typo) leaves the
// model's own default standing rather than silently switching reasoning off.
export function reasoningEffortFor(model: string, override?: string): ReasoningEffort | undefined {
  const wanted = (override ?? '').trim().toLowerCase()
  const level = REASONING_EFFORTS.find((e) => e === wanted)
  return level ?? MODEL_REASONING_EFFORT[model]
}

// BOT_PROVIDERS is a comma-separated list of OpenRouter provider slugs; when
// it names any, they become an `only` pin on top of the model's row in
// MODEL_ROUTING (or alone, for a model without one). Blank means the row,
// never "no provider at all".
export function routingFor(model: string, override?: string): OpenRouterRouting | undefined {
  const only = (override ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '')
  const row = MODEL_ROUTING[model]
  return only.length > 0 ? { ...row, only } : row
}

export function makeBotPolicy(env: BotEnv, fetchImpl?: typeof fetch): LlmPolicy {
  const model = env.BOT_MODEL?.trim() || DEFAULT_BOT_MODEL
  const key = env.OPENROUTER_API_KEY?.trim() ?? ''
  const disabled = key === '' || ['1', 'true'].includes((env.BOT_LLM_DISABLED ?? '').trim().toLowerCase())
  const settings = {
    ...DEFAULT_LLM_POLICY_SETTINGS,
    reasoningEffort: reasoningEffortFor(model, env.BOT_REASONING_EFFORT),
    routing: routingFor(model, env.BOT_PROVIDERS),
  }
  return new LlmPolicy(disabled ? null : new OpenRouterClient(key, model, fetchImpl), basicPolicy, model, settings)
}
