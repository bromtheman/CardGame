import { KEYWORDS, LOG_MAX_ENTRIES, VEHICLE_TYPES } from '../gameSettings.ts'
import { materialsPerTurnOf } from '../lobbySettings.ts'
import { secureRng } from './gameInit.ts'
import { upkeepOwedBy } from './costs.ts'
import type { CardInstance, PublicGameState, SnapshotCard, ZoneEffect } from './gameInit.ts'
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

// A copy taken out of the enemy deck (Marauder, Paddlegun, Plunderer). The
// original never moved, so this card has no deck to go home to: it is
// destroyed when it leaves play. Stamped by takeFromEnemyDeck.
export const isCapturedCopy = (card: { meta: Record<string, unknown> }): boolean =>
  card.meta.capturedCopy === true

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
    // Wave 6's per-zone battle-loss record. Repaired half-written rather than
    // replaced wholesale: an older row has no key at all, but a partially
    // written one must keep the side it does carry.
    const z = zone as unknown as Record<string, unknown>
    if (z.lostBattleOnTurn === undefined || z.lostBattleOnTurn === null) {
      z.lostBattleOnTurn = { a: null, b: null }
    } else {
      const record = z.lostBattleOnTurn as Partial<Record<Side, number | null>>
      for (const side of ['a', 'b'] as Side[]) {
        if (record[side] === undefined) record[side] = null
      }
    }
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

// A hull minted off a captured copy is a card of the minter's own — it is not
// itself a capture, so it survives leaving play and reaches its minter's
// discard like anything else. Every mint-a-copy effect runs the source card's
// meta through this, or the new hull would inherit the phantom stamp and be
// destroyed on its way out.
export function copyMeta(meta: Record<string, unknown>): Record<string, unknown> {
  if (!('capturedCopy' in meta)) return meta
  const { capturedCopy: _capturedCopy, ...rest } = meta
  return rest
}

// The snapshot form a card takes on its way out of play: per-entry stamps
// removed. Extracted so exactly one derivation exists — discardCard writes it,
// and reviveEntry (shared/engine/battleTriggers.ts) rebuilds it to find which
// pile entry belongs to a hull it is bringing back. A second, drifting copy of
// this logic would let a revive remove the wrong snapshot.
//
// It takes no side, because a card leaving play only ever reaches its own
// controller's discard. `costDelta` (spec §4.5: a per-instance delta) is
// dropped here for every card — reshuffleDiscard mints a fresh instanceId for
// every returning card, so the instance the delta belonged to no longer
// exists. Excalibur is the case that makes this matter: it discounts a vehicle
// in its owner's own hand, so leaving the stamp on would make that owner
// permanently discounted on their own card once it dies and reshuffles back —
// and stack again on every reuse. Printed meta (`additionalSpawns` and
// friends) is card data and stays.
export function discardSnapshotOf(card: CardInstance): SnapshotCard {
  // Every per-entry stamp must be named here. TypeScript does NOT catch one you
  // forget — extra properties in a rest spread are legal — so it would ride
  // into state.destroyed and, via reshuffleDiscard, into a deck.
  const {
    instanceId: _instanceId, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot
  } = card as ZoneCardEntry
  // `factoryEscort` (wave 7) comes off for exactly costDelta's reason: it is a
  // per-INSTANCE grant, stamped onto one hull on the board by a Havoc/Mirth
  // Factory that has since been spent. Left on, it would ride into
  // state.destroyed and — through reshuffleDiscard — back into the deck, so a
  // Factory'd hull would return PERMANENTLY upgraded, and again after every
  // later death. This is the strip list the comment above warns about; nothing
  // in TypeScript would have caught the omission.
  const { costDelta: _costDelta, factoryEscort: _factoryEscort, ...withoutCostDelta } = snapshot.meta
  snapshot.meta = withoutCostDelta
  return snapshot as SnapshotCard
}

