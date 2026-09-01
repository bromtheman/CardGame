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
- `registerEffect` takes two opt-in flags, and BOTH derive a set from the
  registrations so neither can drift from the implementations.
  `{ battleBystander: true }` puts an effect in DP2's forced-battle bystander
  pass — the one that reaches a card about a battle it is **not** fighting in
  (Terawatt alone). It is load-bearing rather than bookkeeping: because the
  pass dispatches only to members, no other battle trigger needs an
  `isParticipant` guard it could silently forget.
- `CATALOG_EFFECTS` — derived from `registerEffect(name, fn, { needsCatalog: true })`,
  so it can never drift from the implementations. If your effect reads
  `ctx.catalog` — directly, via `catalogCard`, or through a `drawFromPool`
  catalog pool — **pass the flag**. `game-action` only fetches the catalog for
  names in this set; without it the effect runs against an empty catalog and
  400s on every real play. ⚠ **Unit tests cannot catch a missing flag**, because
  they hand-build `ctx.catalog` via `makeCtx`. This is a production-only failure:
  green suite, dead card. The probe's four sources are in [supabase.md](supabase.md).
- ⚠ **A `state.zoneEffects` rider needs the flag even when it reads no
  catalog.** `fireRider` (`battleTriggers.ts`) mints the rider's payload card
  from `ctx.catalog` by `cardName`, because the card that planted the marker
  was spent turns ago. Without the flag the probe never loads a catalog, the
  lookup misses, and the rider is skipped — in production only. Four effects
  carry it for this reason (`dwgWatersEffect`, `ambushEffect`,
  `ongoingAttritionEffect`, `recurringThreatEffect`); Sub Killer's rider is
  pure data that never needs to *run*, so being skipped costs it nothing.
  `factionEffects.test.ts` asserts all five at runtime, which is the only way
  to check a flag rather than a comment.
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
Excalibur is the only one today), and the battle triggers `onBattleEffect` /
`onBattleVictory` / `onBattleDefeat` (via DP2 — `shared/engine/battleTriggers.ts`,
built in wave 4; see [architecture.md](architecture.md) for the three lock
sources and the resolve ordering). A battle trigger is told apart from an
ordinary play by `payload.battle` being set, and nothing else. `additionalSpawns: n` on a
vehicle deploys n extra copies (capped at `ADDITIONAL_SPAWNS_CAP` = 10, ids from
`ctx.newId()`); effects that grant it (Double Up) stack on **printed** values.

Some meta keys are **plain data, not effect names**: `additionalSpawns`,
`resourceSurge`, `defensiveOmission`, `activateCpCost`, `costDelta`,
`summonOnly`. None carries a registry name, so all six sit outside `TRIGGERS` /
`ALL_META_KEYS` and **G1 and G3 never look at them**.

⚠ **G2 does.** The first three are `DATA_EFFECT_KEYS`, the subset that
*satisfies a card's text on its own* — which is the whole reason Buzzsaw and
Veles can close with no effect name at all (spec §4.8). But G2 and
`noteUnimplemented` both test for the key's **presence**, never its value, so a
mistyped value (`'unlessShipOrTanks'`) yields a card that is inert AND
invisible: the guard stays green and no "plays as vanilla" note is logged
either. **A data key whose VALUE the engine compares needs its own seed-backed
assertion** — `battleDeclare.test.ts`'s "the two real seeded cards carry
exactly the value the engine compares" is the worked example.

