import { describe, expect, it } from 'vitest'
import { DEFAULT_BOT_MODEL } from './llmSettings'
import { makeBotPolicy } from './makePolicy'

describe('makeBotPolicy', () => {
  it('is disabled without a key or with the kill switch, enabled with a key', () => {
    expect(makeBotPolicy({}).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: '   ' }).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: '1' }).needsMenu).toBe(false)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk' }).needsMenu).toBe(true)
  })
  it('names the model from env, defaulting to DEFAULT_BOT_MODEL', async () => {
    const withModel = makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_MODEL: 'openai/gpt-5-nano' })
    expect(withModel.modelId).toBe('openai/gpt-5-nano')
    expect(makeBotPolicy({}).modelId).toBe(DEFAULT_BOT_MODEL)
  })
})
