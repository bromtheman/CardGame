import type { CardInstance, SnapshotCard } from '../engine/gameInit.ts'
import type {
  BattleCasualty, BattleContext, EngineContext, EngineGame, Side, ZoneCardEntry,
} from '../engine/engineTypes.ts'
import { drawCard, findVehicle, otherSide } from '../engine/gameEngine.ts'
import { canRevive, reviveEntry, sacrificeEntry } from '../engine/battleTriggers.ts'
import type { EffectFn, EffectPayload } from './registry.ts'

// Move one card from the enemy's deck into the actor's hand. The log line
// must not name it — it is going into a hidden hand. A fresh instanceId is
// minted because the card is changing owners.
export function takeFromEnemyDeck(
  game: EngineGame, actor: Side, ctx: EngineContext,
  filter?: (card: CardInstance) => boolean,
): boolean {
  const enemy = otherSide(actor)
  const deck = game.privates[enemy].deck
  const index = filter ? deck.findIndex(filter) : (deck.length > 0 ? 0 : -1)
  if (index < 0) {
    game.state.log.push(`Player ${actor.toUpperCase()} finds nothing to take from the enemy deck`)
    return true
  }
  const [card] = deck.splice(index, 1)
  // Stamped with where it came from: a captured card is on loan, and every
  // exit out of play (discardCard) sends it home to the deck it was built
  // into instead of confiscating it into the captor's.
  game.privates[actor].hand.push({
    ...card, instanceId: ctx.newId(), meta: { ...card.meta, ownerSide: enemy },
  })
  game.state.counts[actor].hand = game.privates[actor].hand.length
  game.state.counts[enemy].deck = deck.length
  game.state.log.push(`Player ${actor.toUpperCase()} takes a card from the enemy deck`)
  return true
}

export interface GrantSpec {
  draw?: number
  cp?: number
  materials?: number
  from?: 'own' | 'enemy'
}

// Draw cards and/or add CP and materials. The workhorse: 17 built-in cards
// are nothing more than one of these.
export function grant(spec: GrantSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    for (let i = 0; i < (spec.draw ?? 0); i++) {
      if (spec.from === 'enemy') takeFromEnemyDeck(game, actor, ctx)
      else drawCard(game, actor, ctx)
    }
    if (spec.cp) game.state.resources[actor].cp += spec.cp
    if (spec.materials) game.state.resources[actor].materials += spec.materials
    return true
  }
}

// Run effects in order, stopping at the first failure.
export function sequence(...fns: EffectFn[]): EffectFn {
  return (payload) => {
    for (const fn of fns) if (!fn(payload)) return false
    return true
  }
}

export interface PoolFilter {
  faction?: string
  vehicleType?: string
  type?: string
  isBuiltIn?: boolean
  maxCost?: number
  minCost?: number
  // A seeded marker key that must be exactly `true` on the card's meta
  // (wave 7). The same "the rule reads off seeded data, so the next card needs
  // no engine edit" pattern as `blocksFaction`, `aircraftLock` and
  // `defensiveOmission`.
  //
  // It exists because a pool defined by FACTION is a query over the whole
  // cards table rather than a card list: LH's four borrowed "[TG] …" ships
  // were `faction === 'TG'`, so seeding the 26-card TG faction would have
  // silently taken that pool from 4 rows to 30 (spec §7.3, ruling L-1).
  metaFlag?: string
}

export interface PoolSpec {
  source: 'catalog' | 'deck'
  filter: PoolFilter
  count: number
  strip?: string[]
  // Catalog pools that come up empty are a data bug and fail by default. Deck
  // pools are often legitimately empty ("if you have one" is printed on the
  // card), so a deck source defaults to allowEmpty — pass false to require a
  // match instead.
  allowEmpty?: boolean
}

