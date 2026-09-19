import { describe, expect, it } from 'vitest'
import { makeCtx, makeGame } from '../../engine/testFixtures'
import { viewFor } from '../botView'
import { scoredPolicy } from '../scoredPolicy'
import { DEFAULT_LLM_POLICY_SETTINGS, LlmPolicy } from './llmPolicy'
import { DEFAULT_BOT_MODEL } from './llmSettings'
import { botFlowFor, makeBotPolicy } from './makePolicy'
import type { MenuItem } from './moveMenu'
import { SectionedLlmPolicy } from './sectionedPolicy'

describe('makeBotPolicy', () => {
  it('is disabled without a key or with the kill switch, enabled with a key', () => {
    expect(makeBotPolicy({}).needsMenu).toBe(true)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: '   ' }).needsMenu).toBe(true)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: '1' }).needsMenu).toBe(true)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: 'true' }).needsMenu).toBe(true)
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
  it('builds the sectioned policy by default and the single-shot one on BOT_FLOW=single', () => {
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk' })).toBeInstanceOf(SectionedLlmPolicy)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_FLOW: 'sections' })).toBeInstanceOf(SectionedLlmPolicy)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_FLOW: ' Single ' })).toBeInstanceOf(LlmPolicy)
    expect(makeBotPolicy({ BOT_FLOW: 'single' })).toBeInstanceOf(LlmPolicy)   // disabled, still the named flow
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_FLOW: 'typo' })).toBeInstanceOf(SectionedLlmPolicy)
    expect(botFlowFor(undefined)).toBe('sections')
    expect(botFlowFor('single')).toBe('single')
  })
  it('builds the scored flow on BOT_FLOW=scored: no model, no rows, the menu wanted', () => {
    expect(botFlowFor('scored')).toBe('scored')
    expect(botFlowFor(' Scored ')).toBe('scored')
    const p = makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_FLOW: 'scored' })
    expect(p.modelId).toBe('scored')
    expect(p.rows).toEqual([])
    expect(p.needsMenu).toBe(true)
    expect(p.candidates).toBe(scoredPolicy.candidates)
  })
  it('wants the menu even when disabled or tripped — the scored fallback reads it', () => {
    expect(makeBotPolicy({}).needsMenu).toBe(true)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: '1' }).needsMenu).toBe(true)
  })
  it('routes a disabled policy through scoredPolicy\'s ranked order — not menu order, not basicPolicy\'s — in both flows', async () => {
    // id 3 is neither first in menu order nor what basicPolicy's own
    // heuristic would pick from this empty board (END TURN, its only 'turn'
    // candidate with no hand and no board) — so the assertion below can only
    // pass if each flow's fallback is scoredPolicy actually reading the
    // menu, not basicPolicy ignoring it. Guards against silently reverting
    // makeBotPolicy's basicPolicy→scoredPolicy fallback swap: every other
    // test here checks only needsMenu/instanceof/modelId, none of which
    // would change if that swap were reverted.
    const menu: MenuItem[] = [
      { id: 1, action: { type: 'END_TURN' }, text: 'END TURN', section: 'finish', score: 0 },
      { id: 2, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, text: 'ATTACK the enemy base in zone 1', section: 'fight', score: 0.5 },
      { id: 3, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-1', zoneId: 1 }, text: 'PLAY Corsair', section: 'deploy', score: 3 },
    ]
    const game = makeGame({ activePlayer: 'bob', turnNumber: 3 })
    const view = viewFor(game, 'b', makeCtx().rng, menu)

    const sections = makeBotPolicy({})                     // no key: disabled, default (sections) flow
    expect(sections).toBeInstanceOf(SectionedLlmPolicy)
    expect((await sections.candidates(view, 'turn'))[0]).toEqual(menu[2].action)

    const single = makeBotPolicy({ BOT_FLOW: 'single' })   // no key: disabled, single-shot flow
    expect(single).toBeInstanceOf(LlmPolicy)
    expect((await single.candidates(view, 'turn'))[0]).toEqual(menu[2].action)
  })
})
