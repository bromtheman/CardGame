import { KEYWORDS, LOG_MAX_ENTRIES, VEHICLE_TYPES } from '../gameSettings.ts'
import { materialsPerTurnOf } from '../lobbySettings.ts'
import { secureRng } from './gameInit.ts'
import type { CardInstance, PublicGameState, SnapshotCard } from './gameInit.ts'
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

// Summon-only cards are spawned, never drafted (spec §7.1). They must never
// reach state.destroyed: reshuffleDiscard feeds the discard back into the
// owner's deck, which would make a destroyed Martyr draftable.
export const isSummonOnly = (card: { meta: Record<string, unknown> }): boolean =>
  card.meta.summonOnly === true

export const battleFrozen = (state: PublicGameState): boolean =>
  state.awaitingResponse !== null || state.activeBattle !== null || state.pendingReport !== null

export function zonesLostBy(game: EngineGame, side: Side): number {
  return game.state.zones.filter((z) => z.baseHp[side] <= 0).length
}

const BATTLE_ACTIONS = new Set<GameAction['type']>([
  'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'CONCEDE', 'ABANDON', 'USE_HERO_POWER',
])

const OFF_TURN_ACTIONS = new Set<GameAction['type']>([
  'CONCEDE', 'ABANDON', 'RESPOND_TO_ATTACK', 'SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'USE_HERO_POWER',
  // pendingEffect.side is whichever side the suspending effect ran for (e.g.
  // battleResolve.ts fires a death effect with `actor: side` per destroyed
  // vehicle's owner) and need not match game.activePlayer. Without this, the
  // turn check below rejects the owing off-turn player with 409 "Not your
  // turn" before the handler's own `pending.side !== actor` (403) / "nothing
  // pending" (409) checks ever run — leaving CANCEL, which exists precisely
  // to unstick a stranded game, unreachable. Those two handler checks already
  // enforce everything this turn check would add, so admitting it here is safe.
  'RESOLVE_PENDING_EFFECT',
])

// A suspended effect freezes harder than a battle does. BATTLE_ACTIONS admits
// USE_HERO_POWER and the three battle actions, none of which should be legal
// while a player owes a choice — so this is its own list, checked first
// (spec §4.2, departure 2).
const PENDING_ACTIONS = new Set<GameAction['type']>([
  'RESOLVE_PENDING_EFFECT', 'CONCEDE', 'ABANDON',
])

export const err = (status: number, error: string): ApplyResult => ({ ok: false, status, error })

// Handler registry — later modules add entries via registerHandler.
type Handler = (game: EngineGame, actor: Side, action: GameAction, ctx: EngineContext) => ApplyResult
const handlers = new Map<GameAction['type'], Handler>()
export function registerHandler(type: GameAction['type'], handler: Handler) {
  handlers.set(type, handler)
}

// Every action type applyAction can dispatch: the registry's keys plus the
// three handled inline below. Exported for one reason — shared/engine/
// battleFreeze.test.ts asserts that its rejection sweep covers all of them, so
// a future action type cannot be added without that suite noticing it was
// never tested against the two freezes. `tsc` cannot serve that role here: the
// root tsconfig excludes **/*.test.ts, so a compile-time exhaustiveness check
// in a test file is never actually checked.
export function knownActionTypes(): GameAction['type'][] {
  return [...handlers.keys(), 'END_TURN', 'CONCEDE', 'ABANDON']
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
  if (s.zoneEffects === undefined) s.zoneEffects = []
  if (s.pendingEffect === undefined) s.pendingEffect = null
  for (const zone of state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      for (const entry of zone.cards[side] as Partial<ZoneCardEntry>[]) {
        if (entry.playedOnTurn === undefined) entry.playedOnTurn = 0
        if (entry.movedOnTurn === undefined) entry.movedOnTurn = null
        if (entry.activatedOnTurn === undefined) entry.activatedOnTurn = null
      }
    }
  }
  // Nested defaulting on live rows, guarded on a truthy parent — a null one
  // (already normalized above) is left alone, never dereferenced.
  //
  // omissibleIds did not exist before wave 4, so an attack declared by older
  // code has none (spec §4.8).
  if (state.awaitingResponse) {
    const pending = state.awaitingResponse as Partial<NonNullable<PublicGameState['awaitingResponse']>>
    if (pending.omissibleIds === undefined) pending.omissibleIds = []
  }
  // summons and continuation did not exist before wave 3 (spec §4.4).
  if (state.activeBattle) {
    const battle = state.activeBattle as Partial<NonNullable<PublicGameState['activeBattle']>>
    if (battle.summons === undefined) battle.summons = []
    if (battle.continuation === undefined) battle.continuation = null
  }
}

