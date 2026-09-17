import { basicPolicy } from '../basicPolicy.ts'
import { LlmPolicy } from './llmPolicy.ts'
import { DEFAULT_BOT_MODEL } from './llmSettings.ts'
import { OpenRouterClient } from './openRouterClient.ts'

// Env → policy (spec §3.4). No key, or the kill switch, means the heuristic
// plays through a disabled LlmPolicy — one wiring path, and the fallback is
// visible in telemetry. Both functions call this; nothing else constructs a
// policy in production.
export interface BotEnv { OPENROUTER_API_KEY?: string; BOT_MODEL?: string; BOT_LLM_DISABLED?: string }

export function makeBotPolicy(env: BotEnv, fetchImpl?: typeof fetch): LlmPolicy {
  const model = env.BOT_MODEL?.trim() || DEFAULT_BOT_MODEL
  const key = env.OPENROUTER_API_KEY?.trim() ?? ''
  const disabled = key === '' || env.BOT_LLM_DISABLED === '1'
  return new LlmPolicy(disabled ? null : new OpenRouterClient(key, model, fetchImpl), basicPolicy, model)
}