// Cost filters read the printed materialCost — "base cost" in card text —
// never effectiveMaterialCostOf.
function matches(card: { faction: string; vehicleType: string | null; type: string; isBuiltIn: boolean; materialCost: number; meta: Record<string, unknown> }, f: PoolFilter): boolean {
  if (f.faction !== undefined && card.faction !== f.faction) return false
  if (f.vehicleType !== undefined && card.vehicleType !== f.vehicleType) return false
  if (f.type !== undefined && card.type !== f.type) return false
  if (f.isBuiltIn !== undefined && card.isBuiltIn !== f.isBuiltIn) return false
  if (f.maxCost !== undefined && card.materialCost > f.maxCost) return false
  if (f.minCost !== undefined && card.materialCost < f.minCost) return false
  // Strict `=== true`, never truthiness: a data key's VALUE is what the engine
  // compares, and a mistyped one must leave the card OUT of the pool rather
  // than in it (docs/claude/card-effects.md, guard blind spot 4).
  if (f.metaFlag !== undefined && card.meta[f.metaFlag] !== true) return false
  return true
}

function shuffled<T>(items: T[], ctx: EngineContext): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Put `count` cards matching `filter` into the actor's hand, either minted
// from the built-in catalog or moved out of the actor's own deck. The log
// never names them — they are entering a hidden hand.
export function drawFromPool(spec: PoolSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    const hand = game.privates[actor].hand
    const allowEmpty = spec.allowEmpty ?? spec.source === 'deck'
    if (spec.source === 'catalog') {
      const pool = ctx.catalog.filter((c) => c.isBuiltIn && c.meta.summonOnly !== true && matches(c, spec.filter))
      if (pool.length === 0) {
        if (!allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        hand.push({
          ...pick,
          instanceId: ctx.newId(),
          keywords: spec.strip ? pick.keywords.filter((k) => !spec.strip!.includes(k)) : pick.keywords,
        })
      }
    } else {
      const deck = game.privates[actor].deck
      const pool = deck.filter((c) => matches(c, spec.filter))
      if (pool.length === 0) {
        if (!allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card in their deck`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        const index = deck.findIndex((c) => c.instanceId === pick.instanceId)
        if (index < 0) continue
        const [card] = deck.splice(index, 1)
        hand.push(spec.strip ? { ...card, keywords: card.keywords.filter((k) => !spec.strip!.includes(k)) } : card)
      }
      game.privates[actor].deck = deck
    }
    game.state.counts[actor] = { hand: hand.length, deck: game.privates[actor].deck.length }
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  }
}

// Vehicles already in the target zone, excluding whatever this play just
// placed. `side: 'own'` counts only the actor's; 'either' counts both.
// Returns null when there is no target zone at all — callers building a
// whenPlayed predicate must not read that the same as an empty zone (an
// empty array), or a reachable-but-targetless play would satisfy an
// "is the zone empty?" check it never should.
export function zoneOccupants(p: EffectPayload, side: 'own' | 'either'): CardInstance[] | null {
  const zone = p.game.state.zones.find((z) => z.id === p.targetZoneId)
  if (!zone) return null
  const placed = new Set(p.placedInstanceIds ?? [])
  const mine = zone.cards[p.actor].filter((c) => !placed.has(c.instanceId))
  if (side === 'own') return mine
  const theirs = zone.cards[otherSide(p.actor)].filter((c) => !placed.has(c.instanceId))
  return [...mine, ...theirs]
}

// Run `body` only when `predicate` holds. A false predicate is not a
// failure — the effect resolved, it simply did nothing. A predicate built
// around zoneOccupants must treat its null (no such zone) as "does not
// hold" — see zoneOccupants and its two call sites.
export function whenPlayed(predicate: (p: EffectPayload) => boolean, body: EffectFn): EffectFn {
  return (payload) => (predicate(payload) ? body(payload) : true)
}

// Find a built-in card by its printed name. Summoning cards name their hull
// in card text ("spawn two parapets"), so the name is the only stable key —
// card ids are generated at seed time.
export function catalogCard(ctx: EngineContext, cardName: string): SnapshotCard | null {
  return ctx.catalog.find((c) => c.isBuiltIn && c.name === cardName) ?? null
}

// Build one ZoneCardEntry off a catalog snapshot — the per-entry stamp list
// (playedOnTurn, movedOnTurn, activatedOnTurn) lives here and nowhere else.
// Keywords come from the summoning card, on top of whatever the row prints;
// the merge is idempotent (a keyword already printed is not duplicated).
// Touches no zone — callers decide whether the hull is pushed onto the board
// (spawnInto) or kept off it entirely as a battle summon (summonHulls).
export function mintHull(
  game: EngineGame, ctx: EngineContext, snapshot: SnapshotCard, keywords: string[] = [],
): ZoneCardEntry {
  return {
    ...snapshot,
    instanceId: ctx.newId(),
    keywords: [...snapshot.keywords, ...keywords.filter((k) => !snapshot.keywords.includes(k))],
    playedOnTurn: game.turnNumber,
    movedOnTurn: null,
    activatedOnTurn: null,
  }
}

// Place one hull on the board. SPAWNING IS NOT PLAYING (spec §7.4): no
// payment, no placement legality, no onPlayEffect.
export function spawnInto(
  game: EngineGame, ctx: EngineContext, actor: Side, zoneId: number,
  snapshot: SnapshotCard, keywords: string[] = [],
): ZoneCardEntry | null {
  const zone = game.state.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const entry = mintHull(game, ctx, snapshot, keywords)
  zone.cards[actor].push(entry)
  return entry
}

// Mint `count` hulls of a named catalog card without touching any zone. A
// battle summon (spec §4.4) exists only inside ActiveBattle.summons — never
// zone.cards — so this is spawnInto's construction half with the placement
// half removed. A card missing from the catalog is a data bug, not an empty
// pool: null tells the caller to fail the play rather than fizzle, the same
// contract spawnVehicles already uses for the same reason.
export function summonHulls(
  game: EngineGame, ctx: EngineContext, cardName: string, count: number, keywords: string[] = [],
): ZoneCardEntry[] | null {
  const snapshot = catalogCard(ctx, cardName)
  if (!snapshot) return null
  const hulls: ZoneCardEntry[] = []
  for (let i = 0; i < count; i++) hulls.push(mintHull(game, ctx, snapshot, keywords))
  return hulls
}

// Spawn `count` copies of a named catalog card into the played zone, or into
// every zone. A card missing from the catalog is a data bug, not an empty
// pool, so it fails the play rather than fizzling.
export function spawnVehicles(spec: {
  cardName: string
  count: number
  zones: 'target' | 'all'
  keywords?: string[]
}): EffectFn {
  return ({ game, actor, ctx, targetZoneId }) => {
    const snapshot = catalogCard(ctx, spec.cardName)
    if (!snapshot) return false
    const zoneIds = spec.zones === 'all'
      ? game.state.zones.map((z) => z.id)
      : typeof targetZoneId === 'number' ? [targetZoneId] : []
    if (zoneIds.length === 0) return false
    let spawned = 0
    for (const zoneId of zoneIds) {
      for (let i = 0; i < spec.count; i++) {
        if (spawnInto(game, ctx, actor, zoneId, snapshot, spec.keywords)) spawned++
      }
    }
    if (spawned === 0) return false
    game.state.log.push(
      `${spawned} ${spec.cardName}${spawned === 1 ? '' : 's'} spawned for player ${actor.toUpperCase()}`,
    )
    return true
  }
}

// Stamp a persistent per-instance cost change onto a card in the actor's
// hand, the way doubleUpEffect stamps additionalSpawns. Read only by
// effectiveCostInGame — never by effectiveMaterialCostOf.
export function costDelta(spec: { delta: number; filter: PoolFilter }): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
    if (!target || !matches(target, spec.filter)) return false
    const current = typeof target.meta.costDelta === 'number' ? target.meta.costDelta : 0
    target.meta = { ...target.meta, costDelta: current + spec.delta }
    return true
  }
}

// Add keywords to a card, either in the actor's hand or anywhere on the
// field. Idempotent — a keyword the target already carries is not duplicated.
export function grantKeywords(spec: {
  keywords: string[]
  target: 'hand' | 'field'
  filter?: PoolFilter
}): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const card = spec.target === 'hand'
      ? game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
      : findVehicle(game.state, targetInstanceId)?.entry
    if (!card) return false
    if (spec.filter && !matches(card, spec.filter)) return false
    card.keywords = [...card.keywords, ...spec.keywords.filter((k) => !card.keywords.includes(k))]
    return true
  }
}

export interface ChoiceOption { id: string; label: string }

// Enemy vehicles a forced-battle choice may offer as a target. `zoneId: null`
// searches every zone — Orbit Flank's mode (b) picks an enemy vehicle
// anywhere on the board, not just where Orbit Flank itself was played, so a
// zone-scoped-only signature would leave that mode unimplementable. On-field
// vehicles are already public, so surfacing this as pendingEffect.options
// leaks nothing (spec §4.3, departure 4).
export function enemyVehicleOptions(
  game: EngineGame, actor: Side, zoneId: number | null,
  filter?: (e: ZoneCardEntry) => boolean,
): ChoiceOption[] {
  const enemy = otherSide(actor)
  const zones = zoneId === null ? game.state.zones : game.state.zones.filter((z) => z.id === zoneId)
  const options: ChoiceOption[] = []
  for (const zone of zones) {
    for (const entry of zone.cards[enemy] as ZoneCardEntry[]) {
      if (filter && !filter(entry)) continue
      options.push({ id: entry.instanceId, label: entry.name })
    }
  }
  return options
}

// The mirror of enemyVehicleOptions, for a card that targets its OWN side
// (wave 7 — TG Alarmed's sacrifice is the first). Own-board vehicles are
// already public, so surfacing them as pendingEffect.options leaks nothing,
// exactly as for the enemy's.
//
// ⚠ It has no notion of `placedInstanceIds`, deliberately — a caller firing
// from a PLAY handler must exclude what that play just placed via `filter`,
// because PLAY_CARD_TO_ZONE deploys the hull BEFORE effects run and the card
// would otherwise offer itself.
export function friendlyVehicleOptions(
  game: EngineGame, actor: Side, zoneId: number | null,
  filter?: (e: ZoneCardEntry) => boolean,
): ChoiceOption[] {
  const zones = zoneId === null ? game.state.zones : game.state.zones.filter((z) => z.id === zoneId)
  const options: ChoiceOption[] = []
  for (const zone of zones) {
    for (const entry of zone.cards[actor] as ZoneCardEntry[]) {
      if (filter && !filter(entry)) continue
      options.push({ id: entry.instanceId, label: entry.name })
    }
  }
  return options
}

// Suspend for a player decision (spec §4.2, DP4). First entry writes
// state.pendingEffect and returns true; RESOLVE_PENDING_EFFECT re-enters the
// same registry name with `resolution` set and runs `resolve`.
//
// Empty options do NOT suspend — they call resolve(payload, null) straight
// away, so a card whose choice is optional still runs its tail. Kraken needs
// exactly this: "refresh one of your hero powers then gain 1cp" must still
// grant the CP for a player with no used powers.
export function choice(spec: {
  effect: string
  prompt: string
  options: (p: EffectPayload) => ChoiceOption[]
  data?: (p: EffectPayload) => Record<string, unknown>
  resolve: (p: EffectPayload, choiceId: string | null) => boolean
}): EffectFn {
  return (payload) => {
    if (payload.resolution === undefined) {
      const options = spec.options(payload)
      if (options.length === 0) return spec.resolve(payload, null)
      // There is exactly one suspension slot, and wave 4 made it possible for
      // two effects to want it in the same action: a battle can dispatch
      // several triggers, and a battle continuation fires alongside them. An
      // offer that arrives second is DROPPED rather than overwriting the
      // choice already owed (spec §4.3, DP2 departure 4).
      //
      // Dropped here, at the suspension itself, rather than by the dispatcher
      // skipping the whole effect: that is what lets a card whose text has an
      // unconditional clause AND an optional one — Sacrilego's "gain 1cp.
      // Additionally you may sacrifice it…" — still grant the CP when its
      // offer cannot be made.
      if (payload.game.state.pendingEffect !== null) {
        payload.game.state.log.push(
          `${payload.card.name}'s offer was not made — another choice is already pending`,
        )
        return true
      }
      payload.game.state.pendingEffect = {
        effect: spec.effect,
        side: payload.actor,
        card: payload.card,
        kind: 'choice',
        prompt: spec.prompt,
        options,
        data: spec.data ? spec.data(payload) : undefined,
      }
      payload.game.state.log.push(`${payload.card.name} is waiting on a choice`)
      return true
    }
    const chosen = payload.resolution.choiceId
    const known = payload.pending?.options ?? []
    if (typeof chosen !== 'string' || !known.some((o) => o.id === chosen)) return false
    return spec.resolve(payload, chosen)
  }
}

