import { KEYWORDS, LOG_MAX_ENTRIES, MATERIALS_PER_TURN, VEHICLE_TYPES } from '../gameSettings.ts'
import { secureRng } from './gameInit.ts'
import type { PublicGameState } from './gameInit.ts'
import type {
  ApplyResult, EngineContext, EngineGame, GameAction, Side, ZoneCardEntry,
} from './engineTypes.ts'

export function defaultEngineContext(): EngineContext {
  return { rng: secureRng, newId: () => crypto.randomUUID(), catalog: [] }
}

export function sideOf(game: EngineGame, playerId: string): Side | null {
  if (playerId === game.playerA) return 'a'
  if (playerId === game.playerB) return 'b'
  return null
}

export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a')

export function zoneById(state: PublicGameState, zoneId: number) {
  return state.zones.find((z) => z.id === zoneId) ?? null
}

export function findVehicle(state: PublicGameState, instanceId: string) {
  for (const zone of state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      const index = zone.cards[side].findIndex((c) => c.instanceId === instanceId)
      if (index >= 0) {
        return { zone, side, entry: zone.cards[side][index] as ZoneCardEntry, index }
      }
    }
  }
  return null
}

export const battleFrozen = (state: PublicGameState): boolean =>
  state.awaitingResponse !== null || state.activeBattle !== null || state.pendingReport !== null

export function zonesLostBy(game: EngineGame, side: Side): number {
  return game.state.zones.filter((z) => z.baseHp[side] <= 0).length
}

const BATTLE_ACTIONS = new Set<GameAction['type']>([
  'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'CONCEDE', 'USE_HERO_POWER',
])

const OFF_TURN_ACTIONS = new Set<GameAction['type']>([
  'CONCEDE', 'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'USE_HERO_POWER',
])

export const err = (status: number, error: string): ApplyResult => ({ ok: false, status, error })

// Handler registry — later modules add entries via registerHandler.
type Handler = (game: EngineGame, actor: Side, action: GameAction, ctx: EngineContext) => ApplyResult
const handlers = new Map<GameAction['type'], Handler>()
export function registerHandler(type: GameAction['type'], handler: Handler) {
  handlers.set(type, handler)
}

// Defensive shape-repair for rows created before this phase (or by an older
// deployed lobby-action): missing fields become their empty defaults so the
// freeze check and handlers never trip over `undefined`.
export function normalizeState(state: PublicGameState): void {
  const s = state as unknown as Record<string, unknown>
  if (s.awaitingResponse === undefined) s.awaitingResponse = null
  if (s.activeBattle === undefined) s.activeBattle = null
  if (s.pendingReport === undefined) s.pendingReport = null
  if (s.destroyed === undefined) s.destroyed = { a: [], b: [] }
  if (s.factions === undefined) s.factions = { a: 'NEUTRAL', b: 'NEUTRAL' }
  if (s.alertCard === undefined) s.alertCard = null
  if (s.scheduled === undefined) s.scheduled = []
  for (const zone of state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      for (const entry of zone.cards[side] as Partial<ZoneCardEntry>[]) {
        if (entry.playedOnTurn === undefined) entry.playedOnTurn = 0
        if (entry.movedOnTurn === undefined) entry.movedOnTurn = null
      }
    }
  }
}

export function drawCard(game: EngineGame, side: Side): void {
  const priv = game.privates[side]
  const card = priv.deck.shift()
  if (!card) {
    game.state.log.push(`Player ${side.toUpperCase()} has no cards left to draw`)
  } else {
    priv.hand.push(card)
  }
  game.state.counts[side] = { hand: priv.hand.length, deck: priv.deck.length }
}

export function checkVictory(game: EngineGame): void {
  for (const side of ['a', 'b'] as Side[]) {
    if (zonesLostBy(game, side) >= 2 && game.status === 'active') {
      game.status = 'complete'
      game.winnerId = side === 'a' ? game.playerB : game.playerA
      game.state.log.push(`Player ${otherSide(side).toUpperCase()} wins — two zones fell`)
    }
  }
}

