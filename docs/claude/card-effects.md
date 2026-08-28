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
- `CATALOG_EFFECTS` — derived from `registerEffect(name, fn, { needsCatalog: true })`,
  so it can never drift from the implementations. If your effect reads
  `ctx.catalog` — directly, via `catalogCard`, or through a `drawFromPool`
  catalog pool — **pass the flag**. `game-action` only fetches the catalog for
  names in this set; without it the effect runs against an empty catalog and
  400s on every real play. ⚠ **Unit tests cannot catch a missing flag**, because
  they hand-build `ctx.catalog` via `makeCtx`. This is a production-only failure:
  green suite, dead card. The probe's three sources are in [supabase.md](supabase.md).
- Implemented DWG effects live in `shared/effects/dwgEffects.ts`; its import in
  `shared/engine/index.ts` is what registers them.

## Effect meta keys on cards

Card rows carry `meta` (jsonb). The full meta-key vocabulary is `TRIGGERS` in
`shared/gameSettings.ts` plus `costModifier`. Dispatched today: `onPlayEffect`,
`onDeathEffect`, `costModifier`, `onActivate` (via `ACTIVATE_VEHICLE` —
`shared/engine/activate.ts`, see [architecture.md](architecture.md)), and the
`playOn*Effect` targeting variants (`playOnZoneEffect` via PLAY_CARD_TO_ZONE;
field/hand targets flow in as `PLAY_CARD_TARGETING_CARD_ON_FIELD` /
`..._IN_HAND` actions with `targetInstanceId` — a vehicle may carry
`playOnCardEffect` too, via the hand-target action's optional `zoneId`;
Excalibur is the only one today). The battle triggers (`onBattleEffect` /
`onBattleVictory` / `onBattleDefeat`) are dispatched nowhere **and** named on
no seeded card — wave 4 must add both together, since a key nothing reads and
nothing names is invisible to the coverage guard below (see
[architecture.md](architecture.md)'s "Known gaps"). `additionalSpawns: n` on a
vehicle deploys n extra copies (capped at `ADDITIONAL_SPAWNS_CAP` = 10, ids from
`ctx.newId()`); effects that grant it (Double Up) stack on **printed** values.

Some meta keys are **plain data, not effect names**: `additionalSpawns`,
`activateCpCost`, `costDelta`, `summonOnly`. They carry no registry name, so
they are deliberately outside `TRIGGERS` / `ALL_META_KEYS` and the coverage
guard never looks at them.

⚠ **An activated ability needs two meta keys, and nothing checks that.**
`ACTIVATE_VEHICLE` requires both `onActivate` (a registered name) and
`activateCpCost` (a number); `BoardZone.tsx` gates the board's "use" button on
exactly the same pair. A card with only one of them has no activated ability
and no button, silently — Eclipse ships today with `onActivate: 'eclipseEffect'`
and no `activateCpCost`. Seed both, or neither.

⚠ `frontend/src/pages/game/HandBar.tsx`'s `ALL_TRIGGER_KEYS` duplicates the
registry's private `ALL_META_KEYS` — both are
`[...Object.values(TRIGGERS), 'costModifier']`, so a key added to `TRIGGERS`
reaches both automatically, but a meta key added OUTSIDE `TRIGGERS` must be
added to both expressions. Better: export the list from the registry and delete
the duplicate (open backlog item).

## Adding a new effect — checklist

1. Rules first: confirm the card's intended behavior against the spec / seeded
   `card_text`. **Card text is authoritative** over any ported implementation
   that disagrees (2026-08-27 effect-coverage spec, decision 1). Marauder's
   ported own-deck-draw behavior was corrected to match its text.
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
10. **A built-in card must not carry both `SCRAPPY` and an `onDeathEffect`.** Scrappy
    vehicles auto-repair in the 80–89.999% band with no player prompt, so a beneficial
    death trigger on a Scrappy card would be silently unreachable. (Loggerhead hit this
    and had `SCRAPPY` removed.)

## Primitives (`shared/effects/primitives.ts`)

Most cards are a parameterised factory, not a bespoke function. Registrations
live in per-faction modules (`dwgEffects.ts`, `owEffects.ts`, `ssEffects.ts`,
`lhEffects.ts`, `wfEffects.ts`), each of which needs a side-effect import in
`shared/engine/index.ts` AND an entry in `shared-manifest.json`.

| Factory | Use |
|---|---|
| `grant({draw, cp, materials, from})` | draw cards and/or add CP/materials; `from: 'enemy'` takes from the opponent's deck |
| `drawFromPool({source, filter, count, strip, allowEmpty})` | mint from the catalog or pull from your own deck |
| `whenPlayed(predicate, body)` | condition on the zone the card landed in; use `zoneOccupants(p, 'own' \| 'either')`, which excludes what this play just placed |
| `grantKeywords({keywords, target, filter})` | idempotently add keywords to a card in hand or on the field |
| `costDelta({delta, filter})` | stamp a persistent per-instance discount on a card in hand |
| `sequence(...fns)` | run effects in order, stopping at the first failure |
| `choice({effect, prompt, options, resolve, data})` | suspend for a player decision — writes `state.pendingEffect`, re-entered by name (see below) |
| `spawnVehicles({cardName, count, zones, keywords})` | put catalog-minted hulls straight onto the board; needs `{ needsCatalog: true }` |
| `mintHull(game, ctx, snapshot, keywords?)` | stamp one fresh `ZoneCardEntry` from a catalog snapshot — new `instanceId`, merged keywords, turn stamps reset. The building block under both `spawnInto` and `summonHulls`; does not place the entry anywhere |
| `summonHulls(game, ctx, cardName, count, keywords?)` | mint `count` hulls of a named catalog card, returned as an array for `ActiveBattle.summons` — never touches `zone.cards`, so the summons vanish with the battle (spec §4.4). Needs `{ needsCatalog: true }` |
| `enemyVehicleOptions(game, actor, zoneId, filter?)` | build public `ChoiceOption[]` from the acting side's enemy vehicles: `zoneId: number` scopes to one zone, `zoneId: null` scans every zone (Orbit Flank's mode-b pick, which has no home zone to scope to) |