// "You may sacrifice this vehicle to save one of the hulls that just died."
// Iron Cordon and Sacrilego's clause 2 are the same shape with different
// eligibility rules, so the whole two-phase dance lives here once.
//
// First entry (a DP2 resolve trigger, so `battle` is set) offers the choice
// and STASHES the eligible casualties. That stash is not an optimisation: by
// re-entry, activeBattle and pendingReport are null and state.destroyed holds
// bare snapshots with no instanceId, so `battle.casualties` is unrecoverable.
// It is also why nothing here reads payload.resolution's own
// targetInstanceId/zoneId, which are client-supplied and unvalidated
// (docs/claude/card-effects.md, "Suspending for a choice").
//
// Options carry the dead hulls' names, which were public on the board a moment
// ago, so this leaks nothing (spec §4.2, departure 5).
export function sacrificeToSave(spec: {
  effect: string
  prompt: string
  eligible: (battle: BattleContext, actor: Side) => BattleCasualty[]
}): EffectFn {
  const eligibleFor = (p: EffectPayload) => {
    if (!p.battle) return []
    // `casualties` is required by the type, but a hand-built context in a test
    // can omit it, and fire() has no try/catch — a throw there would take the
    // whole DECIDE_BATTLE_REPORT down rather than logging a failed trigger.
    const battle = { ...p.battle, casualties: p.battle.casualties ?? [] }
    // Only offer what can actually be brought back. A death trigger dispatched
    // EARLIER in this same DECIDE_BATTLE_REPORT can empty the discard —
    // grant({ draw: 1 }) on an empty deck reshuffles the whole pile into it —
    // and a casualty whose snapshot has gone that way is unrevivable. Offering
    // it would leave the player a choice whose only working answer is Decline.
    return spec.eligible(battle, p.actor).filter((c) => canRevive(p.game, c.side, c.entry))
  }
  return choice({
    effect: spec.effect,
    prompt: spec.prompt,
    // Ending HP disambiguates two casualties of the same card — the dialog
    // renders the label alone, so two identical buttons would be a coin flip.
    // It is public: pendingReport.results lives in PublicGameState.
    options: (p) => eligibleFor(p).map((c) => ({
      id: c.entry.instanceId, label: `${c.entry.name} (${c.hp}%)`,
    })),
    data: (p) => ({ zoneId: p.battle?.zoneId, entries: eligibleFor(p).map((c) => c.entry) }),
    resolve: ({ game, actor, card, pending }, choiceId) => {
      // Empty options resolve straight through with null — nothing was
      // eligible, so there is nothing to do and nothing to fail.
      if (choiceId === null) return true
      const zoneId = pending?.data?.zoneId
      const entries = pending?.data?.entries
      if (typeof zoneId !== 'number' || !Array.isArray(entries)) return false
      const target = (entries as ZoneCardEntry[]).find((e) => e.instanceId === choiceId)
      if (!target) return false
      // Both halves are validated before either is applied. A false return
      // discards applyAction's whole clone anyway, but keeping the order
      // revive-then-sacrifice means a hull is never spent for nothing.
      if (!reviveEntry(game, actor, target, zoneId)) return false
      if (!sacrificeEntry(game, actor, card.instanceId, zoneId)) return false
      game.state.log.push(`${card.name} is sacrificed to save ${target.name}`)
      return true
    },
  })
}