**A second, separate vocabulary of plain data lives in `ZoneEffect.data`** —
written by an effect at play time rather than seeded on a card, so no guard
inspects it and the warning above does not apply. Two of its keys are read by
the **engine**: `drawOnExpiry` (`endTurn`) and `blocksFaction`
(`legalZonesFor`). Both are deliberately rules rather than effect-name checks,
so the next card wanting the same rule needs no engine edit — the same
reasoning that made `defensiveOmission` a data key. Everything else in `data`
is private to the effect that wrote it (Recurring Threat's remembered hull).

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

## Workflow — TDD, unique keys, honest reporting

Three rules govern every card-effect change, on top of the checklist below.

**1. Card effects are TDD, no exceptions.** Write the failing engine test
first, then implement until it passes, then run the full suite
(`npx vitest run`) and **report the before→after passing count**. A wave that
reports "tests pass" without both numbers has not been verified — the count is
what catches a suite that silently stopped collecting tests.

**2. Key effects by a unique registry id, never by a card's name.** The name in
`meta` is a string frozen into `games.state` at deal time; the implementation
behind it is code, redeployed for every game at once. So a name that two cards
could carry silently rebinds one of them the moment the other's effect is
registered. This is the Kraken/Paddlegun collision: Kraken snapshots dealt
before its meta was corrected still name `paddlegunEffect`, so registering that
name for Paddlegun made every such in-flight Kraken start firing Paddlegun's
draw-from-the-enemy-deck effect, mid-game, with no reseed involved
(`docs/superpowers/specs/2026-08-27-effect-coverage-design.md` §9.2; pre-deploy
check in [supabase.md](supabase.md)). Give each effect its own id, and never
reuse another card's.

**3. After deploying, list what is still unimplemented — do not report the wave
as complete.** Close out by naming the spec's effects that remain unbuilt
(cross-check `KNOWN_GAPS` and the coverage guard against the spec's delivery
table). "Wave N complete" is a claim about the spec, not about the diff, and
the guard has known blind spots — a registered effect that no card names is
invisible to G1/G2/G3.

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

Five rules, each of which has already cost someone a bug:

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

- **A second offer in one action is DROPPED, not queued.** There is one slot,
  and since wave 4 a single action can dispatch several effects that each want
  it: a battle lock fires a trigger per participant, a resolve fires one per
  participant plus a continuation. `choice()` checks `state.pendingEffect`
  itself and, if it is taken, logs "<card>'s offer was not made" and returns
  true. Two consequences worth knowing. First, **put an unconditional clause
  BEFORE the choice** — Sacrilego's "gain 1cp. Additionally you may sacrifice
  it…" grants the CP first, so it still lands when the offer cannot be made.
  (The rule used to live in the dispatcher, which skipped the whole effect and
  starved exactly that clause.) Second, an effect that writes
  `state.pendingEffect` **by hand** rather than through `choice()` — Orbit
  Flank's second hop does — bypasses the check and can still clobber. Route a
  new suspension through `choice()`.

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
`onBattleEffect`, `onBattleVictory` and `onBattleDefeat` were added in wave 4
for the same reason. Wave 5 needed no new row: DP5's riders are dispatched from
`state.zoneEffects` under the `playOn*` key their card already carried, so they
introduce no trigger key at all — the same reason DWG Waters added nothing.

### `KNOWN_GAPS` vs `PARTIAL` — pick the right one

Two maps, same `FACTION:Name` key shape, both labelled with the wave that
closes the entry:

| Map | For | Guard behaviour |
|---|---|---|
| `KNOWN_GAPS` | a card that resolves **no** implemented effect — wholly unbuilt | exempts the card from G1/G2/G3; the stale-entry assertion **fails the build** the moment the card starts working, so you must delete the entry (and decrement the `toHaveLength` literal) in the same commit that registers the name |
| `PARTIAL` | a card that resolves **at least one** implemented effect but whose text is only partly built | documentation only; asserted to name real cards, to pass G1/G2, and to never intersect `KNOWN_GAPS` |

A partly-built card **cannot** go in `KNOWN_GAPS` — it passes G1/G2, so the
stale-entry assertion rejects it. That is what `PARTIAL` exists for. It opened
in wave 2 with Plunderer and DWG Waters, and wave 4 closed both, so it is
currently empty and waiting for the next partly-built card.

**Both maps are empty as of wave 5**, and both stay asserted over — the
`toHaveLength(0)` on `KNOWN_GAPS` is what stops a newly-seeded card with an
unimplemented effect name being added quietly. Adding a card to either map is
now a deliberate act with a visible diff, which is exactly what it should be.

Six blind spots were open going into wave 6; **five remain** — number 5 is now
closed by G4, below. None of the rest closes on its own:

1. A card that has left `KNOWN_GAPS` is no longer checked at all (Garrison's
   trigger key can be reverted today with the suite green).
2. The same-type mix-up above — G3 cannot catch it.
3. **Nothing asserts `supabase/seed/seed_data.sql` matches
   `supabase/seed/source/*.js`.** G1/G2/G3 and the stale-entry assertion all
   read `source/*.js` via `loadSeedData()`, so a generated SQL file that has
   drifted from its source passes every check while the deploy applies the
   stale one. Found in wave 3, after Tasks 5-10 edited only `source/*.js` and
   nothing regenerated the SQL until the wave's own docs task caught it.
   `npm run seed:build`, then grep the output for your names, before every
   commit that touches a card's `meta` — see [supabase.md](supabase.md).
4. **A data key's VALUE is never checked** — only its presence (see the
   `DATA_EFFECT_KEYS` warning above). Pin it with a seed-backed assertion.
5. **A registered effect that no card names is invisible to G1/G2/G3.** All
   three guards iterate seeded cards and ask whether each one's *named*
   effects are implemented; a `registerEffect` call with no card anywhere
   pointing at it is simply never visited. This is how `excaliburOnPlay` sat
   registered-but-unreachable for a full wave in wave 3, caught only because
   a test happened to call `effectFor` on it directly — which proves the
   function exists, not that any card can reach it. If you register an effect
   ahead of seeding the card that uses it, grep the seed source for the name
   before calling the task done.

   ⚠ **It reopens from the other end too, and did.** Wave 5's close-out
   reported this blind spot "swept clean — every one of the 69 registry names
   outside test files is named by a seeded card". That was true when written
   and false a day later: the 2026-08-30 balance pass rewrote Purifier's and
   Victoria's card text, cleared their meta and retired Rhea, orphaning
   `purifierEffect`, `victoriaOnDeath` and `rheaOnPlay` without touching a
   line of effect code. **Deleting a card's meta key orphans its
   implementation silently**, and no guard says so. Wave 6 left all three
   registered on purpose: a game dealt before that pass carries a frozen
   snapshot still naming them, and *reusing* one of those names for a new card
   is the Kraken/Paddlegun collision itself (spec §9.2).

   ✅ **CLOSED in wave 6 by G4** (`effectCoverage.test.ts`), which asks the
   question from the other end: not "is this card's effect implemented?" but
   "does any card name this implementation?". It reads
   `registeredEffectNames()` off the registry, skips `t_`-prefixed test
   stand-ins, and fails on anything else that no seeded card names.
   The three above sit in its `DELIBERATE_ORPHANS` map with the reason each is
   kept — a map that is shrink-only and asserted over, exactly like
   `KNOWN_GAPS`. **Adding an entry is now a visible diff with a written
   justification**, which is the whole point: an orphan is fine, an
   *unexplained* orphan is not.

