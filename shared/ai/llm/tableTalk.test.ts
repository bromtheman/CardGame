import { describe, expect, it } from 'vitest'
import { inst, makeGame, zoneEntry } from '../../engine/testFixtures'
import { TABLE_TALK_MAX_CHARS } from './llmSettings'
import { formatTableTalk, guardTableTalk, isTableTalk, TABLE_TALK_PREFIX } from './tableTalk'

// The bot is side 'b'. makeGame's default factions are { a: 'DWG', b: 'OW' },
// so BOT_DECKS.OW's names ('Claymore', 'Mace', …) are in the leak set until
// they are public; 'Kraken' is a DWG deck name and reaches the set only via
// the bot's hand here.
const withHand = (name: string) =>
  makeGame({ privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ name })], deck: [] } } })

describe('guardTableTalk', () => {
  it("drops a line naming a card in the bot's hand, case-insensitively", () => {
    expect(guardTableTalk('The Kraken stirs.', withHand('Kraken'), 'b')).toBeNull()
    expect(guardTableTalk('the KRAKEN stirs', withHand('Kraken'), 'b')).toBeNull()
  })
  it("keeps the same name once that card is on the bot's field", () => {
    const g = withHand('Kraken')
    g.state.zones[0].cards.b.push(zoneEntry({ name: 'Kraken' }))
    expect(guardTableTalk('The Kraken stirs.', g, 'b')).toBe('The Kraken stirs.')
  })
  it('drops a deck-list name that is not yet public, and keeps it once destroyed', () => {
    const g = makeGame()
    expect(guardTableTalk('Wait until you meet my Claymore.', g, 'b')).toBeNull()
    g.state.destroyed.b.push(inst({ name: 'Claymore' }))
    expect(guardTableTalk('You will pay for my Claymore.', g, 'b')).toBe('You will pay for my Claymore.')
  })
  it('matches whole names only — "grimace" does not trip on OW\'s Mace', () => {
    expect(guardTableTalk('I grimace at your fleet.', makeGame(), 'b')).toBe('I grimace at your fleet.')
  })
  it('drops blank and over-length lines, and collapses whitespace', () => {
    const g = makeGame()
    expect(guardTableTalk('   ', g, 'b')).toBeNull()
    expect(guardTableTalk(null, g, 'b')).toBeNull()
    expect(guardTableTalk(undefined, g, 'b')).toBeNull()
    expect(guardTableTalk('x'.repeat(TABLE_TALK_MAX_CHARS + 1), g, 'b')).toBeNull()
    expect(guardTableTalk('  All   hands\n on deck ', g, 'b')).toBe('All hands on deck')
  })
})

describe('formatTableTalk / isTableTalk', () => {
  it('wraps the line under the public prefix and recognises it', () => {
    expect(formatTableTalk('All hands on deck')).toBe(`${TABLE_TALK_PREFIX}"All hands on deck"`)
    expect(isTableTalk(formatTableTalk('x'))).toBe(true)
    expect(isTableTalk('Turn 3 — player A to act')).toBe(false)
  })
})
