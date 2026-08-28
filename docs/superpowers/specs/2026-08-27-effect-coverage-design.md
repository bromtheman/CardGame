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
| 3 | `SET_ALERT_CARD` becomes automatic — the engine sets it; no hand button is restored. **Narrowed in wave 2** to effects that force opponent interaction; a pure choice sets no alert (§4.2) |
| 4 | Fragile is auto-assigned to player-made airships only |

Taken during this design:

| # | Decision |
|---|---|
| 5 | All 65 cards ship in one spec, delivered in five ordered waves (§10) |
| 6 | Forced battles and mid-resolution choices share **one** suspension slot, `state.pendingEffect` (§4.2). **Narrowed in wave 3** to choices only; a battle wait suspends in `ActiveBattle.continuation` (§4.3, departure 3) |
| 7 | Summon-only vehicles are **seeded cards** flagged `meta.summonOnly`, not a second species of card object (§7.1) |
| 8 | Conditional Half-Cost is a **hand-side, price-time** property; hulls on the board keep their printed keywords (§4.6) |
| 9 | Effects are **parameterised TypeScript factories**, not a data DSL in `meta` (§5) |
| 10 | Battle summons are **combatants inside `activeBattle`**, never board units (§4.4) |

Taken during wave 2:

| # | Decision |
|---|---|
| 11 | **Spawning is not playing.** A vehicle placed by `spawnVehicles` does not fire its own `onPlayEffect` (§7.4) |
| 12 | A suspended choice can be **declined**, and `pendingEffect.options` is **public** (§4.2, departures 3 and 5) |
| 13 | Partially-implemented cards are tracked in a `PARTIAL` map beside `KNOWN_GAPS`, not left invisible (§4.1) |

Taken during wave 3:

| # | Decision |
|---|---|
| 14 | An effect waiting on a **battle** suspends in `ActiveBattle.continuation`, not in `pendingEffect`. Decision 6's "one slot" holds for choices only (§4.3, departure 3) |
| 15 | A forced battle sets **no** alert card, narrowing decision 3 to wave 5's riders (§4.3, departure 2) |
| 16 | A forced battle target is picked through a **choice dialog**, not board targeting. On-field vehicles are already public, so this leaks nothing, and it needs no new picking UI (§4.3, departure 4) |
| 17 | `lockBattle` is **split**, not reused: only Eclipse stamps `lastActivatedTurn` (§4.3, departure 1) |
| 18 | A battle summon is identified by **list membership**, not a side field, so one array serves attacker- and defender-side summons (§4.4) |

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
- **G3** — every trigger key a card carries is one the engine dispatches for a
  card of its `type`. Wave 2 adds `onActivate` to the vehicle row; without that,
  closing Spectrum’s gap makes G3 fail.

