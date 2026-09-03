# Architecture — engine, state, and data flow

Read this before touching `shared/engine/`, `shared/effects/`, game state shape,
or any game action. The spec (`docs/superpowers/specs/2026-08-24-ftd-card-game-design.md`)
is the authority on rules; this doc explains how the code realizes them.

## Data flow

```
frontend (supabase-js) ──invoke──> edge function ──applyAction──> apply_action_tx RPC ──> games row
        ▲                                                                     │
        └────────────── Supabase Realtime (postgres_changes) ─────────────────┘
```

- The client never writes game state directly. It calls `game-action` with
  `{ gameId, expectedVersion, action }`; the function loads the row, runs the pure
  engine, and commits via the `apply_action_tx` RPC (optimistic concurrency — a
  version mismatch returns `null` → the function answers **409**, client refetches).
- The same `shared/` engine code runs in the browser (legality preview,
  affordability, zone highlighting) and in Deno (authoritative).

## Engine shape (`shared/engine/`)

- `applyAction(input, actorId, action, ctx = defaultEngineContext())` in
  `gameEngine.ts` is the single entry point. It `structuredClone`s the game, so a
  handler that returns an error leaves the original untouched — **but only if the
  handler validates before mutating its clone**. Keep that discipline.
- Handlers self-register: each module calls `registerHandler(type, fn)` at import
  time, and `shared/engine/index.ts` aggregates the side-effect imports. That is why
  consumers must import the index (see CLAUDE.md hard rules). END_TURN, CONCEDE,
  and ABANDON are dispatched inline in `gameEngine.ts`, not via the registry.
- **Where card effects fire.** Playing a card is not the only path: the
  `PLAY_CARD_*` handlers in `placement.ts` dispatch the `onPlay`/`playOn*` keys,
  `battleResolve.ts` dispatches `onDeathEffect`, and `ACTIVATE_VEHICLE`
  (`shared/engine/activate.ts`) dispatches `onActivate` for a hull **already on
  the board**. Activating is not playing: no placement legality, no material
  cost, no `spendCard` — it costs `meta.activateCpCost` CP and stamps
  `entry.activatedOnTurn = game.turnNumber` **before** the effect runs, so a
  once-per-turn ability that suspends cannot be re-entered through a second
  activation. A card needs *both* `onActivate` and `activateCpCost` or it has no
  activated ability at all (see [card-effects.md](card-effects.md)).