6. **Nothing compares the generated SQL to the LIVE `cards` table.** G1/G2/G3
   read `loadSeedData()`, and `seedDataSync.test.ts` compares the source to
   `seed_data.sql`; the chain stops there. So the live table can hold rows your
   checkout does not, and from inside the repo that is indistinguishable from
   data nobody owns.

   ⚠ **This one comes with a warning about how to read it.** Wave 5 hit exactly
   that divergence — 133 live built-ins against its own 123 — and reported it as
   "seven cards the repo has never seen", the widest blind spot yet. It was
   none of those things: a **balance pass in an unmerged branch** had seeded
   them deliberately, effects left out of scope on purpose and all twelve
   recorded in `KNOWN_GAPS` below. `git log -S` came up empty only because the
   search ran on one branch. **A difference between your checkout and
   production is a question, not a finding** — `git fetch` and
   `git log --all -S <name>` answer it before you write it up.

Two older ones are closed: a partly-built card passing G1/G2 despite
incomplete text (wave 2's `PARTIAL` map above), and a `seed_data.sql` that had
drifted from `source/*.js` (wave 3's `seedDataSync.test.ts`).

**`PARTIAL` is empty as of wave 5**, and so is every wave's share of
`KNOWN_GAPS` — all 65 of the spec's cards are built. The wave assertion loops
all five waves over both maps, so a reopened entry fails the build.

`KNOWN_GAPS` itself is **not** empty: the 2026-08-30 balance pass added twelve
cards (labelled `balance 2026-08-30`, each with the mechanic it needs named in
a comment above the map), and `expect(Object.keys(KNOWN_GAPS)).toHaveLength(12)`
is what stops a thirteenth being added quietly. Four are one-liners over
primitives that already exist (`SS:Nothung`, `SS:Balmung`, `WF:Basher`,
`WF:Harbringer`); the other eight need engine work first. Whoever closes one
deletes its entry and decrements that literal in the same commit.

Wave 6 is the wave that closes them —
`docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-handoff.md` has the
card-by-card breakdown and the engine work each needs.

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

⚠ **The capture model changed on 2026-08-31.** It used to be a *loan*: the card
was spliced out of the opponent's deck, stamped `meta.ownerSide`, and sent home
to that owner's discard when it left play. It is now a **copy**, described
below. `ownerSide` and `ownerSideOf` no longer exist. The loan model is still
described in the 2026-08-27 effect-coverage design spec (§9.1 and the
`discardSnapshotOf` notes) — that spec is a record of the wave that shipped it,
not current behaviour.

`takeFromEnemyDeck` (Marauder, Paddlegun, Plunderer clause 2) **copies** one
card out of the opponent's deck and stamps the copy `meta.capturedCopy: true`.
The original never moves, so:

- the opponent can still draw it, and their public `counts[side].deck` does not
  change — the log line ("takes a card from the enemy deck") is the only public
  signal that a capture happened;
- the capture repeats freely, and can even take the same card twice;
- a captured copy is a phantom with no deck to go home to. `discardCard` — the
  single exit for every card leaving play (battle death, Temporary despawn,
  ability spend, Change Order) — **destroys it** rather than filing it, exactly
  as it does a `summonOnly` hull, and for the same reason: a discard is a
  deck's back door, and filing a phantom there would mint a card that never
  existed. Route any new exit through `discardCard`; pushing to
  `state.destroyed` directly re-opens the hole.

Consequences that fall out of "it is never in a pile":

- **A captured copy cannot be revived or recalled.** `canRevive` reports false
  for it, so a revive choice never offers it, and Recurring Threat can never
  remember one.
- **A minted copy is NOT a captured copy.** The extra hulls belong to whoever
  conjured them and must survive leaving play, so every effect that clones an
  instance (`additionalSpawns` extras, `clydesdaleEffect`, `loggerheadOnDeath`)
  passes the source meta through `copyMeta`, which strips `capturedCopy`. New
  copy-minting effects must do the same.
- **`costDelta` is still dropped from every card leaving play**, captured or
  not — that strip is Excalibur's, not the capture model's. Marauder's −50k
  belongs to the raid, and a card that keeps it would re-stack the discount on
  every reuse. Printed meta (`additionalSpawns`, …) is card data and stays.