All three maps — `EXEMPT`, `KNOWN_GAPS` and `PARTIAL` — live in the test. Only
one card is permanently exempt: **Falcon Squadron**, whose text ("considered
destroyed if any of its sub-vehicles is destroyed in battle") is player-conduct
guidance for the spawn sheet, the same shape as the Robotic keyword’s second
clause — there is nothing for the engine to fire. Buzzsaw and Veles read like
conduct text but are not: "may be omitted from defensive battles unless…" is
Stealthy-shaped and is implemented (§8, wave 4).

The guard protects a card only while it is listed. Three blind spots are known,
and wave 2 closes the third:

1. A card that leaves `KNOWN_GAPS` is no longer checked — Garrison’s trigger-key
   correction can be reverted today with the suite still green.
2. G3 catches a *type*-level mis-wiring only. A same-type mix-up —
   `playOnVehicleEffect` where the text needs `playOnCardEffect`, exactly
   Garrison’s bug — needs a human reading the card text against the key.
3. A **partially**-implemented card passes G2, which asks "resolves at least one
   implemented effect", not "all of its card text works". Such a card cannot go
   in `KNOWN_GAPS` without tripping the stale-entry assertion, so wave 2 adds a
   separate `PARTIAL` map: same key shape, a wave label per entry, asserted to
   name real cards and to never intersect `KNOWN_GAPS`. It opens with Plunderer
   (clause 2, wave 4) and DWG Waters (clauses 2–3, wave 4).

This guard is the item that stops the gap reopening, and it lands first.

### 4.2 `state.pendingEffect` — one suspension slot

Every effect before wave 2 was `(payload) => boolean` and fully resolved inside
one action. Two families cannot: a choice must wait for the player, and
Trebuchet's "you may repeat this effect" must wait for a battle report. This
slot was designed to serve both; **wave 3 found that it cannot**, and split the
battle case out into `ActiveBattle.continuation` — see §4.3, departure 3. What
follows describes the choice slot, which is all this field ever holds.

**This section describes what wave 2 built, not a sketch.** It departs from the
original design in five places, each marked.

```ts
interface PendingEffect {
  effect: string                    // registry name to re-enter
  side: Side                        // who owes the decision
  card: CardInstance                // the suspending card, verbatim
  kind: 'choice'                    // the only value; see §4.3, departure 3
  prompt: string                    // the dialog's one-line question
  options: { id: string; label: string }[]
  data?: Record<string, unknown>    // effect-owned continuation state
}
```

**The card, not its name (departure 1).** The original sketch carried
`cardName` and `instanceId`. By resolve time an ability card has already been
`spendCard`'d into `state.destroyed` — it is in neither hand nor field — so a
name cannot rebuild the continuation's `EffectPayload`, and `game-action`'s
catalog probe has nothing carrying `meta` to scan. Storing the card verbatim
gives both for free and leaks nothing: it was played publicly one action
earlier. `prompt` is new for the same reason — the resolving dialog needs a
question, and only the effect knows it.

- Added to `PublicGameState`; defaulted in **both** `normalizeState` and
  `buildInitialGame`, following `zoneEffects` (commit `9d93f13`).
- New action `RESOLVE_PENDING_EFFECT { choiceId?, targetInstanceId?, zoneId?, cancel? }`.

**A dedicated freeze, not `battleFrozen` (departure 2).** The sketch extended
`battleFrozen`. It must not: `BATTLE_ACTIONS` admits `USE_HERO_POWER`,
`RESPOND_TO_ATTACK`, `SUBMIT_BATTLE_REPORT` and `DECIDE_BATTLE_REPORT`, none of
which should be legal while a choice is owed. `applyAction` instead checks
`state.pendingEffect !== null` ahead of the battle check and admits only
`PENDING_ACTIONS` — `RESOLVE_PENDING_EFFECT`, `CONCEDE`, `ABANDON`.

**Resume: one name, re-entered.** The suspending effect keeps a single registry
entry, so the coverage guard still counts one implementation per card. Two
optional fields on `EffectPayload` carry the second phase:

```ts
resolution?: { choiceId?: string; targetInstanceId?: string; zoneId?: number }
pending?: PendingEffect
```

`RESOLVE_PENDING_EFFECT` clears the slot **before** calling the effect, so a
continuation may suspend again (wave 3's Trebuchet does). The `choice`
primitive branches on `payload.resolution`:

| Entry | Behaviour |
|---|---|
| First, options non-empty | write `pendingEffect`, return `true` |
| First, options **empty** | call `resolve(payload, null)` immediately — no suspension |
| Re-entry, `choiceId` in `pending.options` | call `resolve(payload, choiceId)` |
| Re-entry, unknown `choiceId` | return `false` → 400; the slot survives, the player may retry |

The empty-options rule is load-bearing. Kraken reads "refresh one of your hero
powers then gain 1cp", so a player with no used powers must still get the CP.

**Cancel, and a rollback escape (departure 3).** `{ cancel: true }` clears the
slot and logs that the effect was declined. The player has already paid, so
declining only forfeits their own upside — checked against all three wave-2
choices, none of which can be exploited by refusing. Separately, if
`effectFor(pending.effect)` returns `null` — a deploy rolled back underneath a
live suspension — the handler clears the slot and logs, rather than leaving a
game neither player can advance.

**Alert card (departure 4, narrowing decision 3).** A pure choice sets **no**
alert card. `pendingEffect` is public and carries the card, so the opponent
already sees what froze the game; and an engine-set alert would hit
`SET_ALERT_CARD`'s "opponent holds the slot → 409" rule and could reject the
card play outright. Decision 3 therefore covers effects that **force opponent
interaction** — not a choice owed by the player who acted. No hand button is
restored either way. **Wave 3 narrowed this again** (§4.3, departure 2): a
forced battle raises the `BattleOverlay`, which is louder than the banner and
carries the same collision risk, so decision 3 now reaches only wave 5's
riders — an effect planted on the opponent's own next battle, where nothing
else announces itself.

**Options are public (departure 5 — a new constraint).** `pendingEffect` lives
in `PublicGameState`, so `options` is visible to both players. A choice may only
be offered over information the opponent already has. Wave 2's three qualify
(your used hero powers, two named catalog pools, the four public [TG] Robotics
built-ins) and waves 3–4's do too, but **a choice over your own hand or deck
would leak it**, and the private-options mechanism that would need does not
exist. Check this before adding a choice.

### 4.3 Six dispatch points

| # | Point | Shape |
|---|---|---|
| DP1 | `onActivate` | New `ACTIVATE_VEHICLE { instanceId, targetInstanceId?, zoneId? }` action, handled in `shared/engine/activate.ts`. `activatedOnTurn: number | null` on `ZoneCardEntry` (**required**, so `tsc` finds every entry literal; defaulted in `normalizeState`) enforces once-per-turn, and is stamped **before** the effect fires so a suspending activation cannot re-enter. The CP price is card data: `meta.activateCpCost` — a number, the same class as `additionalSpawns`, so no registry change. No freshly-deployed restriction: the card text says "once per turn" and nothing more |
| DP2 | Battle triggers | `onBattleEffect` fires at **lock** and at **resolve** with a `BattleContext` payload (`phase`, `zoneId`, `isDefender`, `survived`, `won`). `onBattleVictory` / `onBattleDefeat` are resolve-only sugar dispatched per side outcome. A side **wins** when the enemy has no surviving participant and **loses** when it has none of its own; both false is a draw |
| DP3 | Forced battle | `declareForcedBattle(game, { zoneId, aggressor, attackerIds, defenderIds, summons, continuation, cause, activatesZone })`, exported from `battleDeclare.ts`. Skips the Stealthy opt-out — the card *forces* the fight. **Built in wave 3; it departs from this row in three places, marked below.** |
| DP4 | Choice | `state.pendingEffect`, built in wave 2 — see §4.2 for the shipped shape, freeze rule and resume mechanics |
| DP5 | Rest-of-turn riders | Extends the existing `state.scheduled[]` discriminated union rather than adding a state field: it already carries `side` and `dueTurn` and is already processed in `endTurn` |
| DP6 | A **vehicle** whose effect targets something outside its own zone | The two gaps recorded in `architecture.md`. `PLAY_CARD_TARGETING_CARD_IN_HAND` gains an optional `zoneId` and accepts a vehicle carrying `playOnCardEffect`: the vehicle deploys to the zone (with `additionalSpawns` and `resourceSurge`), then the effect fires, and the card is **not** `spendCard`'d. **Wave 3 built the hand direction only** — see departure 4 |

Two rulings fall out:

- **A forced battle is not a zone activation.** It neither consumes nor is
  blocked by `lastActivatedTurn`. Eclipse is the sole exception and says so in
  its own text, so `eclipseEffect` stamps `lastActivatedTurn` itself.
- **Summons bypass placement legality.** A Martyr is not *played*, so biome and
  screen rules do not gate it — otherwise Martyr Attack fails against a target in
  a land zone.

#### DP3 and DP6 as wave 3 built them — four departures

**`lockBattle` is not reused; it is split (departure 1).** `lockBattle` stamps
`zone.lastActivatedTurn` and logs "Fleet battle declared" unconditionally. Both
are wrong for a forced battle: the stamp contradicts this section's own ruling
that a forced battle is not a zone activation, and reused unchanged it silently
spends the zone's one activation per turn — surfacing two actions later as a 409
on a legitimate fleet attack. `battleDeclare.ts` therefore splits into three:
`setBattle` builds the `activeBattle` object and is the **only** literal
constructing it, so a future field is one edit; `lockBattle` is `setBattle` plus
the stamp plus the fleet log line, leaving `ATTACK_ENEMY_FLEET` and
`RESPOND_TO_ATTACK` byte-identical in behaviour; `declareForcedBattle` is
`setBattle` plus its own log line naming the cause, and stamps
`lastActivatedTurn` **only** when passed `activatesZone` — Eclipse alone.

It refuses (returns `false`, so the calling effect 400s and `applyAction`
discards the clone) on: no such zone, a battle already active, an empty attacker
or defender list, or an id that is neither an on-field entry on its own side nor
one of the listed summons.

**A forced battle sets no alert card (departure 2, narrowing decision 3
again).** The alert slot is a one-line banner meaning "a card was revealed, its
effect is pending"; a forced battle raises the full `BattleOverlay`, which is
strictly louder and already public. Three of the five forced-battle cards are
board vehicles rather than abilities in hand, and `SET_ALERT_CARD` accepts only
ability cards in hand. The slot is also single and shared, so an engine-set
alert can collide with an alert the opponent already holds — the 409 that
`SET_ALERT_CARD` raises for exactly that case. Decision 3 now covers only the
riders of wave 5, which plant an effect on the opponent's own next battle.

**The battle continuation lives on `ActiveBattle`, not in `pendingEffect`
(departure 3).** §4.2 predicted a `kind: 'battle'` value on the suspension slot.
It cannot work: `pendingEffect !== null` freezes the game to `PENDING_ACTIONS`,
which admits neither `SUBMIT_BATTLE_REPORT` nor `DECIDE_BATTLE_REPORT`, so a
battle declared under such a slot could never be reported. Relaxing that freeze
would break the invariant that a non-null `pendingEffect` means the game is
frozen on a choice — an invariant three current readers rely on — and would
leave an orphaned slot able to deadlock a game. Instead:

```ts
interface BattleContinuation {
  effect: string                    // registry name to re-enter when the battle resolves
  side: Side
  card: CardInstance
  data?: Record<string, unknown>    // effect-owned continuation state
}
```

`ActiveBattle.continuation` cannot outlive its battle, because
`DECIDE_BATTLE_REPORT` already nulls `activeBattle`. The continuation fires
there, **after** the death triggers, and carries the same rollback escape as
`pendingEffect`: an `effectFor` that returns `null` logs and drops rather than
stranding the game. `pendingEffect.kind` therefore stays `'choice'` only, and a
continuation that then wants a decision — Trebuchet's repeat — writes an
ordinary choice into the now-free slot, exactly as a suspending death effect
does.

**DP6 built the hand direction only (departure 4).** The row above originally
gave `PLAY_CARD_TARGETING_CARD_ON_FIELD` the optional `zoneId`, for Trebuchet.
Trebuchet's text reads "**When Played**, you may choose to have this vehicle
battle an opponents vehicle from the same zone" — an on-play trigger and a
choice, not a targeted play — so its seed key is corrected to `onPlayEffect`
(§6) and it picks its opponent through the same choice dialog as Braveheart,
Eclipse and Orbit Flank. "You may" is then literally the dialog's decline. That
leaves **no** vehicle carrying `playOnVehicleEffect`, so the field direction has
no customer and was not built; `REACHABLE_TRIGGERS`' `vehicle` row gains
`playOnCardEffect` only.

Excalibur is the hand direction and cannot be served any other way: it targets a
card in the player's own hand, and `pendingEffect.options` is public (§4.2,
departure 5), so a choice would leak the hand. It stays playable through plain
`PLAY_CARD_TO_ZONE` with its effect unfired when no legal target exists —
otherwise a 550k blocker becomes unplayable — and skipping a purely
self-beneficial effect costs no one else, the same latitude `cancel` already
grants.

The shared deploy body — placement, `additionalSpawns`, `resourceSurge` — is
extracted out of `PLAY_CARD_TO_ZONE` into `deployVehicle`, which both handlers
call, rather than duplicated.

### 4.4 Battle summons

`ActiveBattle` gains `summons: ZoneCardEntry[]`. Summoned combatants live only
inside the battle: they never enter `zone.cards`, and when the report is approved
they evaporate **regardless of HP** — no repair eligibility, no death record,
nothing pushed to `state.destroyed`. `participantsOf` merges the two sources, so
reporting, the spawn sheet and approval are otherwise unchanged.
`normalizeState` defaults `summons` to `[]` on legacy rows.

**`ActiveBattle` is declared three times.** `engineTypes.ts`, structurally
inline in `PublicGameState` (`gameInit.ts`), and again as a local type inside
`BattleOverlay.tsx`, which keeps its own mirror of `participantsOf` because the
engine does not export one. `summons` and `continuation` (§4.3, departure 3)
must be added to all three, and the merge to both copies of `participantsOf`.

**A summon carries no side field.** Membership decides it: an id in
`attackerIds` belongs to the aggressor, one in `defenderIds` to the defender, so
`participantsOf` needs only a per-list fallback into the summon map. Wave 4's
Onyx Throne, which summons a Parapet onto the *defending* side, works unchanged.

**What "evaporate" excludes, precisely.** In `DECIDE_BATTLE_REPORT` a summon is
skipped by every branch of the resolution loop: no removal from `zone.cards`
(it was never there), no `discardCard`, no `onDeathEffect` — a summoned
PredatorX or Orbit is a draftable card that could carry one — and it is not
counted in the "N vehicle(s) lost" line, because nothing left either player's
board. One summary line reports the summons instead. Repairs are refused twice
over: `validateRepairChoices` rejects a summon id outright, and `autoRepairIds`
receives only the non-summon roster, so a Scrappy summon cannot auto-repair.
Its ending HP is still **required** in the report — the report-completeness
check counts every participant — it simply changes nothing.

The rule is stronger than `isSummonOnly` and does not depend on it: Air Strafe's
PredatorX and Orbit Flank's Orbit are ordinary draftable cards and evaporate
too. Write the sweep so it never pushes, rather than reusing the guard.

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

**"Per-instance" means the delta dies with the instance (clarified in wave 3).**
`discardCard` strips `costDelta` from **every** card leaving play, not only from
a captured card going home. Wave 3's final review found the gap: the strip
originally ran only inside the `owner !== controller` branch, which was
sufficient while Marauder — which stamps a *captured* card — was the only
consumer. Excalibur is the first effect to stamp a player's **own** card, and
without an unconditional strip a discounted hull that died carried its discount
into `state.destroyed`, `reshuffleDiscard` fed it back into the owner's deck,
and the discount became permanent and re-stackable by a second Excalibur. The
hero power `salvage` was a shorter path to the same result. `reshuffleDiscard`
mints a fresh `instanceId` for every returning card, so the instance the delta
belonged to no longer exists — stripping is what "per-instance" already meant.
`ownerSide` stripping stays scoped to the going-home path; it is about
ownership, not pricing.

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

Wave 2 adds a third source: **`state.pendingEffect.card`**. A resolving choice’s
card is in neither hand nor field — it was spent when it was played — so without
it Special Foundries and Robotic Assemblers resolve against an empty catalog.

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
| `spawnVehicles` | `{ cardName, count, zones: 'target' | 'all', keywords }`, `needsCatalog` | Parapet, Sapphire Screen, All for the Cause |
| `summonBattle` | `{ summon, count, countIf?, mode }` | 7 cards (§4.4) |
| `zoneRider` | `{ kind, expiresAtEndOfTurn, onExpiryUnused? }` | 4 cards |
| `choice` | `{ prompt, options(p), resolve(p, choiceId) }` → `pendingEffect` (§4.2) | 3 cards + Iron Cordon, Terawatt, Sacrilego |

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
| Trebuchet | `playOnVehicleEffect` | "**When Played**, you may choose to have this vehicle battle…" | → `onPlayEffect` (§4.3, departure 4) |

Cosmetic: `Orbit Flank`'s effect name carries a trailing space (the registry
trims it), and `CauldronEffect` / `MartyrAttackEffect` are capitalised
inconsistently with every other name. Normalised to `orbitFlankEffect`,
`cauldronEffect`, `martyrAttackEffect`.