// The discard (state.destroyed) recycles into the deck the moment a draw
// would otherwise fail — lazily, never eagerly when the deck hits zero.
// SnapshotCard carries no instanceId, so each returning card is minted a
// fresh one, exactly as loggerheadOnDeath does.
function reshuffleDiscard(game: EngineGame, side: Side, ctx: EngineContext): void {
  const pile = game.state.destroyed[side]
  if (pile.length === 0) return
  const returning = pile.map((card) => ({ ...card, instanceId: ctx.newId() }))
  game.state.destroyed[side] = []
  for (let i = returning.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[returning[i], returning[j]] = [returning[j], returning[i]]
  }
  game.privates[side].deck.push(...returning)
  game.state.log.push(
    `Player ${side.toUpperCase()} reshuffles ${returning.length} card(s) from the discard into their deck`,
  )
}

export function drawCard(game: EngineGame, side: Side, ctx: EngineContext): void {
  const priv = game.privates[side]
  if (priv.deck.length === 0) reshuffleDiscard(game, side, ctx)
  const card = priv.deck.shift()
  if (!card) {
    game.state.log.push(`Player ${side.toUpperCase()} has no cards left to draw`)
  } else {
    priv.hand.push(card)
  }
  game.state.counts[side] = { hand: priv.hand.length, deck: priv.deck.length }
}

// Which side's discard — and so which side's deck — a card belongs to. A card
// taken out of the enemy deck (Marauder, Paddlegun, Plunderer) carries
// `meta.ownerSide`: it is on loan to whoever captured it, and it goes home
// when it leaves play. Everything else belongs to the side holding it.
export function ownerSideOf(card: { meta: Record<string, unknown> }, controller: Side): Side {
  const owner = card.meta.ownerSide
  return owner === 'a' || owner === 'b' ? owner : controller
}

// A copy minted off a captured card is a new hull, not the captured card:
// exactly one card left the enemy deck, so exactly one goes back. Every
// mint-a-copy effect runs the source card's meta through this, or the copy
// would go home to a deck it never came out of.
export function copyMeta(meta: Record<string, unknown>): Record<string, unknown> {
  if (!('ownerSide' in meta)) return meta
  const { ownerSide: _ownerSide, ...rest } = meta
  return rest
}

// The one exit every card leaving play takes: into its OWNER's discard, which
// reshuffleDiscard later feeds back into that owner's deck. Routing a captured
// card into its captor's pile instead would delete it from its owner's deck
// for the rest of the game — a steal every turn would grind that deck away.
//
// Two stamps are dropped here, for two different reasons. `costDelta` (spec
// §4.5: a per-instance delta) comes off UNCONDITIONALLY, for every card
// leaving play, captured or not — reshuffleDiscard mints a fresh instanceId
// for every returning card, so the instance the delta belonged to no longer
// exists. Excalibur is the case that makes this matter even without a
// capture: it discounts a vehicle in the OWNER's own hand, so a conditional
// strip (only when owner !== controller) would leave that owner permanently
// discounted on their own card once it dies and reshuffles back — and
// stacking again on reuse. `ownerSide` is a different concern — whose deck a
// card goes home to — so it is stripped only when the card is actually going
// home to an owner other than its controller; a card that was never captured
// carries no `ownerSide` to strip. Printed meta (`additionalSpawns` and
// friends) is card data and stays.
// The snapshot form a card takes on its way out of play: per-entry stamps
// removed, captor stamps stripped. Extracted so exactly one derivation exists —
// discardCard writes it, and reviveEntry (shared/engine/battleTriggers.ts)
// rebuilds it to find which pile entry belongs to a hull it is bringing back.
// A second, drifting copy of this logic would let a revive remove the wrong
// snapshot.
export function discardSnapshotOf(card: CardInstance, controller: Side): SnapshotCard {
  // Every per-entry stamp must be named here. TypeScript does NOT catch one you
  // forget — extra properties in a rest spread are legal — so it would ride
  // into state.destroyed and, via reshuffleDiscard, into a deck.
  const {
    instanceId: _instanceId, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot
  } = card as ZoneCardEntry
  const owner = ownerSideOf(card, controller)
  const { costDelta: _costDelta, ...withoutCostDelta } = snapshot.meta
  snapshot.meta = withoutCostDelta
  if (owner !== controller) {
    const { ownerSide: _ownerSide, ...meta } = snapshot.meta
    snapshot.meta = meta
  }
  return snapshot as SnapshotCard
}

