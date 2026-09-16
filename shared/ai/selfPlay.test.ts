import { describe, expect, it } from 'vitest'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import { STARTING_TURN_NUMBER } from '../gameSettings'
import { DEFAULT_LOBBY_SETTINGS } from '../lobbySettings'
import type { EngineContext, EngineGame, GameAction } from '../engine/engineTypes'
import { buildInitialGame } from '../engine/gameInit'
import type { SnapshotCard } from '../engine/gameInit'
import { applyAction, battleParticipants, legalZonesFor } from '../engine/index'
import { basicPolicy } from './basicPolicy'
import { BOT_DECKS, BOT_FACTIONS } from './botDecks'
import type { BotFaction } from './botDecks'
import { runBotUntilIdle } from './botDriver'

// The net for effect interactions among the seeded cards (spec §9): the bot
// plays every one of its decks against a scripted human who deploys hulls,
// picks fights half the time, and reports every battle with random ending HP
// so deaths, repairs and death triggers all fire. Nothing here asserts on
// strategy — only that no seed, deck or card can wedge or crash the driver.
// Eight seeds keeps the file near ten seconds; raise it once the engine's
// clone cost is known to allow more (spec §9 aimed at ~20).
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const TURN_CAP = 40
const STEP_CAP = 2000

// mulberry32 — small, fast, and the seed reproduces a failure exactly.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function toSnapshot(card: SeedCard): SnapshotCard {
  return {
    cardId: cardId(card.faction, card.name), name: card.name, isBuiltIn: true, ownerId: null,
    faction: card.faction, type: card.type, vehicleType: card.vehicleType,
    blueprintCost: card.blueprintCost, materialCost: card.materialCost, cpCost: card.cpCost,
    cardText: card.cardText ?? '', imageUrl: card.imageUrl ?? '',
    keywords: card.keywords ?? [], meta: (card.meta ?? {}) as Record<string, unknown>,
  }
}

function deckFor(faction: BotFaction, snapshots: Map<string, SnapshotCard>, byName: Map<string, SnapshotCard>) {
  const cards: Record<string, number> = {}
  for (const [name, copies] of Object.entries(BOT_DECKS[faction])) {
    const snap = byName.get(`${faction}:${name}`)
    if (!snap) throw new Error(`${faction} deck names "${name}", which the seed source does not have`)
    cards[snap.cardId] = copies
    snapshots.set(snap.cardId, snap)
  }
  return cards
}

// The scripted human, side 'a'. One action per call; null means nobody owes.
function humanStep(game: EngineGame, rng: () => number): GameAction | null {
  const s = game.state
  if (s.pendingEffect) {
    if (s.pendingEffect.side !== 'a') return null
    const options = s.pendingEffect.options
    if (options.length === 0) return { type: 'RESOLVE_PENDING_EFFECT', cancel: true }
    return { type: 'RESOLVE_PENDING_EFFECT', choiceId: options[Math.floor(rng() * options.length)].id }
  }
  if (s.awaitingResponse) return s.awaitingResponse.aggressor === 'b' ? { type: 'RESPOND_TO_ATTACK', optOutIds: [] } : null
  if (s.pendingReport) return null
  if (s.activeBattle) {
    const results: Record<string, number> = {}
    for (const id of battleParticipants(s).keys()) results[id] = Math.floor(rng() * 101)
    return { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }
  }
  if (game.activePlayer !== 'alice') return null
  // Deploy the first affordable vehicle that has a legal zone. Vehicles that
  // need a hand target (playOnCardEffect — SS Victoria/Excalibur) are skipped:
  // this script plays plainly, and the engine would refuse them.
  for (const card of game.privates.a.hand) {
    if (card.type !== 'vehicle' || card.meta.playOnCardEffect !== undefined) continue
    if (card.materialCost > s.resources.a.materials || card.cpCost > s.resources.a.cp) continue
    const zones = legalZonesFor(s, 'a', card, game.turnNumber)
    if (zones.length > 0) {
      return { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: zones[Math.floor(rng() * zones.length)] }
    }
  }
  // Pick a fight half the time where both sides hold the zone.
  for (const zone of s.zones) {
    if (zone.lastActivatedTurn === game.turnNumber) continue
    if (zone.cards.a.length > 0 && zone.cards.b.length > 0 && rng() < 0.5) {
      return { type: 'ATTACK_ENEMY_FLEET', zoneId: zone.id }
    }
  }
  return { type: 'END_TURN' }
}

describe('self-play', () => {
  for (const [i, botFaction] of BOT_FACTIONS.entries()) {
    const humanFaction = BOT_FACTIONS[(i + 1) % BOT_FACTIONS.length]
    it(`PracticeAI (${botFaction}) vs a scripted ${humanFaction} over ${SEEDS.length} seeds`, async () => {
      const { cards } = await loadSeedData()
      const catalog = cards.filter((c) => c.isBuiltIn).map(toSnapshot)
      const byName = new Map(catalog.map((c) => [`${c.faction}:${c.name}`, c]))
      for (const seed of SEEDS) {
        const rng = mulberry32(seed)
        const snapshots = new Map<string, SnapshotCard>()
        const deckA = deckFor(humanFaction, snapshots, byName)
        const deckB = deckFor(botFaction, snapshots, byName)
        let n = 0
        const settings = { ...DEFAULT_LOBBY_SETTINGS, bot: { side: 'b' as const } }
        const built = buildInitialGame({
          gameId: `self-play-${seed}`, playerA: 'alice', playerB: 'bot', settings,
          deckA: { cards: deckA, snapshots }, deckB: { cards: deckB, snapshots },
          factionA: humanFaction, factionB: botFaction,
          instanceId: () => `i-${n++}`, rng,
        })
        let game: EngineGame = {
          ...built.game, status: 'active', winnerId: null, turnNumber: STARTING_TURN_NUMBER,
          privates: { a: built.aPrivate, b: built.bPrivate },
        }
        const ctx: EngineContext = { rng, newId: () => `n-${n++}`, catalog }
        const where = () => `(seed ${seed}, ${botFaction} vs ${humanFaction}, turn ${game.turnNumber})`
        for (let step = 0; step < STEP_CAP; step++) {
          try {
            game = runBotUntilIdle(game, 'bot', ctx, basicPolicy).game
          } catch (e) {
            throw new Error(`bot threw ${where()}: ${e instanceof Error ? e.message : String(e)}`)
          }
          if (game.status !== 'active' || game.turnNumber >= TURN_CAP) break
          const action = humanStep(game, rng)
          if (!action) throw new Error(`nobody owes an action ${where()}`)
          let r = applyAction(game, 'alice', action, ctx)
          // The script is not a rules engine: a refused choice is declined, a
          // refused play or attack becomes END_TURN. Only a refused END_TURN
          // (or a refused response/report) is a finding.
          if (!r.ok && action.type === 'RESOLVE_PENDING_EFFECT' && !action.cancel) {
            r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ctx)
          } else if (!r.ok && (action.type === 'PLAY_CARD_TO_ZONE' || action.type === 'ATTACK_ENEMY_FLEET')) {
            r = applyAction(game, 'alice', { type: 'END_TURN' }, ctx)
          }
          if (!r.ok) throw new Error(`human's ${action.type} refused ${where()}: ${r.error}`)
          game = r.game
        }
        expect(game.status !== 'active' || game.turnNumber >= TURN_CAP, `game never ended ${where()}`).toBe(true)
      }
    }, 120_000)
  }
})
