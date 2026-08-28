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
- `EngineContext = { rng: () => number; newId: () => string; catalog: SnapshotCard[] }`.
  Tests inject deterministic rng/ids via `testFixtures.ts` (`makeGame`, `makeCtx`).
  `game-action` injects `secureRng`, `crypto.randomUUID`, and a catalog probe
  (cards referenced by the caller's hand metas) so effects can mint real cards.
- Every success path funnels through `finish()`, which trims `state.log` to
  `LOG_MAX_ENTRIES` (200). Do not push to the log after returning.
- `normalizeState(state)` repairs rows created by older deployed code (missing
  `awaitingResponse`, `factions`, `alertCard`, `scheduled`, per-entry
  `playedOnTurn`/`movedOnTurn`, …). If you add a state field, add its default here
  AND stamp it in `lobby-action`'s game init.
- All tunables (costs, caps, keywords, `MATERIALS_PER_TURN`, `LOG_MAX_ENTRIES`,
  `ADDITIONAL_SPAWNS_CAP`, …) live in `shared/gameSettings.ts`. Never inline a
  magic number that belongs there.

## State highlights (`PublicGameState`)

- `zones[]` — three zones, each with `biome`, per-side `baseHp`, and per-side
  `cards` arrays of `ZoneCardEntry` (a card snapshot + `instanceId`,
  `playedOnTurn`, `movedOnTurn`).
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
- `scheduled[]` — deferred deliveries (e.g. `changeOrderDraw`), processed in
  `endTurn` after materials + draw for the incoming side.
- Battle freeze: `awaitingResponse` / `activeBattle` / `pendingReport` non-null
  freezes the game to `BATTLE_ACTIONS` only. `CONCEDE`, `ABANDON`, and battle
  actions are also in `OFF_TURN_ACTIONS` (the off-turn player may owe a response).

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
  ability-card `playOnVehicleEffect` names already fire.
- Salvaged vehicles keep `meta.additionalSpawns` (ruled acceptable).
- Remaining unimplemented effect names are tracked in `KNOWN_GAPS` in
  `supabase/seed/effectCoverage.test.ts`, with the wave that closes each one.
  Cards still listed there play vanilla and log a note at play time.