function endTurn(game: EngineGame, ctx: EngineContext): ApplyResult {
  // The side whose turn is ENDING is whoever is active right now — capture it
  // before activePlayer flips below, so alert expiry checks the right side.
  const endingSide = sideOf(game, game.activePlayer) as Side
  game.turnNumber = Math.round((game.turnNumber + 0.5) * 10) / 10
  const incoming = game.activePlayer === game.playerA ? game.playerB : game.playerA
  game.activePlayer = incoming
  const side = sideOf(game, incoming) as Side
  // Cull temporaries from BOTH sides at every turn start (spec §3.2/§3.7).
  for (const zone of game.state.zones) {
    for (const s of ['a', 'b'] as Side[]) {
      const keep: ZoneCardEntry[] = []
      for (const entry of zone.cards[s] as ZoneCardEntry[]) {
        if (entry.keywords.includes(KEYWORDS.TEMPORARY)) {
          const { instanceId: _instanceId, playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = entry
          game.state.destroyed[s].push(snapshot)
          game.state.log.push(`${entry.name} despawned (temporary)`)
        } else {
          keep.push(entry)
        }
      }
      zone.cards[s] = keep
    }
  }
  game.state.resources[side].materials = Math.floor(game.turnNumber) * MATERIALS_PER_TURN
  drawCard(game, side)

  // Change Order redeliveries (Task 7): process every scheduled item due for
  // the incoming side now that their materials/draw have already landed.
  // Processed items (hit or fizzle) are dropped; anything not yet due, or
  // belonging to the other side, is carried forward untouched.
  const stillScheduled: PublicGameState['scheduled'] = []
  for (const item of game.state.scheduled) {
    if (item.side !== side || game.turnNumber < item.dueTurn) {
      stillScheduled.push(item)
      continue
    }
    if (item.type === 'changeOrderDraw') {
      const priv = game.privates[side]
      const pool = priv.deck.filter(
        (c) => c.isBuiltIn === false && (c.vehicleType === VEHICLE_TYPES.SHIP || c.vehicleType === VEHICLE_TYPES.TANK),
      )
      if (pool.length === 0) {
        game.state.log.push('Change Order finds no player-made ship or tank')
      } else {
        const pick = pool[Math.floor(ctx.rng() * pool.length)]
        priv.deck = priv.deck.filter((c) => c.instanceId !== pick.instanceId)
        priv.hand.push(pick)
        game.state.counts[side] = { hand: priv.hand.length, deck: priv.deck.length }
        game.state.log.push('Change Order delivers a replacement')
      }
    }
  }
  game.state.scheduled = stillScheduled

  // An alert card only lives through its owner's own turn — it expires the
  // moment that turn ends, whether or not it was ever triggered.
  const alert = game.state.alertCard
  if (alert && alert.side === endingSide) {
    game.state.log.push(`${alert.name} alert expired`)
    game.state.alertCard = null
  }
  game.state.log.push(`Turn ${game.turnNumber} — player ${side.toUpperCase()} to act`)
  return { ok: true, game }
}

function concede(game: EngineGame, actor: Side): ApplyResult {
  game.status = 'complete'
  game.winnerId = actor === 'a' ? game.playerB : game.playerA
  game.state.log.push(`Player ${actor.toUpperCase()} conceded`)
  return { ok: true, game }
}

// Single exit point for every success path: trims the action log to the
// spec's cap (LOG_MAX_ENTRIES) so a long game never grows the row unbounded.
// Keeps the newest entries.
function finish(result: ApplyResult): ApplyResult {
  if (result.ok && result.game.state.log.length > LOG_MAX_ENTRIES) {
    result.game.state.log = result.game.state.log.slice(-LOG_MAX_ENTRIES)
  }
  return result
}

export function applyAction(
  input: EngineGame, actorId: string, action: GameAction, ctx: EngineContext = defaultEngineContext(),
): ApplyResult {
  const game = structuredClone(input)
  const actor = sideOf(game, actorId)
  if (!actor) return err(403, 'You are not in this game')
  if (game.status !== 'active') return err(409, 'Game is over')
  if (battleFrozen(game.state) && !BATTLE_ACTIONS.has(action.type)) {
    return err(409, 'A battle is in progress — resolve it first')
  }
  if (!OFF_TURN_ACTIONS.has(action.type) && game.activePlayer !== actorId) {
    return err(409, 'Not your turn')
  }
  if (action.type === 'END_TURN') return finish(endTurn(game, ctx))
  if (action.type === 'CONCEDE') return finish(concede(game, actor))
  const handler = handlers.get(action.type)
  if (!handler) return err(400, `Unknown or not-yet-supported action: ${action.type}`)
  return finish(handler(game, actor, action, ctx))
}