## Suspending for a choice (`choice`)

`choice` is the only primitive that does not finish inside one action. First
entry writes `state.pendingEffect` and returns `true`; the game freezes to
`PENDING_ACTIONS`; `RESOLVE_PENDING_EFFECT` re-enters **the same registry
name** with `payload.resolution` set, and `resolve` runs. See
[architecture.md](architecture.md) for the freeze and
`docs/superpowers/specs/2026-08-27-effect-coverage-design.md` §4.2 for the
shipped shape.

Four rules, each of which has already cost someone a bug:

- **`effect: NAME` is mandatory, and a factory cannot infer it.** `choice`
  returns a plain closure; it never sees the name `registerEffect` files it
  under, so it has to be told which name to re-enter. Bind the string to a
  const and use it twice — `const KRAKEN = 'krakenOnPlay'`, then
  `registerEffect(KRAKEN, choice({ effect: KRAKEN, … }))`. Passing the wrong
  name compiles, passes every unit test that calls the effect directly, and
  fails only when a real player answers the dialog.
- **Empty options do not suspend.** `options()` returning `[]` calls
  `resolve(payload, null)` immediately, so the effect's tail still runs. Kraken
  is why: "refresh one of your hero powers then gain 1cp" must still grant the
  CP to a player with no used powers. Write `resolve` to handle
  `choiceId === null`.
- **`pendingEffect.options` is public.** It lives in `PublicGameState`, so both
  players see every option. Only ever offer a choice over information the
  opponent already has — used hero powers, named catalog pools, cards on the
  field. **A choice over your own hand or deck would leak it**, and there is no
  private-options mechanism.