export function discardCard(game: EngineGame, controller: Side, card: CardInstance): void {
  // Two kinds of card must never reach a discard, because that is a deck's
  // back door. Summon-only cards are spawned, never drafted (spec §7.1). A
  // captured copy was never in the captor's deck and never left its owner's,
  // so filing it anywhere would mint a card that did not exist. This is the
  // single exit out of play, so guarding both here covers every path at once.
  if (isSummonOnly(card) || isCapturedCopy(card)) return
  game.state.destroyed[controller].push(discardSnapshotOf(card))
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

// The ending side's half of DP5. Two lists, one pass, both scoped to that
// side and to items due at or before the turn number as it stands now.
//
// The tails live here rather than being dispatched back into their effects,
// for the same reason changeOrderDraw's whole redelivery lives in endTurn:
// this function already owns expiry, and a rider's card was spent turns ago.
// Dispatching would need a new payload discriminator and would force
// { needsCatalog: true } onto two effects purely so the dispatcher could mint
// a payload card that neither tail reads.
function turnEndRiders(game: EngineGame, endingSide: Side, ctx: EngineContext): void {
  // Sabotage: "if it survives the turn, draw a card". The hull is looked for
  // across the whole board — the target may be either player's, and it may
  // have been relocated since (spec §7.3).
  const stillScheduled: PublicGameState['scheduled'] = []
  for (const item of game.state.scheduled) {
    // Switch on TYPE, not just on side and due date: changeOrderDraw belongs
    // to the incoming-side loop below, and an item of that type due for the
    // ending side must survive this pass untouched.
    if (item.type !== 'sabotageWatch' || item.side !== endingSide || game.turnNumber < item.dueTurn) {
      stillScheduled.push(item)
      continue
    }
    if (findVehicle(game.state, item.instanceId)) {
      drawCard(game, endingSide, ctx)
      game.state.log.push(`A sabotaged vehicle survived the turn — player ${endingSide.toUpperCase()} draws`)
    }
  }
  game.state.scheduled = stillScheduled

  // Rest-of-turn zone riders. `expiresOnTurn` absent means permanent, which is
  // what every row written before wave 5 is.
  const stillRiding: ZoneEffect[] = []
  for (const rider of game.state.zoneEffects) {
    if (
      rider.side !== endingSide ||
      rider.expiresOnTurn === undefined ||
      game.turnNumber < rider.expiresOnTurn
    ) {
      stillRiding.push(rider)
      continue
    }
    // The compensation draw each card's own text prints (Ambush, Ongoing
    // Attrition). A rider still standing at turn end is one that was never
    // spent — both cards remove their own entry the moment they fire, so
    // reaching here IS "unused".
    if (rider.data?.drawOnExpiry === true) {
      drawCard(game, endingSide, ctx)
      game.state.log.push(
        `${rider.cardName} expired unused in zone ${rider.zoneId} — player ${endingSide.toUpperCase()} draws`,
      )
    } else {
      game.state.log.push(`${rider.cardName} expired in zone ${rider.zoneId}`)
    }
  }
  game.state.zoneEffects = stillRiding
}

function endTurn(game: EngineGame, ctx: EngineContext): ApplyResult {
  // The side whose turn is ENDING is whoever is active right now — capture it
  // before activePlayer flips below, so alert expiry checks the right side.
  const endingSide = sideOf(game, game.activePlayer) as Side
  // DP5's turn-end pass (spec §4.3, "DP5 as wave 5 built it"). Runs for the
  // side whose turn is ENDING, and BEFORE turnNumber moves — which is the
  // whole reason it is a second pass rather than a widening of the scheduled
  // loop further down. That loop runs after the flip and serves the INCOMING
  // side, so the earliest it can fire for the acting player is a full round
  // later; every wave-5 tail reads "…the turn", meaning the actor's own
  // (spec §7.3). Running pre-increment also settles Sabotage's only
  // ambiguity: a Temporary hull is culled at the NEXT turn's start, so it did
  // survive this one.
  turnEndRiders(game, endingSide, ctx)
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

  // Wave 7's UPKEEP_REQUIRED (spec §7.3, rulings U-0 … U-7). Its position is
  // three rulings at once, so it must stay exactly here:
  //
  //   * AFTER the Temporary cull above, so a hull that despawned this turn
  //     start pays nothing (U-6). No card carries both keywords today; the
  //     ordering is free and it is the honest one.
  //   * AFTER income is SET rather than accumulated, which is what makes a
  //     shortfall impossible to carry forward as debt, and what makes the 15%
  //     rate scale-invariant (U-8).
  //   * Billed to the side whose turn is STARTING, which is the whole of why a
  //     hull deployed this turn pays nothing until its owner's next turn (U-5).
  //
  // The clamp is U-3, and it is a choice rather than a formality: income is
  // reset every turn so a negative could never persist, but canAffordInGame
  // compares `materials >= cost`, so an unclamped negative would behave
  // plausibly and silently.
  const upkeep = upkeepOwedBy(game.state, side)
  if (upkeep > 0) {
    game.state.resources[side].materials = Math.max(0, game.state.resources[side].materials - upkeep)
    // ONE line carrying the total, never one per hull — the same call §4.4
    // makes for "N summoned vehicle(s) evaporated" rather than six lines for
    // six Martyrs (U-7). Board hulls are public, so naming them would leak
    // nothing; a total simply reads better.
    game.state.log.push(`Player ${side.toUpperCase()} pays ${upkeep} upkeep`)
  }

  drawCard(game, side, ctx)

  // Change Order redeliveries (Task 7): process every scheduled item due for
  // the incoming side now that their materials/draw have already landed.
  // Processed items (hit or fizzle) are dropped; anything not yet due, or
  // belonging to the other side, is carried forward untouched.
  const stillScheduled: PublicGameState['scheduled'] = []
  for (const item of game.state.scheduled) {
    // The type check is part of the carry-forward condition, not just a
    // dispatch: `scheduled` became a real union in wave 5, and a loop that
    // consumed every due item of its side would silently EAT the types it
    // cannot handle. turnEndRiders above owns sabotageWatch and mirrors this.
    if (item.type !== 'changeOrderDraw' || item.side !== side || game.turnNumber < item.dueTurn) {
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
