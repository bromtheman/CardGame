import { STARTING_TURN_NUMBER } from '../gameSettings.ts'
import { DEFAULT_LOBBY_SETTINGS } from '../lobbySettings.ts'
import type { EngineContext, EngineGame, GameAction } from '../engine/engineTypes.ts'
import { buildInitialGame } from '../engine/gameInit.ts'
import type { SnapshotCard } from '../engine/gameInit.ts'
import { legalZonesFor } from '../engine/index.ts'
import { resolveBattle } from './battleSim.ts'
import { shipProfilesForFaction } from '../shipProfiles.ts'
import { BOT_DECKS, BOT_FACTIONS, isBotFaction } from './botDecks.ts'
import type { BotFaction } from './botDecks.ts'
import { mulberry32 } from './seededRng.ts'

// Scaffolding shared by selfPlay.test.ts (the effect-interaction net) and
// scripts/eval-bot.ts (the strength bar, LLM spec §10.2). Nothing here
// asserts; the callers decide what a run means.
export const TURN_CAP = 40
export const STEP_CAP = 2000
export { mulberry32 }

// The bot factions whose hulls have FtDArmament profiles — the ones the
// battle resolver (battleSim.ts) can actually judge. An unprofiled faction
// fights as bare cost, which measures nothing, so the eval defaults to these.
export const profiledFactions = (): BotFaction[] =>
  BOT_FACTIONS.filter((f) => shipProfilesForFaction(f).length > 0)

// How the eval seats the factions (2026-09-19). 'mirror' puts the same deck on
// both seats, so the win rate is the policy's skill and nothing else: with
// basicPolicy on both seats the model's seat wins 50 % by symmetry (seat order
// measured at 50/47 over 120 games). 'cross' rotates the list one seat apart —
// the older schedule, under which the faction draw decided ~90 % of the games
// whoever played (heuristic vs heuristic, calibrated resolver: DWG won 90 % of
// its games, SS 36 %, WF 24 %, and the same under a coin flip), so an aggregate
// win rate mostly reported who drew DWG.
export type Pairing = 'mirror' | 'cross'

export function parsePairing(arg: string | undefined): Pairing {
  const p = (arg ?? '').trim().toLowerCase()
  if (p === '' || p === 'mirror') return 'mirror'
  if (p === 'cross') return 'cross'
  throw new Error(`unknown pairing "${arg}" (mirror or cross)`)
}

// The eval's --factions argument: a comma list of bot factions (any case),
// blank or absent for the profiled ones. Crossing needs at least two.
export function parseFactions(arg: string | undefined, pairing: Pairing = 'mirror'): BotFaction[] {
  const wanted = (arg ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => s !== '')
  if (wanted.length === 0) return profiledFactions()
  const unknown = wanted.filter((f) => !isBotFaction(f))
  if (unknown.length) throw new Error(`unknown bot faction(s): ${unknown.join(', ')} (known: ${BOT_FACTIONS.join(', ')})`)
  if (pairing === 'cross' && wanted.length < 2) throw new Error('--factions needs at least two factions to cross them')
  return wanted as BotFaction[]
}

// The decks for game i of a run: game i mirrors factions[i % n], or crosses
// it with the next in the list; the eval alternates the model's seat per
// game, so a cross cycle of 2n games gives every ordered pair both seats.
export function matchupFor(factions: readonly BotFaction[], i: number, pairing: Pairing): { factionA: BotFaction; factionB: BotFaction } {
  const factionA = factions[i % factions.length]
  const factionB = pairing === 'mirror' ? factionA : factions[(i + 1) % factions.length]
  return { factionA, factionB }
}

export function deckFor(faction: BotFaction, snapshots: Map<string, SnapshotCard>, byName: Map<string, SnapshotCard>) {
  const cards: Record<string, number> = {}
  for (const [name, copies] of Object.entries(BOT_DECKS[faction])) {
    const snap = byName.get(`${faction}:${name}`)
    if (!snap) throw new Error(`${faction} deck names "${name}", which the seed source does not have`)
    cards[snap.cardId] = copies
    snapshots.set(snap.cardId, snap)
  }
  return cards
}

// A fresh game between 'alice' (side a) and 'bot' (side b), both decks from
// BOT_DECKS, settings.bot stamped on side b as START does.
export function newGame(opts: { seed: number; factionA: BotFaction; factionB: BotFaction; catalog: SnapshotCard[]; byName: Map<string, SnapshotCard> }) {
  const rng = mulberry32(opts.seed)
  const snapshots = new Map<string, SnapshotCard>()
  const deckA = deckFor(opts.factionA, snapshots, opts.byName)
  const deckB = deckFor(opts.factionB, snapshots, opts.byName)
  let n = 0
  const settings = { ...DEFAULT_LOBBY_SETTINGS, bot: { side: 'b' as const } }
  const built = buildInitialGame({
    gameId: `self-play-${opts.seed}`, playerA: 'alice', playerB: 'bot', settings,
    deckA: { cards: deckA, snapshots }, deckB: { cards: deckB, snapshots },
    factionA: opts.factionA, factionB: opts.factionB,
    instanceId: () => `i-${n++}`, rng,
  })
  const game: EngineGame = {
    ...built.game, status: 'active', winnerId: null, turnNumber: STARTING_TURN_NUMBER,
    privates: { a: built.aPrivate, b: built.bPrivate },
  }
  const ctx: EngineContext = { rng, newId: () => `n-${n++}`, catalog: opts.catalog }
  return { game, ctx, rng }
}

// The human's report, resolved by strength instead of a coin flip
// (battleSim.ts): deaths, repairs and death triggers all still fire, and a
// fight the bot should have won now usually is.
export function reportBattle(game: EngineGame, rng: () => number): GameAction {
  return { type: 'SUBMIT_BATTLE_REPORT', results: resolveBattle(game, rng), repairs: [] }
}

// The scripted human, side 'a'. One action per call; null means nobody owes.
export function humanStep(game: EngineGame, rng: () => number): GameAction | null {
  const s = game.state
  if (s.pendingEffect) {
    if (s.pendingEffect.side !== 'a') return null
    const options = s.pendingEffect.options
    if (options.length === 0) return { type: 'RESOLVE_PENDING_EFFECT', cancel: true }
    return { type: 'RESOLVE_PENDING_EFFECT', choiceId: options[Math.floor(rng() * options.length)].id }
  }
  if (s.awaitingResponse) {
    if (s.awaitingResponse.aggressor !== 'b') return null
    const { stealthyIds, omissibleIds } = s.awaitingResponse
    return { type: 'RESPOND_TO_ATTACK', optOutIds: [...new Set([...stealthyIds, ...omissibleIds])] }
  }
  if (s.pendingReport) return null
  if (s.activeBattle) return reportBattle(game, rng)
  if (game.activePlayer !== 'alice') return null
  for (const card of game.privates.a.hand) {
    if (card.type !== 'vehicle' || card.meta.playOnCardEffect !== undefined) continue
    if (card.materialCost > s.resources.a.materials || card.cpCost > s.resources.a.cp) continue
    const zones = legalZonesFor(s, 'a', card, game.turnNumber)
    if (zones.length > 0) {
      return { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: zones[Math.floor(rng() * zones.length)] }
    }
  }
  for (const zone of s.zones) {
    if (zone.lastActivatedTurn === game.turnNumber) continue
    if (zone.cards.a.length > 0 && zone.cards.b.length > 0 && rng() < 0.5) {
      return { type: 'ATTACK_ENEMY_FLEET', zoneId: zone.id }
    }
  }
  return { type: 'END_TURN' }
}
