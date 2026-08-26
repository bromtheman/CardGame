# Card effects — registry, meta keys, and how to add one

Read this before adding or changing a card effect, cost modifier, or the UI that
triggers them. Prereq: skim [architecture.md](architecture.md) for engine basics.

## The registry (`shared/effects/registry.ts`)

- `registerEffect(name, fn)` / `registerCostModifier(name, fn)` at module import
  time; looked up with `effectFor(name)` / `costModifierFor(name)` /
  `isImplemented(name)`.
- `effectName(card, triggerKey)` reads `card.meta[triggerKey]`, **trims** it,
  and returns `null` for missing/blank values — always resolve names through
  it; seeded data contains stray whitespace.
- `noteUnimplemented(game, card)` scans every meta key on the card and logs a
  play-time note for effect names with no implementation. Unimplemented cards play
  vanilla — never reject a card for having an unknown effect name.
- `CATALOG_EFFECTS` — the set of effect names that need `ctx.catalog` (currently
  `reservesEffect`, `spawnBuccaneerEffect`). If your new effect mints cards from
  the DB catalog, add its name here AND make sure `game-action`'s catalog probe
  covers the cards it needs.
- Implemented DWG effects live in `shared/effects/dwgEffects.ts`; its import in
  `shared/engine/index.ts` is what registers them.

## Effect meta keys on cards

Card rows carry `meta` (jsonb). The full meta-key vocabulary is `TRIGGERS` in
`shared/gameSettings.ts` plus `costModifier`. Dispatched today: `onPlayEffect`,
`onDeathEffect`, `costModifier`, and the `playOn*Effect` targeting variants
(`playOnZoneEffect` via PLAY_CARD_TO_ZONE; field/hand targets flow in as
`PLAY_CARD_TARGETING_CARD_ON_FIELD` / `..._IN_HAND` actions with
`targetInstanceId`). The battle triggers (`onBattleEffect` / `onBattleVictory` /
`onBattleDefeat`) and `onActivate` exist in seed data but have no dispatch point
yet. `additionalSpawns: n` on a
vehicle deploys n extra copies (capped at `ADDITIONAL_SPAWNS_CAP` = 10, ids from
`ctx.newId()`); effects that grant it (Double Up) stack on **printed** values.

⚠ `frontend/src/pages/game/HandBar.tsx`'s `ALL_TRIGGER_KEYS` duplicates the
registry's private `ALL_META_KEYS` — both are
`[...Object.values(TRIGGERS), 'costModifier']`, so a key added to `TRIGGERS`
reaches both automatically, but a meta key added OUTSIDE `TRIGGERS` must be
added to both expressions. Better: export the list from the registry and delete
the duplicate (open backlog item).

## Adding a new effect — checklist

1. Rules first: confirm the card's intended behavior against the spec / seeded
   `card_text`. (Known mismatch: Marauder's seeded text describes a different
   effect than the ported one — a recorded ruling, not a template.)
2. Implement in `shared/effects/` (new faction file → add its side-effect import
   to `shared/engine/index.ts` and to `supabase/functions/shared-manifest.json`
   under `game-action`).
3. Constants go in `shared/gameSettings.ts` (pattern: `DOUBLE_UP_MAX_COST`,
   `RESERVES_CARD_COUNT`, `CHANGE_ORDER_DELAY_TURNS`).
4. Determinism: all randomness via `ctx.rng()`, all ids via `ctx.newId()` —
   `Math.random()`/`crypto.randomUUID()` directly in an effect breaks tests.
5. If your effect adds or removes cards in a private hand or deck, resync
   `game.state.counts[side]` afterwards (`drawCard` does it for you; direct
   pushes must do it manually — see `reservesEffect` / `loggerheadOnDeath` in
   `dwgEffects.ts`). Public counts must always mirror `game.privates`.
6. Log lines: public, so no hidden-hand card names (e.g. Change Order logs
   "delivers a replacement", not the card's name).
7. Tests next to the module (`*.test.ts`, fixtures from
   `shared/engine/testFixtures.ts`). Run `npx vitest run`.
8. `npm run functions:sync` in the same commit; deploy `game-action` per
   [supabase.md](supabase.md).
9. If the effect needs UI (targeting mode, alert badge, …), see
   [frontend.md](frontend.md); HandBar drives targeting modes off meta keys via
   `effectName`.

## Play-time cost modifiers

`costModifier` effects (e.g. Plunderer −20k per own DWG vehicle) apply only in
`effectiveCostInGame(state, side, card)`: (base + modifier) → halve if `halfCost`
→ clamp ≥ 0. `effectiveMaterialCostOf(card)` (base with Half-Cost floor) stays
the authority for damage, repairs, and in-battle resources — never mix them.
