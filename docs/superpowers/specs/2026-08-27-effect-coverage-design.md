# Card Effect Coverage — Design Spec

**Date:** 2026-08-27
**Status:** Approved pending user review
**Supersedes:** the Marauder ruling in `docs/claude/card-effects.md` §1
**Depends on:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` (binding),
`docs/superpowers/specs/2026-08-26-playtest-polish-design.md` §7 (Reveal)

65 of 120 built-in cards do not do what their card text says. This spec closes
the whole gap: every one of the 65 gets an implementation, a documented
exemption, or authored content.

## 1. The audit

Reproduced against the seed source and the live registry — load
`supabase/seed/source/builtInCards/*.js` through `loadSeedData()`, import
`shared/engine/index.ts` to populate the registries, then resolve every meta key
through `effectName` and test it with `isImplemented`:

| Bucket | Count | Verdict |
|---|---:|---|
| built-in cards | 120 | |
| true vanilla — no card text, no effect meta | 43 | correct |
| card text satisfied by `additionalSpawns` alone | 4 | correct |
| wired **and** implemented | 8 | correct, except Marauder (§6) |
| card text but **no** effect name — silent no-op | 32 | broken |
| names an effect that is never registered | 33 | broken |

The 33rd unregistered card is **LH Spectrum**, whose `card_text` is empty; it
carries `onActivate: 'spectrumEffect'` with nothing to implement against (§7.2).

Three findings not visible from the counts:

- **`onBattleEffect`, `onBattleVictory` and `onBattleDefeat` appear on zero
  seeded cards.** They exist only in the `TRIGGERS` vocabulary. Every
  battle-triggered card (Terawatt, Iron Cordon, Catshark, Sacrilego, Dryad, The
  Onyx Throne) sits in the *silent* 32 with `meta: {}`. We are therefore
  defining these triggers, not matching existing data. Only `onActivate` is
  used, by Eclipse and Spectrum.
- **Three referenced vehicles were never seeded**: Flying Squirrel, Martyr and
  Parapet (§7.1). Air Strafe and Orbit Flank are fine — PredatorX and Orbit both
  exist.
- **PredatorX is not a one-off.** LH Orbit carries the identical mechanic at a
  different threshold, so conditional Half-Cost suppression is a primitive, not a
  special case.

## 2. Decisions log

Inherited and binding:

| # | Decision |
|---|---|
| 1 | **Card text is authoritative** over any ported implementation that disagrees |
| 2 | A built-in card must not carry both `SCRAPPY` and an `onDeathEffect` |
| 3 | `SET_ALERT_CARD` becomes automatic — the engine sets it; no hand button is restored |
| 4 | Fragile is auto-assigned to player-made airships only |

Taken during this design:

| # | Decision |
|---|---|
| 5 | All 65 cards ship in one spec, delivered in five ordered waves (§10) |
| 6 | Forced battles and mid-resolution choices share **one** suspension slot, `state.pendingEffect` (§4.2) |
| 7 | Summon-only vehicles are **seeded cards** flagged `meta.summonOnly`, not a second species of card object (§7.1) |
| 8 | Conditional Half-Cost is a **hand-side, price-time** property; hulls on the board keep their printed keywords (§4.6) |
| 9 | Effects are **parameterised TypeScript factories**, not a data DSL in `meta` (§5) |
| 10 | Battle summons are **combatants inside `activeBattle`**, never board units (§4.4) |

## 3. Scope

**In:** all 65 broken cards, the six missing dispatch points, the silent-no-op
diagnostic, a permanent coverage guard, the seed-data corrections those require,
and the three summon cards plus two content stubs.

**Out:** UI polish, battle-report flow and deck mechanics (shipped in the
playtest-polish spec); a Fragile pass over the 16 built-in airships that lack it
(deliberate per-card balance work, tracked separately); retrofitting card `meta`
into games already in progress (§9.2); SS/WF/GT faction hero powers (design
spec §10).

## 4. Architecture

### 4.1 The diagnostic, and a permanent guard

`noteUnimplemented` iterates meta keys, so a card with `meta: {}` has nothing to
iterate and its card text is skipped in total silence. Two changes, both
independent of any effect implementation:

**Runtime.** `noteUnimplemented` additionally notes a card whose `cardText` is
non-empty when it resolved no implemented effect name and carries no
`additionalSpawns`:

```
<name>: its card text has no implemented effect yet — plays as vanilla
```

**Build time.** A new `supabase/seed/effectCoverage.test.ts` freezes the §1 audit
against the real seed data:

- **G1** — every effect name in every built-in card's `meta` resolves to a
  registered implementation.
- **G2** — every built-in card with non-empty `card_text` resolves at least one
  *implemented* effect, carries `additionalSpawns`, or appears in an explicit
  exemption map with a written reason.

Both exemption maps live in the test. Only one card is exempt at completion:
**Falcon Squadron**, whose text ("considered destroyed if any of its sub-vehicles
is destroyed in battle") is player-conduct guidance for the spawn sheet, the same
shape as the Robotic keyword's second clause — there is nothing for the engine to
fire. Buzzsaw and Veles read like conduct text but are not: "may be omitted from
defensive battles unless…" is Stealthy-shaped and is implemented (§8, wave 4).

This guard is the item that stops the gap reopening, and it lands first.

### 4.2 `state.pendingEffect` — one suspension slot

Every effect today is `(payload) => boolean` and fully resolves inside one
action. Two families cannot: a choice must wait for the player, and Trebuchet's
"you may repeat this effect" must wait for a battle report. One slot serves both.

```ts
interface PendingEffect {
  effect: string            // registry name that suspended
  side: Side                // who owes the decision
  cardName: string
  instanceId: string        // the suspending card
  kind: 'choice' | 'battle'
  options?: { id: string; label: string }[]
  data?: Record<string, unknown>   // effect-owned continuation state
}
```

- Added to `PublicGameState`; defaulted in **both** `normalizeState` and
  `buildInitialGame`.
- `battleFrozen(state)` extends to include `pendingEffect !== null`, so a game
  awaiting a choice accepts only the resolving action plus `CONCEDE` / `ABANDON`.
- New action `RESOLVE_PENDING_EFFECT { choiceId?, targetInstanceId?, zoneId? }`,
  added to `BATTLE_ACTIONS` (legal while frozen) but **not** `OFF_TURN_ACTIONS` —
  a choice is always owed by the player who played the card.
- The suspending effect returns `true` after writing `pendingEffect`; the
  continuation is dispatched by name on resolve.

**Alert card (decision 3).** Most forced battles need no suspension — the effect
declares the battle and the existing report flow finishes it. What the opponent
lacks is the *cause*: `activeBattle` does not say why they are suddenly in a
1-vs-4. So the engine sets `state.alertCard` to the causing card whenever an
effect declares a battle or plants a rider on the opponent's next battle, and
clears it when that resolves. No hand button is restored.

### 4.3 Six dispatch points

| # | Point | Shape |
|---|---|---|
| DP1 | `onActivate` | New `ACTIVATE_VEHICLE { instanceId, targetInstanceId?, zoneId? }` action. New `activatedOnTurn: number \| null` stamp on `ZoneCardEntry` (defaulted in `normalizeState`) enforces once-per-turn. The CP price is card data: `meta.activateCpCost` — a number, the same class as `additionalSpawns`, so no registry change |
| DP2 | Battle triggers | `onBattleEffect` fires at **lock** and at **resolve** with a `BattleContext` payload (`phase`, `zoneId`, `isDefender`, `survived`, `won`). `onBattleVictory` / `onBattleDefeat` are resolve-only sugar dispatched per side outcome. A side **wins** when the enemy has no surviving participant and **loses** when it has none of its own; both false is a draw |
| DP3 | Forced battle | `declareForcedBattle(game, ctx, { zoneId, aggressor, attackerIds, defenderIds, summons, cause })`, exported from `battleDeclare.ts`, reusing `lockBattle`. Skips the Stealthy opt-out — the card *forces* the fight — and sets the alert card |
| DP4 | Choice | `state.pendingEffect` (§4.2) |
| DP5 | Rest-of-turn riders | Extends the existing `state.scheduled[]` discriminated union rather than adding a state field: it already carries `side` and `dueTurn` and is already processed in `endTurn` |
| DP6 | `playOnVehicleEffect` on **vehicle** cards | The gap recorded in `architecture.md`. `PLAY_CARD_TARGETING_CARD_ON_FIELD` gains an optional `zoneId` and accepts a vehicle carrying that key: the vehicle deploys to the zone (with `additionalSpawns`), then the effect fires |

Two rulings fall out:

- **A forced battle is not a zone activation.** It neither consumes nor is
  blocked by `lastActivatedTurn`. Eclipse is the sole exception and says so in
  its own text, so `eclipseEffect` stamps `lastActivatedTurn` itself.
- **Summons bypass placement legality.** A Martyr is not *played*, so biome and
  screen rules do not gate it — otherwise Martyr Attack fails against a target in
  a land zone.

### 4.4 Battle summons

`ActiveBattle` gains `summons: ZoneCardEntry[]`. Summoned combatants live only
inside the battle: they never enter `zone.cards`, and when the report is approved
they evaporate **regardless of HP** — no repair eligibility, no death record,
nothing pushed to `state.destroyed`. `participantsOf` merges the two sources, so
reporting, the spawn sheet and approval are otherwise unchanged.
`normalizeState` defaults `summons` to `[]` on legacy rows.

Card text marks the distinction reliably:

| | Wording | Behaviour |
|---|---|---|
| **Battle summon** | "fights alone against…", "alongside it in battle" | exists only for that battle |
| **Board spawn** | "spawn … into a zone" | enters `zone.cards`, keeps its granted keywords |

Orbit Flank contains both modes, which confirms the split is in the data rather
than invented here.

Battle summons serve seven cards: Flying Squirrel Attack, Martyr Attack, Air
Strafe, Orbit Flank (mode b), The Onyx Throne, Recurring Threat, and **DWG
Waters' unbuilt rider** — the phase-2 clause already documented as blocked on a
battle-declare dispatch point, which this closes.

Anything summoned by a forced-battle ability evaporates even when the underlying
card is draftable: Air Strafe's two PredatorX and Orbit Flank's Orbit are battle
summons like any other.

### 4.5 Persistent per-instance cost delta

New numeric meta key `costDelta`, written onto a target card in hand exactly as
`doubleUpEffect` writes `additionalSpawns`:

```ts
target.meta = { ...target.meta, costDelta: current + delta }
```

Applied **only** in `effectiveCostInGame`:

```
base + costModifier(fn) + costDelta  →  halve if Half-Cost applies  →  clamp ≥ 0
```

It never reaches `effectiveMaterialCostOf`, per spec §3.9 ("cost modifiers apply
at play time only — base damage, repairs and in-battle resources use the
unmodified effective cost"). Deltas stack additively. Because it is a stored
number rather than an effect name, it needs no entry in the registry's
`ALL_META_KEYS` or HandBar's `ALL_TRIGGER_KEYS`.

Serves Marauder (−50k) and Excalibur (−200k).

### 4.6 Conditional Half-Cost suppression

PredatorX ("more than 120k resources") and Orbit ("140k or more resources") lose
Half-Cost under a resource condition and instead spawn an extra hull.

**Ruling (decision 8):** this is a hand-side, price-time property. It decides
what the card is shown and charged and whether the extra hull spawns. The hulls
that land keep their printed keywords — the discount is a purchase-price
mechanic, and the hull that arrives is the same hull either way.

Consequences:

- Only `effectiveCostInGame` and `PLAY_CARD_TO_ZONE` learn about suppression.
  `effectiveMaterialCostOf` is untouched, so repairs, base damage, in-battle
  resources and the Temporary cull all keep reading the keyword array exactly as
  they do today.
- The hand already prices through `effectiveCostInGame`, so the displayed cost
  re-evaluates on its own as resources change each turn. No per-turn hook is
  needed, and none would be reachable: both cards are Temporary and are culled at
  the start of the next turn, so neither can ever survive to one.

Card data shape, evaluated by a shared `resourceSurgeActive(state, side, card)`
helper — plain data, no registry entry:

```js
meta.resourceSurge = { materialsOver: 120000, extraSpawns: 1 }    // PredatorX
meta.resourceSurge = { materialsAtLeast: 140000, extraSpawns: 1 } // Orbit
```

Exactly one of `materialsOver` / `materialsAtLeast` is present, preserving each
card's own comparator. Resources are read **before** payment.

### 4.7 Two infrastructure repairs

**The catalog probe.** `supabase/functions/game-action/index.ts` loads the
built-in catalog only when the played card *in hand* references a
`CATALOG_EFFECTS` name. Every death effect that mints from the catalog (Halberd,
Jormangund, Partisan) fires inside `DECIDE_BATTLE_REPORT`, which carries no
`instanceId` — those effects would receive an empty catalog and fail. The probe
broadens to scan the played hand card **plus** the actor's on-field entries
**plus**, for battle actions, every participant on both sides.

**`CATALOG_EFFECTS` becomes a registration flag.** With roughly fifteen catalog
effects arriving, a hand-maintained `Set` in `registry.ts` will drift from the
implementations it describes:

```ts
registerEffect(name, fn, { needsCatalog: true })
```

The set is derived from registrations and still exported under the same name, so
`game-action`'s import is unchanged.

## 5. Primitives

Parameters live in **TypeScript factories**, not in `meta`. A data DSL in `meta`
is tempting and wrong: `meta` is untyped jsonb, live games snapshot it (§9.2), a
DSL bug would ship into rows we cannot retroactively fix, and it breaks
`effectName`, which every call site assumes returns a string.

Factories live in `shared/effects/primitives.ts` and register nothing.
Registration splits per faction — `owEffects.ts`, `ssEffects.ts`, `lhEffects.ts`,
`wfEffects.ts`, `gtEffects.ts` — each needing a side-effect import in
`shared/engine/index.ts` **and** an entry in
`supabase/functions/shared-manifest.json` under `game-action`.

```ts
registerEffect('mandrelOnPlay',   grant({ draw: 1 }))
registerEffect('bulwarkOnPlay',   grant({ cp: 2 }))
registerEffect('paddlegunEffect', grant({ draw: 1, from: 'enemy' }))
```

| Primitive | Signature | Serves |
|---|---|---|
| `grant` | `{ draw?, cp?, materials?, from?: 'own' \| 'enemy' }` | 17 cards + Catshark's body |
| `drawFromPool` | `{ source: 'catalog' \| 'deck', filter, count, strip? }` | 9 cards |
| `whenPlayed` | `(predicate, body)` | Clydesdale, Sapphire |
| `grantKeywords` | `{ keywords, target: 'hand' \| 'field', condition?, then? }` | Garrison, Repairmen Ready, Sabotage |
| `costDelta` | `{ delta, filter }` | Marauder, Excalibur |
| `resourceSurge` | card data (§4.6) | PredatorX, Orbit |
| `spawnVehicles` | `{ card, count, zones, keywords }` | Parapet, Sapphire Screen, All for the Cause |
| `summonBattle` | `{ summon, count, countIf?, mode }` | 7 cards (§4.4) |
| `zoneRider` | `{ kind, expiresAtEndOfTurn, onExpiryUnused? }` | 4 cards |
| `choice` | `{ options }` → `pendingEffect` | 3 cards + Iron Cordon, Terawatt, Sacrilego |

Only four plain-data meta keys are added, all with `additionalSpawns` as
precedent: `costDelta`, `activateCpCost`, `resourceSurge`, `summonOnly`. None
carries an effect name, so `ALL_META_KEYS` and HandBar's `ALL_TRIGGER_KEYS` are
unchanged.

## 6. Data corrections

Decision 1 makes these corrections, not choices. All are edits to
`supabase/seed/source/builtInCards/*.js`, following the precedent set by commit
`8e124b3` (Loggerhead's Scrappy removal edited the source file directly).

| Card | Today | Card text says | Correction |
|---|---|---|---|
| Marauder | `marauderOnPlay` aliased to `drawPlusCp` — own deck, +1 CP | "draw a vehicle card from the enemy deck reduce its cost by 50k" | reimplement: enemy-deck draw + `costDelta: -50000` |
| Kraken | `paddlegunEffect` | "refresh one of your hero powers then gain 1cp" | rename to `krakenOnPlay`; Paddlegun keeps `paddlegunEffect`, whose text it actually describes |
| Garrison | `playOnVehicleEffect` | "Target an AI vehicle **in hand**" | → `playOnCardEffect` |
| Flying Squirrel Attack | `onPlayEffect` | "Choose an enemy vehicle" | → `playOnVehicleEffect` |
| Air Strafe | `playOnZoneEffect` | "Choose an enemy ship" | → `playOnVehicleEffect` |
| All for the Cause | `playOnVehicleEffect` | "Choose a zone" | → `playOnZoneEffect` |

Cosmetic, in the same pass: `Orbit Flank`'s effect name carries a trailing space
(the registry trims it), and `CauldronEffect` / `MartyrAttackEffect` are
capitalised inconsistently with every other name. Normalised to
`orbitFlankEffect`, `cauldronEffect`, `martyrAttackEffect`.

This supersedes the Marauder ruling recorded as item 1 in
`docs/claude/card-effects.md`; that doc is updated in wave 1.

## 7. New content

### 7.1 Summon-only vehicles

Three cards, seeded with `meta.summonOnly: true`. `deckValidation` rejects them,
so they cannot be drafted, but they render on the board and in the card browser
like any other card. Stats supplied by the product owner:

| | Flying Squirrel | Martyr | Parapet |
|---|---:|---:|---:|
| faction | DWG | WF | OW |
| materialCost / blueprintCost | 84,000 | 8,500 | 259,000 |
| vehicleType | `plane` | `plane` | `plane` |
| printed keywords | none | none | none |
| cpCost | 0 | 0 | 0 |
| imageUrl | `''` | `''` | `''` |

No frontend work is needed for the art. `cardImageOrFallback`
(`frontend/src/lib/cards.ts`) already falls back to `vehicleTypeIcon(vehicle_type)`
for any non-`http` image, and every built-in card already takes that path — their
`image_url`s are bare filenames with no hosted art. An empty `imageUrl` on a plane
renders the plane icon.

**Keywords come from the summoning card, not the printed row.** This is the
established pattern: `spawnBuccaneerEffect` stamps Scrappy at spawn time, and
Defensive Parapet's own text says its Parapets "gain Inoffensive, Scrappy, and
blocker keywords".

**`summonOnly` cards never enter `state.destroyed`.** `reshuffleDiscard` feeds
`destroyed` back into the owner's deck, so without this rule a destroyed Martyr
becomes a draftable card. Enforced at all three exits: the Temporary cull in
`endTurn`, the death path in `DECIDE_BATTLE_REPORT`, and the battle-summon sweep.

### 7.2 Stubs for cards with no authored effect

**Spectrum** (LH plane, 370k, Half-Cost + Temporary — 185k effective) ships with
empty `card_text` and an unregistered `onActivate`. Authored text:

> Once per turn, you may pay 1cp to draw a random card from the [TG] Robotics pool.

Calibration: Ampere draws from the same pool for free on play at 200k and stays
on the board. Spectrum costs 185k plus a CP and despawns at turn end — strictly
weaker than an existing card, so the stub cannot push power level. It reuses
`drawFromPool` and `onActivate`, so it costs nothing to build, and the LH↔TG
Robotics link is already established across four LH cards.

**The Onyx Throne** is missing a noun — "spawn an allied ___ alongside it".
Minimal edit, preserving the rest verbatim:

> Whenever this vehicle would partake in a defensive battle, spawn an allied
> **Parapet** alongside it **for that battle**. Once per turn, you may pay 1cp to
> draw a GT heavy airship card.

A Parapet is the OW fortification token being seeded anyway. "For that battle"
makes it a battle summon (§4.4) rather than a free 259k hull every defensive
battle, repeatable, on a 500k card.

### 7.3 Rulings on ambiguous card text

- **"AI" means `isBuiltIn === true`**; "player design" means `isBuiltIn === false`.
  Spec §3.10 writes "AI/built-in card costs", which settles it. Affects Excalibur,
  Garrison, Repairmen Ready, Air Strafe, Martyr Attack.
- **"GT heavy airship" = faction GT, `vehicleType: airship`, materialCost ≥
  400,000** — eight cards. The pool has a clean cost cliff: six cards at
  70k–200k, then eight at 460k+. New constant `GT_HEAVY_AIRSHIP_MIN_COST`.
  Special Foundries' other option ("GT Airship") is the sub-400k six, so its
  choice partitions the pool and is actually meaningful.
- **Halberd / Jormangund / Partisan** draw from the full 14-card GT airship
  catalog pool ("a random GT Airship", unqualified).
- **Cauldron** draws from your **deck**, not the catalog: OW has no built-in
  submarines at all, so custom cards are the only subs an OW deck can hold —
  which is exactly why its text says "if you have one".
- **Sapphire's "empty zone"** means no vehicles from either side; **Clydesdale's**
  condition is friendly-only, per its own wording. Both predicates are evaluated
  **before** the played card lands, so they must exclude its own instance and any
  `additionalSpawns` copies.

## 8. The 65 cards

### Wave 1 — no new dispatch points (34)

**`grant` (17)**

| Card | Faction | Trigger | Effect name | Parameters |
|---|---|---|---|---|
| Ransack | DWG | `onPlayEffect` | `ransackOnPlay` | `{ draw: 1, cp: 1 }` |
| Mandrel | OW | `onPlayEffect` | `mandrelOnPlay` | `{ draw: 1 }` |
| Rook | OW | `onPlayEffect` | `rookOnPlay` | `{ draw: 1 }` |
| Resolute | SS | `onPlayEffect` | `resoluteOnPlay` | `{ draw: 1 }` |
| Excruciator | WF | `onPlayEffect` | `excruciatorOnPlay` | `{ draw: 1 }` |
| Claymore | OW | `onPlayEffect` | `claymoreEffect` * | `{ draw: 1 }` |
| Palisade | OW | `onPlayEffect` | `palisadeEffect` * | `{ draw: 1 }` |
| Purifier | WF | `onPlayEffect` | `purifierEffect` * | `{ draw: 1 }` |
| Bulwark | OW | `onPlayEffect` | `bulwarkOnPlay` | `{ cp: 2 }` |
| Maelstrom | SS | `onPlayEffect` | `maelstromOnPlay` | `{ cp: 1 }` |
| Mace | OW | `onPlayEffect` | `maceEffect` * | `{ cp: 1 }` |
| Paddlegun | DWG | `onPlayEffect` | `paddlegunEffect` * | `{ draw: 1, from: 'enemy' }` |
| Javelin | OW | `onDeathEffect` | `javelinOnDeath` | `{ draw: 1 }` |
| Iron Maiden | SS | `onDeathEffect` | `ironMaidenOnDeath` | `{ draw: 1 }` |
| Victoria | SS | `onDeathEffect` | `victoriaOnDeath` | `{ draw: 1 }` |
| Trondheim | SS | `onDeathEffect` | `trondheimOnDeath` | `{ draw: 1 }` |
| Coulomb | LH | `onDeathEffect` | `coulombEffect` * | `{ draw: 1 }` |

\* name already present in seed data; only the implementation is new.

**`drawFromPool` (9)**

| Card | Faction | Trigger | Effect name | Pool |
|---|---|---|---|---|
| Ampere | LH | `onPlayEffect` | `ampereOnPlay` | catalog, faction TG, ×1 |
| Candela | LH | `onPlayEffect` | `candelaOnPlay` | catalog, faction TG, ×1 |
| Quadrupole | LH | `onPlayEffect` | `quadrupoleOnPlay` | catalog, faction TG, ×1 |
| Rhea | SS | `onPlayEffect` | `rheaOnPlay` | catalog, SS plane, cost < 300k, strip `temporary` |
| Halberd | OW | `onDeathEffect` | `halberdOnDeath` | catalog, GT airship |
| Jormangund | OW | `onDeathEffect` | `jormangundOnDeath` | catalog, GT airship |
| Partisan | OW | `onDeathEffect` | `partisanEffect` * | catalog, GT airship |
| Cauldron | OW | `onPlayEffect` | `cauldronEffect` * | **own deck**, `vehicleType: sub` |
| Conduit | LH | `onDeathEffect` | `conduitEffect` * | **own deck**, `isBuiltIn: false`, ship or tank |

**Remaining wave 1 (8)**

| Card | Faction | Mechanism |
|---|---|---|
| Clydesdale | OW | `whenPlayed(noFriendlyInZone, extraSpawn(1))` |
| Sapphire | LH | `whenPlayed(zoneEmpty, grant({ draw: 1 }) + refund)` |
| PredatorX | SS | `resourceSurge { materialsOver: 120000, extraSpawns: 1 }` |
| Orbit | LH | `resourceSurge { materialsAtLeast: 140000, extraSpawns: 1 }` |
| Excalibur | SS | `playOnCardEffect` → `costDelta({ delta: -200000, filter: built-in ship in hand })` |
| Garrison | OW | `playOnCardEffect` (corrected) → `grantKeywords(['halfCost', 'inoffensive'], target: hand, AI only)` |
| Repairmen Ready | SS | `playOnVehicleEffect` → `grantKeywords(['scrappy'])`, then `grant({ draw: 1 })` if the target is built-in and under 200k |
| [GT] Osprey | GT | data only — `additionalSpawns: 1` |

Marauder is corrected in this wave (§6) but is not one of the 65.

### Wave 2 — `onActivate`, choice, board spawns (9)

| Card | Faction | Mechanism |
|---|---|---|
| [GT] Hunchback | GT | DP1, `activateCpCost: 1` → `grant({ draw: 1 })` |
| [GT] Monsoon | GT | DP1, `activateCpCost: 1` → move to another legal zone |
| Spectrum | LH | DP1, `activateCpCost: 1` → `drawFromPool` TG (stub, §7.2) |
| Kraken | DWG | DP4 — choose one used hero power to refresh, then `grant({ cp: 1 })` |
| Special Foundries | OW | DP4 — choose the light or heavy GT airship pool, then draw |
| Robotic Assemblers | LH | DP4 — choose a [TG] Robotics card to add to hand |
| Defensive Parapet | OW | `spawnVehicles` ×2 Parapet into the target zone, stamped Inoffensive + Scrappy + Blocker; persistent |
| Sapphire Screen | LH | `spawnVehicles` ×1 Sapphire into **each** zone, stamped Mobile + Stealthy |
| All for the Cause | WF | `playOnZoneEffect` (corrected) — grant Temporary to all friendly vehicles in the zone, then spawn 1 Martyr each (2 if that vehicle cost more than 250k) |

### Wave 3 — forced battles (8)

| Card | Faction | Mechanism |
|---|---|---|
| Flying Squirrel Attack | DWG | `playOnVehicleEffect` (corrected) — target fights alone vs 3 × Flying Squirrel (summons) |
| Martyr Attack | WF | target fights alone vs 4 × Martyr, or 6 if it is an airship or a player design of 400k or more |
| Air Strafe | SS | `playOnVehicleEffect` (corrected) — target ship fights alone vs 2 × PredatorX; if the target is a player design, a chosen Hydra or Cyclone joins as a third summon |
| Orbit Flank | LH | DP4 choice — (a) board-spawn an Orbit with Temporary into any zone, or (b) a chosen enemy vehicle fights alone vs one Orbit summon |
| Gang Up | DWG | target enemy vehicle vs **all** your vehicles in that zone; no summons |
| Braveheart | SS | DP1 + DP3, `activateCpCost: 1` — 1v1 vs an enemy vehicle in the same zone |
| Eclipse | LH | DP1 + DP3 — 1v1 vs a non-Stealthy enemy in its zone; stamps `lastActivatedTurn` itself |
| Trebuchet | OW | DP6 + DP3 + DP4 — optional 1v1 on deploy; on a clean win, fully heal and offer the repeat |

### Wave 4 — battle triggers and defender selection (8)

| Card | Faction | Mechanism |
|---|---|---|
| Catshark | SS | `onBattleEffect` at lock → `grant({ materials: 30000 })` for this turn |
| Dryad | SS | `onBattleEffect` at lock, defensive only → board-spawn another Dryad into that zone |
| The Onyx Throne | OW | `onBattleEffect` at lock, defensive only → battle-summon a Parapet; plus DP1 clause 2 (`activateCpCost: 1` → draw a heavy GT airship) |
| Sacrilego | SS | `onBattleEffect` at resolve, survived → `grant({ cp: 1 })`; plus a sacrifice choice raising a friendly ship's ending HP by 15 |
| Iron Cordon | OW | `onBattleEffect` at resolve → DP4 choice to sacrifice itself and save a destroyed allied GT airship |
| Terawatt | LH | forced-battle hook → DP4 choice to join a friendly vehicle forced to fight alone |
| Buzzsaw | WF | defender-selection rule in `ATTACK_ENEMY_FLEET` / `RESPOND_TO_ATTACK` — omissible unless the attacking force contains a ship or tank |
| Veles | WF | same rule as Buzzsaw |

Plunderer's second clause ("survives a victorious fleet battle or damages the
enemy base → draw from the enemy deck") lands in this wave too. It is not one of
the 65 — Plunderer's `costModifier` is already implemented — but it needs the
same trigger and a base-attack hook.

### Wave 5 — riders (5)

| Card | Faction | Mechanism |
|---|---|---|
| Ambush | WF | zone rider for the rest of the turn: deploy after the defender and 600 m closer in the next offensive battle there; unused at turn end → draw |
| Ongoing Attrition | DWG | zone rider: on activation while out-numbering, 40k base damage per surplus vehicle; leaves play without dealing damage → draw |
| Sub Killer | OW | remove a targeted enemy sub, plane or airship from a zone where you hold no GT vehicle; rider blocks GT deployment there for the turn |
| Recurring Threat | DWG | destroy a friendly vehicle; permanent `zoneEffect` offering a battle summon of that vehicle in defensive battles there |
| Sabotage | OW | `grantKeywords(['fragile'])` plus a `scheduled` rider: survives the turn → draw |

### Exempt (1)

| Card | Faction | Reason |
|---|---|---|
| Falcon Squadron | SS | Player-conduct guidance for the spawn sheet, the same shape as Robotic's second clause. Nothing for the engine to fire; recorded in the G2 exemption map |

## 9. Consequences

### 9.1 Hidden information

Enemy-deck draws (Paddlegun, Marauder, Plunderer clause 2) move a card between
two private zones, so **both** sides' `state.counts` resync, and the log line
cannot name the card — it is entering a hidden hand. Same rule for every
`drawFromPool` into hand.

### 9.2 Data does not retrofit live games; code does, immediately

Card `meta` is snapshotted into `games.state` and `game_players` at deal time.
**Data** changes do not reach games already in flight: reseeding fixes cards
for games started **after** the reseed only, and a game dealt from the old
data keeps whatever `meta` it was dealt. Recorded rather than solved —
migration machinery for in-flight rows is not worth its risk.

**Code** is a different authority, and it is not scoped per game. A card's
snapshotted `meta` only ever freezes an effect *name* (a string) — the
mapping from that name to an *implementation* lives in the effect registry,
which is ordinary code, not per-game data. `game-action` is redeployed once,
for every game at once, including ones already in progress. So if this wave
(or any wave) registers an effect name that some in-flight game's snapshot
already happens to carry — because that name was sitting there inert,
unregistered, before this deploy — that game's behaviour changes mid-game,
with no reseed and no data migration involved at all.

This is not hypothetical: `DWG:Kraken`'s current seed source names
`krakenOnPlay` (still an unimplemented `KNOWN_GAPS` entry as of this wave),
but any in-flight game dealt before `krakenOnPlay` replaced Kraken's older
meta would have a Kraken snapshot that still names `paddlegunEffect` — the
name this wave registers for real (`dwgEffects.ts`). Redeploying `game-action`
for this wave makes every such already-dealt Kraken start firing Paddlegun's
draw-from-the-enemy-deck effect for the rest of that game, purely because the
code backing an old, previously-dormant name went live underneath it. See the
pre-deploy check added to `docs/claude/supabase.md`'s deploy runbook.

### 9.3 Determinism

Every pool draw, shuffle and random pick goes through `ctx.rng()`, and every new
instance through `ctx.newId()`. `Math.random()` and `crypto.randomUUID()` inside
an effect break tests.

## 10. Delivery

| Wave | Content | Cards |
|---|---|---:|
| **0** | Diagnostic fix, `effectCoverage.test.ts` (G1/G2), catalog-probe broadening, `registerEffect(…, { needsCatalog })` | 0 |
| **1** | `grant`, `drawFromPool`, `whenPlayed`, `resourceSurge`, `costDelta`, `grantKeywords`, Osprey data, Marauder correction, `card-effects.md` update | **34** |
| **2** | DP1 `ACTIVATE_VEHICLE`, DP4 `pendingEffect`, the three summon rows, `spawnVehicles` | 9 |
| **3** | DP3 forced battle, DP6 Trebuchet, battle summons | 8 |
| **4** | DP2 battle triggers, Buzzsaw/Veles defender rule, Plunderer clause 2 | 8 |
| **5** | DP5 riders | 5 |
| | Falcon Squadron exemption | 1 |
| | **total** | **65** |

Wave 0 lands the guard first, so the gap is measured before it is closed. Wave 1
is independently playable and covers half the population with no new machinery.

## 11. Testing

| Area | Tests |
|---|---|
| Primitives | Behavioural unit tests per factory: `grant` for each field and both draw sources; `drawFromPool` for catalog and deck sources, filters, keyword stripping and empty-pool failure; `whenPlayed` predicates evaluated before the card lands |
| Card wiring | One table-driven test over all 65: each resolves to a registered implementation and produces its expected observable outcome on a fixture |
| Coverage guard | G1 and G2 over real seed data, with exemption maps asserted non-empty only where documented |
| Cost authorities | `costDelta` and `resourceSurge` change `effectiveCostInGame` and never `effectiveMaterialCostOf`; suppression read before payment; deltas stack |
| Suspension | `pendingEffect` freezes the game; only the owed side may resolve; `RESOLVE_PENDING_EFFECT` rejected when nothing is pending; alert set and cleared around it |
| Battle summons | Summons never enter `zone.cards`; evaporate on approval at every HP; never repairable; never pushed to `destroyed`; `summonOnly` excluded from `destroyed` at all three exits |
| Dispatch points | Once-per-turn enforcement via `activatedOnTurn`; forced battles skip the Stealthy opt-out and do not consume `lastActivatedTurn` (Eclipse excepted); DP6 deploys the vehicle before firing |
| Hidden info | No log line names a card entering a hand; `counts` resync on both sides after an enemy-deck draw |
| Determinism | Every pool draw stable under a seeded rng |
| Normalization | `normalizeState` defaults `pendingEffect`, `summons`, `activatedOnTurn` and the extended `scheduled` union on legacy rows |

Commands: `npx vitest run` (never with `--root`),
`npm --prefix frontend run build`, `npm --prefix frontend run lint`.

## 12. Operations

- Every commit touching `shared/` includes `npm run functions:sync` output — the
  drift test enforces it.
- Each new faction effects file needs its side-effect import in
  `shared/engine/index.ts` **and** an entry in
  `supabase/functions/shared-manifest.json` under `game-action`.
- Relative imports inside `shared/` carry the `.ts` extension.
- Seed changes require `npm run seed:build` and applying `seed_data.sql` to the
  remote project; card ids are deterministic, so re-seeding is an upsert.
- `game-action` is redeployed per `docs/claude/supabase.md` after each wave that
  changes `shared/`.