- **DP2, the battle triggers (`shared/engine/battleTriggers.ts`).** Built in
  wave 4. It registers no handler; three existing seams call it —
  `battleDeclare.ts` at lock, `battleResolve.ts` at resolve, `baseAttack.ts` on
  a bombardment. Effects receive a `BattleContext` on `payload.battle`
  (`phase`, `zoneId`, `isDefender`, `isParticipant`, `forced`, `survived`,
  `won`, `casualties`), and its presence is the only thing distinguishing a
  battle trigger from an ordinary play — the role `continuation` plays for
  Trebuchet. `casualties` is resolve-only and is the **sole** route to "which
  hulls died here, at what HP": by then `activeBattle` and `pendingReport` are
  null and `state.destroyed` holds bare snapshots.
  - **Lock has three sources**, in this order: every participant on both sides
    (summons included); then, **only for a forced battle**, the defending
    side's non-participants in that zone whose effect registered
    `{ battleBystander: true }` (Terawatt alone); then `state.zoneEffects`
    riders on that zone, **on both sides** since wave 5 — Ambush and Ongoing
    Attrition fire on a battle their own owner declares, which the original
    defender-only pass could never reach. Each rider reads its own
    `isDefender` and self-selects. The bystander flag is what keeps every
    other battle trigger out of the second pass, so no other card needs an
    `isParticipant` guard it could forget.
  - **A rider effect needs `{ needsCatalog: true }` even when it reads no
    catalog.** `fireRider` mints the rider's payload card from `ctx.catalog`
    by `cardName`, so without the flag `game-action` never loads one and the
    rider is silently skipped in production while every unit test passes. The
    one exception is a rider that is pure data and never needs to *run* — Sub
    Killer's placement block — which loses nothing by being skipped.
  - **`ATTACK_ENEMY_BASE` dispatches the ATTACKER's riders too**
    (`dispatchZoneActivation`, wave 5), after the damage and `checkVictory`,
    with `isDefender: false`. `dispatchZoneInterception` remains the
    defender's half. That is why `dwgWatersInterception` guards on
    `isDefender`: reached as the attacker it would intercept its owner's own
    bombardment, with the roles inverted.
  - **Resolve** fires `onBattleEffect` for every participant, plus
    `onBattleVictory`/`onBattleDefeat` per side outcome — **after** the death
    triggers (so Iron Cordon can see a destroyed airship already in
    `state.destroyed`) and **before** the continuation (so Trebuchet still runs
    last). The continuation now receives the same `BattleContext`, which is
    what stopped it re-deriving its win from a declare-time roster that
    Terawatt's join could make stale.
  - **DP8, the resolve-phase bystander pass (wave 7).** After the participant
    loop, `dispatchBattleResolve` runs a second pass over hulls that are NOT in
    the battle, on **both** sides and in **every** zone, whose `onBattleEffect`
    is registered `{ resolveBystander: true }`. TG Vengeful ("whenever you lose
    a vehicle to a fleet battle — *any zone*") is the only member.
    `BYSTANDER_EFFECTS` could not serve it: that pass is lock-only,
    forced-only, defender-only and same-zone-only. The opt-in is load-bearing
    for DP7's reason — `dwgWatersEffect`'s router falls through to its claim
    branch on any context it does not recognise, so a broadcast would attempt a
    claim with no target zone on every battle in the game.
    ⚠ The context's `zoneId` is the BATTLE's. An effect that needs its own zone
    re-derives it with `findVehicle`, as Braveheart does.
    ⚠ `participants` still holds a DESTROYED hull's entry at resolve, so the
    participant pass reaches a hull that just died. An effect that must not
    fire for one needs its own `findVehicle` guard (Vengeful's ruling E-2b).

- **A per-hull battle rider (wave 7).** `state.zoneEffects` is per-ZONE; TG's
  Havoc/Mirth Factory needed per-HULL, so it stamps `meta.factoryEscort` onto
  the targeted entry and `dispatchBattleLock` dispatches it with the same
  `fire` helper the printed triggers use — a custom meta key rather than a
  `TRIGGERS` one. Three consequences worth knowing before writing the next one:
  the value is the **effect's own registry name**, because `game-action`'s
  catalog probe scans every meta VALUE for a `CATALOG_EFFECTS` member
  regardless of key and the Factory card is spent long before the escort fires;
  a distinct key lets a hull carry both its own printed trigger and an escort
  (Obelisk does); and it **must** be named in `discardSnapshotOf`'s strip list,
  which `onBattleEffect` never could be, because Obelisk and Horror carry that
  key as card data.

- **A cross-zone battle (wave 7).** `ActiveBattle` still carries one `zoneId`
  — the battle's home zone — and TG Duel's away hull is resolved by **id**
  instead. Four sites do a find-by-id fallback: `declareForcedBattle`'s
  `onField` check, `lockRoster`, `participantsOf`, and the destruction branch's
  zone removal. `crossZone` is **opt-in** on `declareForcedBattle`, mirroring
  `activatesZone`, so every other caller keeps its same-zone guard.
  `lostBattleOnTurn` is recorded per side in that side's own participant's
  zone, captured **before** the destruction loop — by the recording point a
  dead hull is off the board and `findVehicle` can no longer place it.
  - **`ATTACK_ENEMY_BASE`** dispatches `onBattleVictory` for exactly the hulls
    `baseStrikersIn` says dealt damage, so Plunderer's one sentence stays one
    implementation. It also offers the defender's zone riders an interception
    first (`dispatchZoneInterception`) — DWG Waters' clause 3 turns the
    bombardment into a battle and no damage lands.
  - **One suspension per event.** There is one slot, and a battle can dispatch
    several triggers. A second offer is **dropped** — by `choice()` itself, not
    by the dispatcher skipping the effect, so a card with an unconditional
    clause as well as an optional one still runs the unconditional half.
  - `joinBattle` (`battleDeclare.ts`) is the only function that appends to a
    battle already in progress; `declareForcedBattle` refuses outright while
    `activeBattle` is non-null, which at lock it always is. `reviveEntry` /
    `sacrificeEntry` / `canRevive` (`battleTriggers.ts`) are the revive
    machinery Iron Cordon and Sacrilego share. **Always check `canRevive`
    before offering a save**: a death trigger dispatched earlier in the same
    `DECIDE_BATTLE_REPORT` can empty the discard (`grant({ draw: 1 })` on an
    empty deck reshuffles the whole pile into it), and a casualty whose
    snapshot has gone that way cannot come back.
  - **`fireDeathEffect(game, ctx, side, entry)`** (`battleTriggers.ts`) is the
    single dispatch for one hull's `onDeathEffect`, used by
    `DECIDE_BATTLE_REPORT` and by Recurring Threat's "choose a friendly
    vehicle, destroy it". **"Destroy" fires it; "remove from play" does not**
    (spec §7.3, decision 28) — Sub Killer removes and fires nothing, the same
    latitude `sacrificeEntry` already takes.
- `EngineContext = { rng: () => number; newId: () => string; catalog: SnapshotCard[] }`.
  Tests inject deterministic rng/ids via `testFixtures.ts` (`makeGame`, `makeCtx`).
  `game-action` injects `secureRng`, `crypto.randomUUID`, and a catalog probe
  (cards referenced by the caller's hand metas) so effects can mint real cards.
- Every success path funnels through `finish()`, which trims `state.log` to
  `LOG_MAX_ENTRIES` (200). Do not push to the log after returning.
- `normalizeState(state)` repairs rows created by older deployed code (missing
  `awaitingResponse`, `factions`, `alertCard`, `scheduled`, `zoneEffects`,
  `pendingEffect`, per-entry `playedOnTurn`/`movedOnTurn`/`activatedOnTurn`, …).
  **A new `PublicGameState` field needs both halves of the pair**: a default in
  `normalizeState` (for rows already in the DB) *and* an initial value in
  `buildInitialGame` in `shared/engine/gameInit.ts` (for new games, which
  `lobby-action` creates). `zoneEffects` (commit `9d93f13`) and `pendingEffect`
  are the two worked examples — copy either.
- All tunables (costs, caps, keywords, `MATERIALS_PER_TURN`, `LOG_MAX_ENTRIES`,
  `ADDITIONAL_SPAWNS_CAP`, …) live in `shared/gameSettings.ts`. Never inline a
  magic number that belongs there.
- A few tunables are **per-lobby overridable**: the host picks them at lobby
  creation, `validateLobbySettings` bounds them, and `lobby-action` START freezes
  them into `game.settings`. `deckRules` and `materialsPerTurn` are the two worked
  examples. Read an overridable tunable through its resolver
  (`materialsPerTurnOf`), never straight from the `gameSettings.ts` constant —
  lobbies and games saved before the setting existed carry no key, and the
  resolver is what keeps them on the default.

## State highlights (`PublicGameState`)

- `zones[]` — three zones, each with `biome`, per-side `baseHp`, and per-side
  `cards` arrays of `ZoneCardEntry` (a card snapshot + `instanceId`,
  `playedOnTurn`, `movedOnTurn`, `activatedOnTurn`). The three stamps are
  **required** fields, so `tsc` finds every entry literal when you add another —
  but see the destructure trap below, which it does not find.
- `pendingEffect` — one suspension slot, `PendingEffect | null`
  (`{ effect, side, card, kind, prompt, options[], data? }`). An effect that
  needs a player decision writes it and returns; `RESOLVE_PENDING_EFFECT`
  (`shared/engine/pendingEffect.ts`) clears it **before** re-entering the effect
  by name, so a continuation may suspend again. `options` is public — see the
  hidden-information rule in [card-effects.md](card-effects.md).
- `counts` — public hand/deck counts; actual hands/decks live in per-player
  `game_players` rows (`EngineGame.privates` in the engine). Hidden information:
  see the log rule in CLAUDE.md.
- `destroyed` — the per-side discard, and the deck's reservoir: `drawCard`
  reshuffles a side's pile back into that side's deck the moment a draw would
  otherwise fail. Every card leaving play goes through `discardCard(game,
  controller, card)`, which files it under its **owner** rather than whoever
  was holding it — a card captured out of the enemy deck goes home. See
  "Captured cards" in docs/claude/card-effects.md.
- `factions: {a, b}` — stamped from deck factions at game start; drives hero
  powers. Legacy rows normalize to `'NEUTRAL'`.
- `alertCard` — single shared slot `{side, instanceId, name, setOnTurn} | null`.
  Own new alert replaces yours; setting while the opponent holds it → 409; expires
  at the owner's END_TURN; cleared when the card is played.
- `scheduled[]` — deferred work, and a **real union** since wave 5.
  `changeOrderDraw` is delivered to the **incoming** side after materials +
  draw; `sabotageWatch` resolves for the **ending** side at the close of the
  turn that scheduled it. Each of the two loops switches on `type` and carries
  forward what it does not own — a loop that consumed every due item of its
  side would silently eat the other's.
- `zoneEffects[]` — board-visible per-zone markers, and DP5's home for a
  zone-scoped rider (spec §4.3, "DP5 as wave 5 built it"). Two optional fields
  beyond `{ effect, zoneId, side, cardName, setOnTurn }`, neither needing a
  `normalizeState` default because *absent* already means what every older row
  means: `expiresOnTurn?: number` (absent = permanent; swept at its owner's
  `END_TURN`) and `data?: Record<string, unknown>`, the effect-owned bag that
  `PendingEffect.data` and `BattleContinuation.data` already are. The engine
  itself reads only two keys out of `data` — `drawOnExpiry` in `endTurn`, and
  `blocksFaction` in `legalZonesFor` (Sub Killer's GT block, deliberately a
  rule rather than an effect-name check, so the next blocking card needs no
  engine edit). `zoneEffectBadges.ts` renders the marker; its key includes the
  array index, because one side may plant several Recurring Threats on one
  zone.
- **`endTurn` runs a pass for the ENDING side** before the turn number moves,
  ahead of everything else. It resolves `sabotageWatch` items and expires
  rest-of-turn `zoneEffects`. It exists because the older `scheduled` loop runs
  *after* the flip and serves the incoming side — a full round too late for
  every wave-5 tail, all of which read "…the turn" meaning the actor's own.
  Running pre-increment is also what makes a Temporary hull count as having
  survived: the cull happens at the next turn's start.
- `activeBattle` — `ActiveBattle | null`: `zoneId`, `aggressor`,
  `attackerIds`/`defenderIds`, `distanceM`, `distanceModifiedBy`, plus two
  fields wave 3 added. `summons: ZoneCardEntry[]` are combatants that exist
  only for this battle: never pushed to `zone.cards`, and evaporate on report
  approval regardless of HP — no repair eligibility, no death record, nothing
  sent to `state.destroyed` (spec §4.4). `continuation: BattleContinuation |
  null` names an effect to re-enter once the battle resolves — Trebuchet's
  "you may repeat this effect" is the one card that populates it; see the
  choice-freeze note below for why this could not live on `pendingEffect`
  instead. `participantsOf` (`shared/engine/battleResolve.ts`) merges on-field
  entries with `summons`, so reporting, the spawn sheet and approval read both
  uniformly; `BattleOverlay.tsx` keeps its own mirror of the same merge.
- `awaitingResponse` — the defender's window before a fleet attack locks:
  `{zoneId, aggressor, attackerIds, targetIds, stealthyIds, omissibleIds}`.
  **Two** opt-out lists, not one. `stealthyIds` is unconditional (the Stealthy
  keyword). `omissibleIds` (wave 4) holds defenders carrying
  `meta.defensiveOmission` whose condition is met *for this attack* — a carrier
  may sit out unless the attacker's **committed selection** holds a ship or
  tank, so it cannot be derived from the card alone and is computed in
  `ATTACK_ENEMY_FLEET`. The window opens when **either** list is non-empty;
  before wave 4 only Stealthy could raise it. `RESPOND_TO_ATTACK` accepts an
  opt-out from either. Spec §4.8; `normalizeState` defaults `omissibleIds`.
  ⚠ No seeded card has carried `defensiveOmission` since the 2026-09-02 balance
  pass (Buzzsaw and Veles both traded it for STEALTHY); the list is still built
  and the rule still enforced, for the frozen in-flight snapshots that print it.
- Battle freeze: `awaitingResponse` / `activeBattle` / `pendingReport` non-null
  freezes the game to `BATTLE_ACTIONS` only. `CONCEDE`, `ABANDON`, and battle
  actions are also in `OFF_TURN_ACTIONS` (the off-turn player may owe a response).
- Choice freeze: `pendingEffect` non-null admits only `PENDING_ACTIONS`
  (`RESOLVE_PENDING_EFFECT`, `CONCEDE`, `ABANDON`), and `applyAction` checks it
  **ahead of** the battle check. It is deliberately *not* folded into
  `battleFrozen`: `BATTLE_ACTIONS` admits `USE_HERO_POWER` and the three battle
  actions, none of which should be legal while a player owes a choice — and one
  of those three, `DECIDE_BATTLE_REPORT`, dispatches `onDeathEffect` right now.
  **Both freezes can be set at once, and wave 4 made that ordinary.** DP2
  fires at battle lock, and two shipped cards suspend there — Terawatt's join
  and DWG Waters' clause-2 summon — so `pendingEffect` is written while the
  `activeBattle` that raised it still stands. An earlier version of this
  section argued the state was unreachable; that argument only ever covered
  `DECIDE_BATTLE_REPORT` (which nulls `activeBattle` before firing any effect),
  and the *lock* half of the battle lifecycle reaches it directly.

  Three properties make it safe, all of which predate wave 4:
  (a) the `pendingEffect` check runs **first** and admits only
  `PENDING_ACTIONS`, so `USE_HERO_POWER` and the battle actions
  `BATTLE_ACTIONS` would otherwise allow stay rejected while a choice is owed;
  (b) `pendingAdmitted` stops the battle check from also rejecting
  `RESOLVE_PENDING_EFFECT` — including `{ cancel: true }`, the escape hatch
  that exists to unstick a stranded game; (c) `RESOLVE_PENDING_EFFECT` is an
  `OFF_TURN_ACTION`, which is what lets the **defender** answer on the
  aggressor's turn. Answered or declined, the battle is then reportable as
  normal. **`shared/engine/battleFreeze.test.ts` pins the whole sequence** —
  every action type × both players — against a synthetic bystander rather than
  through either card, so it keeps testing the invariant if both cards change.
  Spec §4.3 DP2 departure 3, decision 19.

  **A battle wait is not a `pendingEffect`, and cannot be one.** The original
  design (spec §4.2) predicted a `kind: 'battle'` value on this same slot;
  wave 3 found it cannot work and did not build it. `pendingEffect !== null`
  freezes the game to `PENDING_ACTIONS`, which admits neither
  `SUBMIT_BATTLE_REPORT` nor `DECIDE_BATTLE_REPORT` — a battle declared while
  that slot were occupied could never be reported, deadlocking the game.
  Relaxing the freeze to admit them would break the invariant that a non-null
  `pendingEffect` always means "frozen on a choice", which existing readers
  rely on. `pendingEffect.kind` therefore stays `'choice'` only; a wait on a
  battle's resolution lives on `ActiveBattle.continuation` instead (see above),
  which cannot outlive its battle because `DECIDE_BATTLE_REPORT` already nulls
  `activeBattle` — and a continuation that itself wants a decision (Trebuchet's
  repeat) writes an ordinary choice into the now-free `pendingEffect` slot,
  exactly as a suspending death effect would.

## The snapshot-destructure trap

`discardCard(game, controller, card)` in `shared/engine/gameEngine.ts` is **the
single exit** every card takes on its way out of play — the Temporary cull, the
death path in `DECIDE_BATTLE_REPORT`, `spendCard`, and Change Order all route
through it. It turns a `ZoneCardEntry` back into a bare snapshot by
destructuring the per-entry stamps **out by name**:

```ts
const {
  instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot
} = card as ZoneCardEntry
```

**Add a field to `ZoneCardEntry` and TypeScript will not tell you to name it
here.** A rest spread happily swallows the new key, so the stamp leaks into
`state.destroyed` — and `reshuffleDiscard` feeds `destroyed` back into the
owner's deck, so it returns as a hand card carrying a board-only field. Nothing
fails; it is visible only by inspecting the discard. **A new `ZoneCardEntry`
field must be added to this destructure in the same change**, and a regression
test driving a card through a real exit is the only net.

Wave 4 extracted that derivation into `discardSnapshotOf(card, controller)`,
which `discardCard` writes with and `reviveEntry` rebuilds to find *which* pile
entry belongs to a hull it is bringing back. **Two snapshots of one card are
not interchangeable**: `repairmenReadyEffect` grants SCRAPPY to a hull already
on the board, so a plain and a Scrappy Cyclone share a `cardId` and differ in
exactly the field that decides whether the owner gets a free upgrade back
through `reshuffleDiscard`. Matching on `cardId` alone revived the wrong one.
A second, drifting copy of the derivation would reopen that.

This used to be two separate destructures (the cull and the death path) that
had to be kept in step; `discardCard` collapsed them, so there is now one place
to get right instead of two. `loggerheadOnDeath` in `shared/effects/dwgEffects.ts`
still has the same shape and is one stamp behind — inert, because it pushes to
the deck rather than to `destroyed`.

**`isSummonOnly(card)`** guards `discardCard` itself, which is why one check
covers every exit: `meta.summonOnly` cards are spawned, never drafted, so they
must never reach `state.destroyed` — otherwise `reshuffleDiscard` would turn a
destroyed Martyr into a draftable card. `deckValidation` rejects them from
decks and `drawFromPool`'s catalog branch excludes them from pools — but that
is not the whole story: any effect that mints straight from `ctx.catalog`
**instead of** going through `drawFromPool` does not get the guard for free.
`reservesEffect` (`shared/effects/dwgEffects.ts`) filtered `ctx.catalog`
directly and missed it — Reserves could mint Flying Squirrel, a summon-only
DWG vehicle, straight into a hand.

That was six hand-repeated copies of the same condition (`dwgEffects.ts` ×2,
`lhEffects.ts` ×1, `ssEffects.ts` ×2, `wfEffects.ts` ×1) before the
2026-09-02 balance pass extracted **`poolEligible(card)`**
(`shared/effects/primitives.ts`) and pointed all six at it — six
hand-maintained copies is exactly how a card being retired (spec §2.1) but
still mintable by name would have happened, so `poolEligible` excludes both
`summonOnly` and `retired`, and is what `drawFromPool`'s own catalog branch
calls too. Any new effect that filters `ctx.catalog` directly calls
`poolEligible` inside that filter — the same shape as `balmungOnPlay`,
`victoriaActivate`, `harbringerPool` and the rewritten `reservesEffect` — so
the enforcement site to check by hand is now just "does this call
`poolEligible`", not "did someone re-derive the condition correctly". The one
recorded exception is `dryadBattle` (`shared/effects/ssEffects.ts`), which
mints into a battle already in flight rather than a draft or draw pool —
retirement gates drafting and draw pools, not a board effect resolving a game
already dealt — and says so in its own comment; that is a decision to
document at the call site, not a reason to skip `poolEligible` elsewhere.

## Turn & battle flow

- `END_TURN` (`endTurn`), in order: **the ending side's turn-end pass**
  (`sabotageWatch` items, then expiring `zoneEffects` riders — see above),
  half-turn numbering (`turnNumber + 0.5`), cull `temporary` keyword vehicles
  from BOTH sides, set incoming side's materials to
  `floor(turnNumber) * materialsPerTurnOf(game.settings)`, draw 1, process due
  `scheduled` items for the incoming side, expire the ending side's alert card.
- Battles: declare (`battleDeclare.ts`) → optional stealthy response
  (`RESPOND_TO_ATTACK`) → both play in FTD → either player `SUBMIT_BATTLE_REPORT`
  → opponent `DECIDE_BATTLE_REPORT` (approve applies deaths/damage and fires
  implemented `onDeathEffect`s; a death effect that returns `false` logs a note
  without rejecting the report — but a throw is NOT caught, so death effects
  must return `false` on failure, never throw).
- Victory: `checkVictory` — lose 2 of 3 zone bases and you lose. `CONCEDE` →
  status `complete`; `ABANDON` → status `abandoned` (My Games renders them
  differently); both set `winnerId` to the opponent.

## Hero powers (`heroPowers.ts`)

`FACTION_POWERS` maps power → required faction (`boardingParty`→DWG swap one of
your on-field DWG ships with a same-zone enemy ship of equal or lesser effective
cost (re-stamps `playedOnTurn` on both), `changeOrder`→OW discard → scheduled
redelivery of a random custom ship/tank, `flyby`→LH hand card gains `halfCost` +
`temporary` idempotently). Gate with `Object.hasOwn` — an unknown power string
400s ("Unknown hero power"), a known power used by the wrong faction 403s;
neither may crash. SS/WF/GT powers are future work (spec §10).

## Known gaps (rulings on file — don't "fix" silently)

- Salvaged vehicles keep `meta.additionalSpawns` (ruled acceptable).
- `placement.ts` logs "<card> resolved" / "<card> deployed" **unconditionally**,
  including when the effect suspended on a choice and the game is now frozen.
  Uniform across every suspending on-play effect; cosmetic, unfixed.
- Unimplemented effect names are tracked in `KNOWN_GAPS` in
  `supabase/seed/effectCoverage.test.ts`; partly-built cards in `PARTIAL` — see
  [card-effects.md](card-effects.md) for which map a card belongs in.
  **Both are EMPTY as of wave 6**: all 65 cards in the effect-coverage spec and
  all twelve from the 2026-08-30 balance pass are built. They stay asserted
  over, and the `toHaveLength(0)` is what stops a newly-seeded card with an
  unimplemented name being added quietly. ⚠ This line read "as of wave 5" while
  `KNOWN_GAPS` held twelve entries — a doc that a passing suite cannot
  contradict, because nothing asserts prose.
- `state.destroyed` is a **live reservoir, not a log** — `drawCard` on an empty
  deck reshuffles the whole pile back into it, so anything reading the discard
  after a death trigger has run must re-check (`canRevive`).
