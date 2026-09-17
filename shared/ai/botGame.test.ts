import { describe, expect, it } from 'vitest'
import { BOT_USERNAME, botPlayerId, botSideOf } from './botGame'

describe('botSideOf', () => {
  it('is null for a human game (no key), for null, and for undefined', () => {
    expect(botSideOf({ zones: [] })).toBeNull()
    expect(botSideOf(null)).toBeNull()
    expect(botSideOf(undefined)).toBeNull()
  })
  it('is null for a malformed key rather than throwing', () => {
    expect(botSideOf({ bot: true })).toBeNull()
    expect(botSideOf({ bot: { side: 'c' } })).toBeNull()
    expect(botSideOf({ bot: 'b' })).toBeNull()
  })
  it('returns the stamped side', () => {
    expect(botSideOf({ zones: [], bot: { side: 'b' } })).toBe('b')
    expect(botSideOf({ bot: { side: 'a' } })).toBe('a')
  })
})

describe('botPlayerId', () => {
  const game = { playerA: 'alice', playerB: 'bot-1', settings: { bot: { side: 'b' } } }
  it('maps the stamped side to that player id', () => {
    expect(botPlayerId(game)).toBe('bot-1')
    expect(botPlayerId({ ...game, settings: { bot: { side: 'a' } } })).toBe('alice')
  })
  it('is null for a human game', () => {
    expect(botPlayerId({ ...game, settings: {} })).toBeNull()
  })
})

it('the bot username fits the profiles.username check', () => {
  expect(BOT_USERNAME).toMatch(/^[A-Za-z0-9_]{3,20}$/)
})
