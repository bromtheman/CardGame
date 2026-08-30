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
- `scheduled[]` — deferred deliveries (e.g. `changeOrderDraw`), processed in
  `endTurn` after materials + draw for the incoming side.
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
  the battle freeze has already lifted. No death effect has exercised this
  yet — none of waves 1-3 register one, and it stays open for whichever later
  wave first does.

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
is not the whole story. Any effect that mints straight from `ctx.catalog`
**instead of** going through `drawFromPool` does not get the guard for free and
must repeat `c.meta.summonOnly !== true` in its own filter. `reservesEffect`
(`shared/effects/dwgEffects.ts`) filtered `ctx.catalog` directly and missed
it — Reserves could mint Flying Squirrel, a summon-only DWG vehicle, straight
into a hand. Treat every catalog-filtering effect as an enforcement site you
must check by hand, not as covered by the guards above.

## Turn & battle flow

- `END_TURN` (`endTurn`): half-turn numbering (`turnNumber + 0.5`), cull
  `temporary` keyword vehicles from BOTH sides, set incoming side's materials to
  `floor(turnNumber) * materialsPerTurnOf(game.settings)`, draw 1, process due
  `scheduled` items, expire the ending side's alert card.
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

- **DP2, the battle triggers — `onBattleEffect` / `onBattleVictory` /
  `onBattleDefeat` — are still undispatched, and are wave 4's.** Unlike every
  other gap that has ever sat in this list, these three keys appear on **zero**
  seeded cards today — not merely undispatched but unauthored — so wave 4 must
  both add the dispatch point(s) and write the seed `meta` for each of its
  eight cards; there is nothing existing to "wire up." That also means G1/G2/G3
  cannot see them coming: a key nothing dispatches and nothing names is
  invisible to all three guards until the first card is seeded, which is
  exactly why they must land together.
- Salvaged vehicles keep `meta.additionalSpawns` (ruled acceptable).
- `placement.ts` logs "<card> resolved" / "<card> deployed" **unconditionally**,
  including when the effect suspended on a choice and the game is now frozen.
  Uniform across every suspending on-play effect; cosmetic, unfixed.
- Remaining unimplemented effect names are tracked in `KNOWN_GAPS` in
  `supabase/seed/effectCoverage.test.ts`, with the wave that closes each one.
  Cards still listed there play vanilla and log a note at play time. Cards that
  are *partly* built are tracked separately in `PARTIAL` — see
  [card-effects.md](card-effects.md) for which map a card belongs in.
