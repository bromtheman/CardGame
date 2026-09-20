import type { BotPolicy } from '../basicPolicy.ts'
import { scoredPolicy } from '../scoredPolicy.ts'
import { DEFAULT_LLM_POLICY_SETTINGS, LlmPolicy } from './llmPolicy.ts'
import type { LlmPolicySettings } from './llmPolicy.ts'
import { DEFAULT_BOT_MODEL, MODEL_REASONING_EFFORT, MODEL_ROUTING, REASONING_EFFORTS } from './llmSettings.ts'
import type { OpenRouterRouting, ReasoningEffort } from './llmSettings.ts'
import { OpenRouterClient } from './openRouterClient.ts'
import { SectionedLlmPolicy } from './sectionedPolicy.ts'
import type { TelemetryRow } from './telemetry.ts'

// Env → policy (spec §3.4). No key, or the kill switch, means the evaluator
// plays through a disabled model policy — one wiring path, and the fallback
// is visible in telemetry; the evaluator is the fallback inside both model
// flows now, not the bare heuristic (2026-09-19 scored menu spec §6.4). Both
// functions call this; nothing else constructs a policy in production.
// BOT_FLOW picks the sectioned conversation (the default), the single-shot
// plan (2026-09-18 sectioned bot turn spec §5.5, ruling 6), or the evaluator
// alone with no model call at all (scored, spec §5) — compared by the eval
// at the same model and effort.
export interface BotEnv {
  OPENROUTER_API_KEY?: string
  BOT_MODEL?: string
  BOT_LLM_DISABLED?: string
  BOT_REASONING_EFFORT?: string
  BOT_PROVIDERS?: string
  BOT_FLOW?: string
}

export type BotFlow = 'single' | 'sections' | 'scored'
export const botFlowFor = (raw?: string): BotFlow => {
  const f = (raw ?? '').trim().toLowerCase()
  return f === 'single' ? 'single' : f === 'scored' ? 'scored' : 'sections'
}

// What both model policies expose beyond BotPolicy: the functions read rows,
// the eval reads rows and settings, the tests read modelId.
export type ModelBackedPolicy = BotPolicy & { readonly rows: TelemetryRow[]; readonly modelId: string; readonly settings: LlmPolicySettings }

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

export function makeBotPolicy(env: BotEnv, fetchImpl?: typeof fetch): ModelBackedPolicy {
  const model = env.BOT_MODEL?.trim() || DEFAULT_BOT_MODEL
  const key = env.OPENROUTER_API_KEY?.trim() ?? ''
  const disabled = key === '' || ['1', 'true'].includes((env.BOT_LLM_DISABLED ?? '').trim().toLowerCase())
  const settings = {
    ...DEFAULT_LLM_POLICY_SETTINGS,
    reasoningEffort: reasoningEffortFor(model, env.BOT_REASONING_EFFORT),
    routing: routingFor(model, env.BOT_PROVIDERS),
  }
  const client = disabled ? null : new OpenRouterClient(key, model, fetchImpl)
  const flow = botFlowFor(env.BOT_FLOW)
  if (flow === 'scored') return { ...scoredPolicy, rows: [], modelId: 'scored', settings }
  return flow === 'single'
    ? new LlmPolicy(client, scoredPolicy, model, settings)
    : new SectionedLlmPolicy(client, scoredPolicy, model, settings)
}