⚠ **Wave 1 normalised only `cauldronEffect`.** An earlier version of this
section claimed all three landed "in the same pass"; that was false. `Orbit
Flank`'s trailing space and `MartyrAttackEffect`'s capitalisation both survived
into wave 3, which corrects them alongside its own cards. Note that
`shared/effects/registry.test.ts` deliberately uses the literal
`'orbitFlankEffect '` as a hand-built fixture for `effectName`'s trim, which is
correct to leave as it is.

### Cards shipped with no authored effect name

Three wave-3 cards carry meta that cannot dispatch anything, so the names
themselves are content this wave authors rather than merely implements:

| Card | Today | Authored |
|---|---|---|
| Braveheart | `meta: {}` | `onActivate: 'braveheartActivate'`, `activateCpCost: 1` — its text prints "pay 1cp" |
| Excalibur | `meta: {}` | `playOnCardEffect: 'excaliburEffect'` |
| Eclipse | `onActivate: 'eclipseEffect'`, no `activateCpCost` | `activateCpCost: 0` |

**Eclipse costs no CP.** Its text reads "Once per turn this vehicle may target…"
and, unlike Braveheart's, never mentions a payment. `ACTIVATE_VEHICLE` and
`BoardZone`'s button both require *both* keys, so without an explicit `0` the
ability has no button and is unreachable — the card is currently in exactly that
state.

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

