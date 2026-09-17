import type { EngineGame, Side } from '../../engine/engineTypes.ts'
import { BOT_DECKS, isBotFaction } from '../botDecks.ts'
import { TABLE_TALK_MAX_CHARS } from './llmSettings.ts'

// The one public channel the model has (spec §6). The driver is the only
// writer, and only through guardTableTalk. The prefix is what the frontend
// keys on to style the line and raise the bubble.
export const TABLE_TALK_PREFIX = 'PracticeAI: '

export const formatTableTalk = (line: string): string => `${TABLE_TALK_PREFIX}"${line}"`
export const isTableTalk = (line: string): boolean => line.startsWith(TABLE_TALK_PREFIX)

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Names that would leak (spec §6.1): the bot's hand, plus its deck list —
// public in the repo, but naming one not yet seen says "it is in my hand" —
// minus what is already public for the bot: its hulls on the field, its
// destroyed pile, and a battle's summons.
export function leakSet(game: EngineGame, side: Side): Set<string> {
  const names = new Set<string>()
  for (const c of game.privates[side].hand) names.add(c.name.toLowerCase())
  const faction = game.state.factions[side]
  if (isBotFaction(faction)) for (const name of Object.keys(BOT_DECKS[faction])) names.add(name.toLowerCase())
  for (const z of game.state.zones) for (const c of z.cards[side]) names.delete(c.name.toLowerCase())
  for (const c of game.state.destroyed[side]) names.delete(c.name.toLowerCase())
  for (const s of game.state.activeBattle?.summons ?? []) names.delete(s.name.toLowerCase())
  return names
}

// Null means "write nothing". No redaction: a half line reads badly and still
// hints, so any hit drops the whole line.
export function guardTableTalk(line: string | null | undefined, game: EngineGame, side: Side): string | null {
  if (typeof line !== 'string') return null
  const clean = line.replace(/\s+/g, ' ').trim()
  if (clean === '' || clean.length > TABLE_TALK_MAX_CHARS) return null
  for (const name of leakSet(game, side)) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}([^a-z0-9]|$)`, 'i').test(clean)) return null
  }
  return clean
}