- **Stash everything the continuation needs in `data`; never trust
  `resolution.targetInstanceId` / `.zoneId`.** `RESOLVE_PENDING_EFFECT` carries
  a `resolution` object that *does* include `targetInstanceId` and `zoneId`,
  but both are client-supplied and unvalidated — trusting them would let a
  stale or malicious client redirect the effect to a different target/zone
  between the first entry and the resolve. Write the target down yourself in
  `data` on the first entry (`data: (payload) => ({ ... })`, run before the
  suspension), then on resolve read `payload.pending?.data`, not
  `payload.resolution`. `choice()` already checks `choiceId` against
  `pending.options` for you; re-check anything read out of `data` against the
  board too (e.g. `enemyVehicleOptions(...).some(o => o.id === choiceId)`)
  before acting on it, in case the target left the board while the choice sat
  open. Air Strafe (`shared/effects/ssEffects.ts`, `AIR_STRAFE`) is the worked
  example — it stashes `{ targetInstanceId, zoneId }` at first entry and reads
  only that back on resolve. Trebuchet (`shared/effects/owEffects.ts`,
  `TREBUCHET`) needs the same stash for a different reason: its continuation
  fires from `ActiveBattle.continuation` *after* the battle has resolved and
  `activeBattle` is already null, so `{ zoneId, defenderIds }` stashed at
  declare time is the **only** route back to either value — nothing else on
  the payload carries them. You don't always need the stash: Braveheart
  (`shared/effects/ssEffects.ts`, `BRAVEHEART`) re-derives its own zone from
  `payload.card` on both entries via `findVehicle(card.instanceId)`, because
  the activating hull itself — not a target picked off the board — is what
  `pendingEffect` already carries verbatim across the suspension. Stash what
  the board can't hand back to you for free; don't stash what it can.

Worked example (`shared/effects/dwgEffects.ts`), showing the first three at once:

```ts
const KRAKEN = 'krakenOnPlay'
registerEffect(KRAKEN, choice({
  effect: KRAKEN,                                    // the name to re-enter
  prompt: 'Refresh one of your used hero powers',
  options: ({ game, actor }) =>
    game.state.usedHeroPowers[actor].map((p) => ({ id: p, label: HERO_POWER_LABELS[p] ?? p })),
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) {                         // the empty-options path
      game.state.log.push('Kraken finds no used hero power to refresh')
    } else {
      game.state.usedHeroPowers[actor] = game.state.usedHeroPowers[actor].filter((p) => p !== choiceId)
      game.state.log.push(`Kraken refreshes ${HERO_POWER_LABELS[choiceId] ?? choiceId}`)
    }
    game.state.resources[actor].cp += 1               // the tail runs either way
    return true
  },
}))
```

An effect whose *continuation* reads `ctx.catalog` still needs
`{ needsCatalog: true }` on its registration — see the registry section above.

## Spawning is not playing

`spawnVehicles` / `spawnInto` push a hull into `zone.cards` with its printed
keywords plus whatever the summoning card grants. **Nothing else runs.** No
payment, no placement legality (biome and screen rules gate *plays*), and — the
load-bearing part — **no `onPlayEffect`**. Only the `PLAY_CARD_*` handlers play
a card.

Sapphire Screen forces the rule: Sapphire prints "played into an empty zone →
draw a card and refund its cost", so firing on-play effects at spawn time would
turn a 90k ability into three bodies, three cards and a 90k refund. Spec §7.4.

Keywords come from the summoning card, not the spawned row
(`defensiveParapetEffect` stamps Inoffensive/Scrappy/Blocker onto a Parapet that
prints none) and the merge de-duplicates.

## The coverage guard (`supabase/seed/effectCoverage.test.ts`)

Coverage is enforced by `supabase/seed/effectCoverage.test.ts`: **G1** every effect
name in `meta` resolves to a registered implementation, **G2** every card with card
text has an implemented effect, a data key, or an exemption, and **G3** every
trigger key a card carries is one the engine dispatches for its `type`. Its
`KNOWN_GAPS` map is shrink-only — a further assertion rejects stale entries, so
closing a card without deleting its entry fails the build.