**Rejecting them from decks costs two call sites.** `DeckCardInfo` gains
`summonOnly`, populated where the map is built in `lobby-action` and in
`DeckBuilderPage`; the builder’s visible `pool` filter must exclude them too, or
it offers a card that its own validation then rejects. `CardsPage` keeps showing
them — they are real cards, and a player should be able to read a Martyr.

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

Added in wave 3:

- **Gang Up's "all your vehicles" excludes Inoffensive ones.** Inoffensive is
  precisely "cannot attack" — `ATTACK_ENEMY_FLEET` rejects such an attacker by
  name — and a forced battle is not a licence to break it. The card fails (400)
  when that leaves no attacker.
- **Trebuchet's "fully heal it" needs no mechanic.** The board tracks no HP;
  ending HP exists only inside a battle report, where a survivor either lives
  (≥ `SURVIVE_HP_PERCENT`) or is repaired. Trebuchet prints `SCRAPPY`, which
  already repairs it free across the whole 80–89.999% band, so the clause is
  satisfied by its own keyword. Only the win test is new: **Trebuchet still on
  the field and every defender gone**, read off the post-resolution state, which
  needs no outcome plumbing on the payload.
- **Trebuchet's repeat is unbounded but self-limiting.** Each iteration requires
  another clean win and another enemy vehicle left in the zone, so it terminates
  on the zone's population. Card text imposes no other cap and none is invented.