export function discardCard(game: EngineGame, controller: Side, card: CardInstance): void {
  // Summon-only cards are spawned, never drafted (spec §7.1). They must never
  // reach a discard, because that is a deck's back door. This is the single
  // exit out of play, so guarding it here covers every path at once.
  if (isSummonOnly(card)) return
  game.state.destroyed[ownerSideOf(card, controller)].push(discardSnapshotOf(card, controller))
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
          discardCard(game, s, entry)
          game.state.log.push(`${entry.name} despawned (temporary)`)
        } else {
          keep.push(entry)
        }
      }
      zone.cards[s] = keep
    }
  }
  game.state.resources[side].materials =
    Math.floor(game.turnNumber) * materialsPerTurnOf(game.settings)
  drawCard(game, side, ctx)

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

// Walking away from an unfinished game — same loss as conceding, but the
// game is marked abandoned so My Games can tell the two apart.
function abandon(game: EngineGame, actor: Side): ApplyResult {
  game.status = 'abandoned'
  game.winnerId = actor === 'a' ? game.playerB : game.playerA
  game.state.log.push(`Player ${actor.toUpperCase()} abandoned the battle`)
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
  if (game.state.pendingEffect !== null && !PENDING_ACTIONS.has(action.type)) {
    return err(409, 'A card effect is waiting on a choice — resolve it first')
  }
  // pendingEffect and battleFrozen may BOTH be set at once. Wave 4 made that
  // ordinary rather than hypothetical: DP2 fires at battle lock, and two cards
  // suspend there — Terawatt's join and DWG Waters' clause-2 summon — so the
  // choice is written while the activeBattle that raised it still stands
  // (spec §4.3, DP2 departure 3; decision 19). An earlier version of this
  // comment argued the state was unreachable, on the grounds that
  // DECIDE_BATTLE_REPORT nulls activeBattle before firing any effect. That
  // argument only ever covered the RESOLVE half of the battle lifecycle; the
  // lock half now reaches it directly.
  //
  // Three properties, all of which predate wave 4, are what make it safe — and
  // shared/engine/battleFreeze.test.ts pins the whole sequence end to end:
  //   1. The pendingEffect check above runs FIRST and admits only
  //      PENDING_ACTIONS, so the battle actions BATTLE_ACTIONS would otherwise
  //      allow (SUBMIT/DECIDE_BATTLE_REPORT, USE_HERO_POWER) stay rejected
  //      while a choice is owed.
  //   2. pendingAdmitted below stops this battle check from ALSO rejecting the
  //      one action that can clear the slot — RESOLVE_PENDING_EFFECT, including
  //      { cancel: true }, the escape hatch that exists precisely to unstick a
  //      stranded game. Without it, CONCEDE/ABANDON would be all that is left.
  //   3. RESOLVE_PENDING_EFFECT is an OFF_TURN_ACTION, which is what lets the
  //      DEFENDER answer a lock-time choice on the aggressor's turn.
  // Once answered or declined, pendingEffect is null and the battle is
  // reportable exactly as it would have been. This does not widen
  // BATTLE_ACTIONS, and changes nothing when only one freeze is set:
  // pendingAdmitted is false whenever pendingEffect is null, so the
  // lone-battleFrozen case is byte-identical to what it always was.
  const pendingAdmitted = game.state.pendingEffect !== null && PENDING_ACTIONS.has(action.type)
  if (battleFrozen(game.state) && !BATTLE_ACTIONS.has(action.type) && !pendingAdmitted) {
    return err(409, 'A battle is in progress — resolve it first')
  }
  if (!OFF_TURN_ACTIONS.has(action.type) && game.activePlayer !== actorId) {
    return err(409, 'Not your turn')
  }
  if (action.type === 'END_TURN') return finish(endTurn(game, ctx))
  if (action.type === 'CONCEDE') return finish(concede(game, actor))
  if (action.type === 'ABANDON') return finish(abandon(game, actor))
  const handler = handlers.get(action.type)
  if (!handler) return err(400, `Unknown or not-yet-supported action: ${action.type}`)
  return finish(handler(game, actor, action, ctx))
}