G3 catches a *type*-level mis-wiring (a vehicle carrying an ability-only trigger
key). It cannot catch a same-type mix-up — an ability carrying
`playOnVehicleEffect` where its text calls for `playOnCardEffect`, which is what
Garrison had — because both keys are legitimately dispatchable for an ability.
When a card's text names where its target lives ("in hand", "in a zone"), check
the key by hand.

⚠ **G3's `REACHABLE_TRIGGERS` table must gain a row before a card can leave
`KNOWN_GAPS`.** It is keyed by card `type` and lists the trigger keys the engine
actually dispatches for that type. Implementing a new dispatch point without
adding its key there means the first card you close immediately fails G3 — and
the failure reads as "this card is mis-wired", not "the table is out of date".
Wave 2 added `onActivate` to the `vehicle` row for exactly this reason;
`onBattleEffect` and the rest are not there yet.

### `KNOWN_GAPS` vs `PARTIAL` — pick the right one

Two maps, same `FACTION:Name` key shape, both labelled with the wave that
closes the entry:

| Map | For | Guard behaviour |
|---|---|---|
| `KNOWN_GAPS` | a card that resolves **no** implemented effect — wholly unbuilt | exempts the card from G1/G2/G3; the stale-entry assertion **fails the build** the moment the card starts working, so you must delete the entry (and decrement the `toHaveLength` literal) in the same commit that registers the name |
| `PARTIAL` | a card that resolves **at least one** implemented effect but whose text is only partly built | documentation only; asserted to name real cards, to pass G1/G2, and to never intersect `KNOWN_GAPS` |

A partly-built card **cannot** go in `KNOWN_GAPS` — it passes G1/G2, so the
stale-entry assertion rejects it. That is what `PARTIAL` exists for. It opens
with Plunderer (its `costModifier` works; clause 2 needs a battle hook) and DWG
Waters (its zone claim works; clauses 2–3 need battle-declare).

Two guard blind spots remain open and are not going to close on their own: a
card that has left `KNOWN_GAPS` is no longer checked at all (Garrison's trigger
key can be reverted today with the suite green), and the same-type mix-up above.

## Play-time cost modifiers

`costModifier` effects (e.g. Plunderer −20k per own DWG vehicle) apply only in
`effectiveCostInGame(state, side, card)`: (base + modifier) → halve if `halfCost`
→ clamp ≥ 0. `effectiveMaterialCostOf(card)` (base with Half-Cost floor) stays
the authority for damage, repairs, and in-battle resources — never mix them.

`meta.costDelta` is a stored per-instance discount stamped onto a card in hand
(Marauder −50k, Excalibur −200k). It is summed into `effectiveCostInGame`
alongside the registered `costModifier` and, like it, never reaches
`effectiveMaterialCostOf`.

## Captured cards

`takeFromEnemyDeck` (Marauder, Paddlegun, Plunderer clause 2) moves one card out
of the opponent's deck and stamps `meta.ownerSide` with the side it came from.
That stamp is what makes a capture a loan rather than a confiscation:
`discardCard` — the single exit for every card leaving play (battle death,
Temporary despawn, ability spend, Change Order) — files the card under
`ownerSideOf(card, controller)`, so it lands in its owner's discard and
reshuffles back into the deck it was built for. Route any new exit through
`discardCard`; pushing to `state.destroyed` directly re-opens the hole, and a
steal every turn grinds the opponent's deck away for good.

Two rules keep the stamp honest:

- **A card going home drops the captor's stamps** (`ownerSide`, `costDelta`).
  Marauder's −50k belongs to the raid, not to the card; riding home it would
  leave the owner permanently discounted on their own card, and re-stack on the
  next capture. Printed meta (`additionalSpawns`, …) is card data and stays.
- **A minted copy is not the captured card.** Exactly one card left the enemy
  deck, so exactly one goes back; the extra hulls belong to whoever conjured
  them. Every effect that clones an instance (`additionalSpawns` extras,
  `clydesdaleEffect`, `loggerheadOnDeath`) passes the source meta through
  `copyMeta`. New copy-minting effects must do the same.
