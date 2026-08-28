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
- `factions: {a, b}` — stamped from deck factions at game start; drives hero
  powers. Legacy rows normalize to `'NEUTRAL'`.
- `alertCard` — single shared slot `{side, instanceId, name, setOnTurn} | null`.
  Own new alert replaces yours; setting while the opponent holds it → 409; expires
  at the owner's END_TURN; cleared when the card is played.
- `scheduled[]` — deferred deliveries (e.g. `changeOrderDraw`), processed in
  `endTurn` after materials + draw for the incoming side.
- Battle freeze: `awaitingResponse` / `activeBattle` / `pendingReport` non-null
  freezes the game to `BATTLE_ACTIONS` only. `CONCEDE`, `ABANDON`, and battle
  actions are also in `OFF_TURN_ACTIONS` (the off-turn player may owe a response).
- Choice freeze: `pendingEffect` non-null admits only `PENDING_ACTIONS`
  (`RESOLVE_PENDING_EFFECT`, `CONCEDE`, `ABANDON`), and `applyAction` checks it
  **ahead of** the battle check. It is deliberately *not* folded into
  `battleFrozen`: `BATTLE_ACTIONS` admits `USE_HERO_POWER` and the three battle
  actions, none of which should be legal while a player owes a choice — and one
  of those three, `DECIDE_BATTLE_REPORT`, dispatches `onDeathEffect` right now.
  So the two freezes are mutually exclusive today **not because either action
  set is blind to effect code**, but for two narrower reasons: (a) no hero
  power dispatches a registry effect, and (b) `DECIDE_BATTLE_REPORT` clears
  `activeBattle`/`pendingReport` **before** firing death triggers
  (`battleResolve.ts`), so any death effect that suspends does so only after
  the battle freeze has already lifted. A death effect that suspends via
  `choice` (wave 3 is assigned one) is the first thing that will exercise this.

## The snapshot-destructure trap

Two places turn a `ZoneCardEntry` back into a bare card snapshot by
destructuring the per-entry stamps **out by name**:

```ts
const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot } = entry
```

- `endTurn`'s Temporary cull — `shared/engine/gameEngine.ts` (~line 155)
- the death path in `DECIDE_BATTLE_REPORT` — `shared/engine/battleResolve.ts` (~line 155)

**Add a field to `ZoneCardEntry` and TypeScript will not tell you about either
one.** The rest spread happily swallows the new key, so the stamp leaks into
`state.destroyed` — and `reshuffleDiscard` feeds `destroyed` back into the
owner's deck, so it comes back as a hand card carrying a board-only field.
Nothing fails; it is only visible by inspecting the discard. **A new
`ZoneCardEntry` field must be added to both destructures in the same change**,
and a regression test at each site is the only real net. (`loggerheadOnDeath` in
`shared/effects/dwgEffects.ts` has the same shape and is already one stamp
behind — inert, because it pushes to the deck rather than to `destroyed`.)

`state.destroyed` is also pushed from `heroPowers.ts` (Change Order) and
`placement.ts` (`spendCard`), but both take hand cards, which never carry the
stamps — those two are not part of the trap.

**`isSummonOnly(card)`** (`gameEngine.ts`) guards both destructure sites:
`meta.summonOnly` cards are spawned, never drafted, so they must never reach
`state.destroyed` — otherwise `reshuffleDiscard` would turn a destroyed Martyr
into a draftable card. `deckValidation` rejects them from decks and
`drawFromPool`'s catalog branch excludes them from pools — but that is not the
whole story. Any effect that mints straight from `ctx.catalog` **instead of**
going through `drawFromPool` does not get the guard for free and must repeat
`c.meta.summonOnly !== true` in its own filter. `reservesEffect`
(`shared/effects/dwgEffects.ts`) filtered `ctx.catalog` directly and missed
it — Reserves could mint Flying Squirrel, a summon-only DWG vehicle, straight
into a hand. Treat every catalog-filtering effect as a fifth enforcement site
you must check by hand, not as covered by the four above.

## Turn & battle flow

- `END_TURN` (`endTurn`): half-turn numbering (`turnNumber + 0.5`), cull
  `temporary` keyword vehicles from BOTH sides, set incoming side's materials to
  `floor(turnNumber) * MATERIALS_PER_TURN`, draw 1, process due `scheduled` items,
  expire the ending side's alert card.
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

- VEHICLE cards carrying `playOnVehicleEffect` (Trebuchet is the only one) have
  **no dispatch point yet**: `PLAY_CARD_TO_ZONE` fires only
  `playOnZoneEffect`/`onPlayEffect`, and `PLAY_CARD_TARGETING_CARD_ON_FIELD`
  (which does dispatch `playOnVehicleEffect`) accepts ability cards only.
  Implementing Trebuchet's effect requires adding that firing point first;
  ability-card `playOnVehicleEffect` names already fire. Wave 3 owns this.
  (`onActivate` was in this list until wave 2 built `ACTIVATE_VEHICLE`; it now
  dispatches. The battle triggers — `onBattleEffect` / `onBattleVictory` /
  `onBattleDefeat` — are still undispatched, and are wave 4's.)
- The same gap in reverse: **a vehicle whose text targets a card in hand has no
  play path at all.** Excalibur ("pick one AI ship in hand and reduce its cost
  by 200k") is the only one; it was re-filed out of wave 1 into wave 3 rather
  than half-wired, and its seed row still carries an empty `meta`.
- Salvaged vehicles keep `meta.additionalSpawns` (ruled acceptable).
- `placement.ts` logs "<card> resolved" / "<card> deployed" **unconditionally**,
  including when the effect suspended on a choice and the game is now frozen.
  Uniform across every suspending on-play effect; cosmetic, unfixed.
- Remaining unimplemented effect names are tracked in `KNOWN_GAPS` in
  `supabase/seed/effectCoverage.test.ts`, with the wave that closes each one.
  Cards still listed there play vanilla and log a note at play time. Cards that
  are *partly* built are tracked separately in `PARTIAL` — see
  [card-effects.md](card-effects.md) for which map a card belongs in.