- **"Fights alone" means the target is the only defender.** Its allies in the
  zone do not join, whatever they are.

### 7.4 Spawning is not playing

A vehicle placed by `spawnVehicles` enters `zone.cards` with its printed
keywords plus whatever the summoning card grants, and **nothing else runs**.
Its own `onPlayEffect` does not fire; only the `PLAY_CARD_*` handlers play a
card. Sapphire Screen forces the ruling: Sapphire prints "played into an empty
zone → draw a card and refund its cost", so firing it on spawn would turn a 90k
ability into three bodies, up to three cards and a 90k refund.

Two consequences follow for the summon-only rows (§7.1):

- Spawns **bypass placement legality** — biome and screen rules gate plays, not
  summons (§4.3) — so a Martyr reaches a land zone.
- `summonOnly` cards are excluded from `drawFromPool`’s catalog pools. No
  current pool matches one, but nothing should ever mint a Martyr into a hand.

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

### Wave 3 — forced battles (9)

| Card | Faction | Mechanism |
|---|---|---|
| Flying Squirrel Attack | DWG | `playOnVehicleEffect` (corrected) — target fights alone vs 3 × Flying Squirrel (summons) |
| Martyr Attack | WF | `playOnVehicleEffect` — target fights alone vs 4 × Martyr, or 6 if it is an airship or a player design of 400k or more |
| Air Strafe | SS | `playOnVehicleEffect` (corrected) — target ship fights alone vs 2 × PredatorX; if the target is a player design, a chosen Hydra or Cyclone joins as a third summon. The choice resolves **before** the battle is declared |
| Orbit Flank | LH | DP4, two chained choices — mode, then either a zone (board-spawn an Orbit with Temporary) or an enemy vehicle (fights alone vs one Orbit summon) |
| Gang Up | DWG | `playOnVehicleEffect` — target enemy vehicle vs all your **non-Inoffensive** vehicles in that zone (§7.3); no summons |
| Braveheart | SS | DP1 + DP3 + DP4, `activateCpCost: 1` — choice over enemy vehicles in its own zone, then 1v1 |
| Eclipse | LH | DP1 + DP3 + DP4, `activateCpCost: 0` — choice over **non-Stealthy** enemies in its zone, then 1v1; stamps `lastActivatedTurn` itself |
| Trebuchet | OW | `onPlayEffect` (corrected) + DP3 + DP4 — a choice over enemy vehicles in the zone it deployed to, declined via cancel; on a clean win, the battle continuation offers the same choice again |
| Excalibur | SS | DP6 (hand direction) — deploys to a zone and stamps `costDelta: -200000` on a chosen AI ship in hand |

Excalibur was re-filed here out of wave 1 rather than shipped half-wired: it is
the only vehicle whose text targets a card in hand, and DP6 is what carries it.

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
| **2** | DP1 `ACTIVATE_VEHICLE`, DP4 `pendingEffect`, the three summon rows, `spawnVehicles`, the `PARTIAL` guard map, and the UI for both dispatch points | 9 |
| **3** | DP3 forced battle, DP6 hand direction (Excalibur), battle summons, `ActiveBattle.continuation` | **9** |
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
| Suspension | `pendingEffect` freezes the game to `PENDING_ACTIONS`; only the owed side may resolve; `RESOLVE_PENDING_EFFECT` rejected when nothing is pending; an unknown `choiceId` leaves the slot intact; `cancel` clears it; empty options resolve without suspending; an unregistered pending effect clears rather than bricking the game |
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
