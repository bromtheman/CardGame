import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_POLICY_SETTINGS } from './llmPolicy'
import { DEFAULT_BOT_MODEL } from './llmSettings'
import { makeBotPolicy } from './makePolicy'

describe('makeBotPolicy', () => {
  it('is disabled without a key or with the kill switch, enabled with a key', () => {
    expect(makeBotPolicy({}).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: '   ' }).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: '1' }).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: 'true' }).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk' }).needsMenu).toBe(true)
  })
  it('names the model from env, defaulting to DEFAULT_BOT_MODEL', async () => {
    const withModel = makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'openai/gpt-5-nano' })
    expect(withModel.modelId).toBe('openai/gpt-5-nano')
    expect(makeBotPolicy({}).modelId).toBe(DEFAULT_BOT_MODEL)
  })
  it('asks DeepSeek V4.1 Flash to reason at high, sends Mercury no effort, and lets BOT_REASONING_EFFORT override either', () => {
    const deepseek = makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash' })
    expect(deepseek.settings.reasoningEffort).toBe('high')
    expect(deepseek.settings.callTimeoutMs).toBe(DEFAULT_LLM_POLICY_SETTINGS.callTimeoutMs)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk' }).settings.reasoningEffort).toBeUndefined()
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_REASONING_EFFORT: ' XHigh ' }).settings.reasoningEffort).toBe('xhigh')
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash', BOT_REASONING_EFFORT: 'none' }).settings.reasoningEffort).toBe('none')
    // A typo is not a silent "off": the model's own default stands.
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash', BOT_REASONING_EFFORT: 'lots' }).settings.reasoningEffort).toBe('high')
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_REASONING_EFFORT: '' }).settings.reasoningEffort).toBeUndefined()
  })
  it('routes DeepSeek V4.1 Flash by throughput, leaves Mercury on default routing, and lets BOT_PROVIDERS pin providers on top', () => {
    const fast = { sort: 'throughput', require_parameters: true }
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash' }).settings.routing).toEqual(fast)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk' }).settings.routing).toBeUndefined()
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash', BOT_PROVIDERS: ' Modal, together ,, ' }).settings.routing).toEqual({ ...fast, only: ['modal', 'together'] })
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_PROVIDERS: 'inception' }).settings.routing).toEqual({ only: ['inception'] })
    // Blank means "the model's row", never "no providers at all".
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'deepseek/deepseek-v4.1-flash', BOT_PROVIDERS: ' , ' }).settings.routing).toEqual(fast)
  })
})
