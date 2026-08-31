# TG faction — wave 7

> **For agentic workers:** implement task-by-task, TDD, one commit per task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add the TG faction — 26 new cards, a new keyword with a new `endTurn`
rule, a draftable faction, and a cross-faction pool narrowing that keeps LH
byte-for-byte unchanged. `KNOWN_GAPS` ends the wave at **0**.

**Architecture:** three pieces of plumbing come first and none of them is a
card — `DECK_FACTIONS`, `UPKEEP_REQUIRED`, and the LH `[TG] Robotics` pool.
Then the cards: ten are vanilla, two are pure data keys, four are one-liners
over existing primitives, two are small extensions, and five are genuinely new
(a replacement effect, a resolve-phase bystander pass called **DP8**, a
per-hull battle rider, and a cross-zone battle).

**Tech stack:** TypeScript (strict) in `shared/`, Vitest, React 19 frontend,
Supabase edge functions (Deno) fed by `npm run functions:sync`.

**Specs:**
- `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — binding for
  the **machinery** (DP1–DP7, the suspension rules, battle summons, the
  `zoneEffects` rider contract, §4.6's surge shape). Its card list is finished;
  wave 7's cards are not in it. §7.3 records this wave's rulings.
- `supabase/seed/source/builtInCards/TG-built-in.js` — **the authority on the
  26 cards.** Where this plan and the seed source disagree, the source wins.
- `docs/superpowers/plans/2026-08-31-tg-faction-wave-7-handoff.md` — the
  briefing. §7 below records the five places it drifted.

---

## Global constraints

Copied from `CLAUDE.md` and `docs/claude/card-effects.md`. Every task inherits
them.

- **TDD, no exceptions.** Failing engine test first, then implement, then
  `npx vitest run` and report the **before→after passing count**.
- **Never pass `--root` to vitest** — it silently runs 0 tests.
- **Every commit touching `shared/` runs `npm run functions:sync`** and includes
  its output. `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- **Every commit touching a card's `meta` runs `npm run seed:build`**, and greps
  the generated SQL for the names it changed. This wave adds 26 rows and edits
  four, so it is load-bearing throughout rather than a formality at the end.
- **Relative imports inside `shared/` need the `.ts` extension.**
- **Key effects by a unique registry id, never by a card's name.** A reused name
  rebinds another card's behaviour mid-game (Kraken/Paddlegun, spec §9.2).
- **`state.log` must never name a card in a hidden hand.**
- **`{ needsCatalog: true }` on every effect that reads `ctx.catalog`** —
  directly, via `catalogCard`, or through a catalog `drawFromPool`. Unit tests
  cannot see a missing flag (`makeCtx` hands every test a catalog), so assert
  `CATALOG_EFFECTS` membership at runtime.
- **A data key's VALUE is never checked by the guard, only its presence.** Every
  new data key needs a seed-backed assertion.
- **A new `PublicGameState` field needs both halves**: a `normalizeState` default
  *and* an initial value in `buildInitialGame`. *This wave adds none* — see
  Task 16, which was deliberately designed to avoid one.
- **Every per-entry `meta` stamp must be named in `discardSnapshotOf`'s strip
  list.** TypeScript does not catch one you forget, and it rides into
  `state.destroyed` and back into a deck.
- **Delete a `KNOWN_GAPS` entry and decrement its `toHaveLength` literal in the
  same commit that makes its card work.**
- **Never use a real seeded effect name as a test stand-in** — use a `t_` prefix.
- After `git checkout --` on a `shared/` file, **re-run `functions:sync`**;
  `core.autocrlf` makes the drift test fail on a tree `git diff` calls clean.

**Baseline, measured on this branch at `9691fd0`** (not copied from the
handoff): `npx vitest run` → **932 passed / 33 files, 0 failed**. This matches
the wave-6 close-out figure exactly, so the handoff's unverified number was
right.

---

## 1. The rulings

Settled before any code, per the kickoff. Each is recorded in the spec's §7.3 by
Task 1. Three were the owner's call and are marked ⚑.

### The keyword

- **U-0 — the definition.** `UPKEEP_REQUIRED: 'upkeepRequired'`. At turn start,
  reduce the incoming side's resources for that turn by **15%** of the card's
  cost. `UPKEEP_RATE = 0.15` in `gameSettings.ts`.
- **U-1 — which cost.** `effectiveMaterialCostOf` — the Half-Cost floor, the
  same authority damage, repairs and in-battle resources read. **Never**
  `effectiveCostInGame`, which is play-time-only (costModifier, costDelta,
  surge) and must not reach a recurring charge. ⚠ No TG card carries both
  `UPKEEP_REQUIRED` and `HALF_COST`, so the two candidates agree on every card
  that exists; Task 3 pins the ruling with a fixture that carries both.
- **U-2 — rounding.** `Math.ceil`, matching `repairCostOf`, the other
  player-facing charge. All ten cards' 15% is exact to the hundred, so this is
  unobservable on real data and needs a fixture too.
- **U-3 — clamp.** `Math.max(0, …)`. Income is *set* each turn, so a negative
  could never carry forward as debt — but `canAffordInGame` compares
  `materials >= cost`, so a negative would behave plausibly and silently. Choose
  rather than default.
- **U-4 — whose hulls.** Every `UPKEEP_REQUIRED` hull the paying side
  **controls**, across all zones. A captured hull is fed by its controller
  (`ownerSideOf` decides whose *deck* it returns to, not who pays for it).
  Battle summons never touch `zone.cards` and never pay. **Spawned hulls do** —
  Fear's three Horrors sit in `zone.cards` carrying printed keywords.
- **U-5 — a hull deployed this turn** pays nothing until its owner's next turn
  start. This falls out of the seam (income is set for the *incoming* side);
  stated so it is pinned rather than incidental.
- **U-6 — Temporary before upkeep.** `endTurn`'s Temporary cull already runs
  *before* the income line, so a Temporary hull has despawned and pays nothing.
  No TG card carries both keywords; the ordering is free and it is the honest
  one, so it is kept and asserted.
- **U-7 — one log line per turn**, giving the total, not one per hull. The §4.4
  precedent is `"N summoned vehicle(s) evaporated"`, deliberately not six lines
  for six Martyrs. Board hulls are public, so naming them would leak nothing —
  a total simply reads better.
- **U-8 — the 15% rate is scale-invariant, and that is why it needs no
  per-card tuning.** Income is **set** to `floor(turnNumber) × materialsPerTurn`,
  never accumulated (`endTurn`), so a card costing C is unplayable until income
  reaches C. A card's upkeep is therefore always ≈15% of the income available on
  the turn it first becomes playable — at *any* cost, and at any lobby rate
  across the whole `MIN_MATERIALS_PER_TURN`…`MAX_MATERIALS_PER_TURN` range.
  Worked at the two extremes of the TG set, on the 75k default: Horror (70k) is
  first affordable at turn 1, where income is 75k — 10,500 is **14%** of it.
  Fear (800k) is first affordable at **turn 11**, where income is 825k —
  120,000 is **14.5%** of it. The ratio does not move.

  ⚠ The handoff's §2.2 warning — *"Fear alone costs 120k/turn, and the three
  Horrors it spawns add 31.5k — 151.5k, more than a full turn's income at turn
  2"* — measures Fear against a turn it cannot be on the board for. Nothing puts
  a Fear into play early: no effect spawns one, a catalog mint lands it in
  **hand** and it still has to be paid for, and the largest discount reachable
  (Excalibur's −200k on a built-in ship) only moves it to turn 8, where income
  is 600k and the ratio is unchanged. The claim is withdrawn, not accepted.

  The one real deviation is small and is the card working as designed: Fear's
  three Horrors add 31,500 of upkeep that was never purchased, taking its
  effective charge to 151,500 against 825,000 — **18.4%** rather than 15%. That
  is the price of three free bodies, and it is not a balance problem.

### The cards

- ⚑ **D-1 — "an AI vehicle" (Alarmed) is `isBuiltIn === true`.** This overturns
  the handoff, which claimed "the engine has no AI concept" and recommended the
  `ROBOTIC` keyword. The engine has had one since wave 1: **spec §7.3's very
  first ruling** reads *"'AI' means `isBuiltIn === true`"*, `OW:Garrison` prints
  the identical phrase (*"Target an AI vehicle in hand"*), and three effect
  modules implement it (`owEffects.ts:138`, `ssEffects.ts:86/127`,
  `wfEffects.ts:169`). Reading Alarmed's "AI" as ROBOTIC would put two meanings
  of one printed phrase into the game, which spec decision 1 forbids.
  ⚠ **Consequence, recorded rather than discovered:** in a TG deck almost every
  hull is built-in, so clause 1 reduces to *"you already hold this zone"*. That
  is a mild restriction, and it is the price of a consistent glossary.
- **D-2 — Alarmed's sacrifice fires no `onDeathEffect`**, matching
  `sacrificeEntry`'s existing contract and wave 5's decision 28 ("destroy" fires,
  "remove from play" does not). Jealousy is a TG card whose entire text is a
  death draw, so a TG player will notice within one game; the answer is
  deliberate, not inherited.
- **D-3 — Horror means "this Horror".** The sentence continues *"create another
  copy **of it**"*, which points back at the same hull, and DP2 already
  dispatches per participant. Reading it as "any Horror anywhere" would need
  DP8's dispatch and is a much bigger card than it looks.
- **D-4 — Horror's "max one spawn per zone" is per turn**, read off the board as
  *"refuse if a Horror in this zone already has `playedOnTurn === game.turnNumber`"*.
  Each `fire()` is an isolated invocation with no shared scratchpad, so any
  counter must be read off the board; this reading needs no new state.
- **A-1 — Acceptance's "loses halfcost" is price-only.** The hull on the board
  keeps `HALF_COST` in `keywords`, which feeds `effectiveMaterialCostOf` and so
  its base damage and repair bill. PredatorX has this shape already and wave 6's
  ruling B-7 answered the same question for Paladin. So a surged Acceptance
  **pays 150k and still hits like a 75k hull.** The alternative needs a
  keyword-stripping arm that does not exist.
- **A-2 — Acceptance's comparator is `materialsAtLeast`.** The text says "at
  least"; §4.6 keeps exactly one comparator per card so each card's own wording
  survives.
- **E-1 — Nostalgia replaces battle death only.** *"Whenever this **would** be
  destroyed"* is broader, but `sacrificeEntry` fires no `fireDeathEffect`, so
  route (a) could not save a sacrificed Nostalgia anyway. Scoped and stated.
- ⚑ **E-3 — Vengeful, a submarine, does damage an enemy base.** Card text is
  authoritative (spec decision 1), and the submarine rule governs *bombardment*
  (`baseStrikersIn`, reached only from `ATTACK_ENEMY_BASE`), not card-forced
  damage. Task 14 amends the Submarine glossary entry from *"can never damage an
  enemy base"* to a bombardment-scoped wording, so no printed rule contradicts a
  shipped card.
- **E-2 — Vengeful is per vehicle lost, not per battle.** Two casualties on your
  side is 80k. `casualties.filter(c => c.side === actor)` is on the context.
- **E-2b — a Vengeful destroyed in that same battle does not fire.**
  `participants` still holds a destroyed hull's entry, so `dispatchBattleResolve`
  *does* reach it — this is not free. It is enforced by requiring
  `findVehicle(card.instanceId)` to locate the hull still on the board, which
  also supplies the zone the damage lands in.
- **E-4 — an enemy `BLOCKER` does not stop Vengeful.** `ATTACK_ENEMY_BASE`
  refuses over a Blocker; this is not that handler, for the same reason E-3 is
  not `baseStrikersIn`. Consistent with E-3 or neither is defensible.
- **E-5 — the Factories refuse an enemy or non-`ROBOTIC` target.**
  `PLAY_CARD_TARGETING_CARD_ON_FIELD` checks only `findVehicle`, never
  ownership, so the effect itself must validate own-side **and** `ROBOTIC` or
  either Factory can be played onto an enemy hull.
- ⚑ **E-6 — Duel is in this wave.** `KNOWN_GAPS` ends at 0. Sequenced last, so
  every other card is proven before the battle loop is touched.
- **E-7 — Duel's aggressor is the Duel player.** It decides `isDefender` for
  every DP2 trigger in that battle.
- **E-8 — Duel activates neither zone.** A forced battle is not a zone
  activation; Eclipse alone passes `activatesZone`, per its own card text.
- **E-9 — a cross-zone battle records `lostBattleOnTurn` per side in that side's
  own participant's zone.** For a single-zone battle this is identical to
  today's behaviour, so it is a strict generalisation rather than a change, and
  Task 16 asserts that equivalence.
- **Both Swarms are `summonOnly: true`**, matching Flying Squirrel (DWG),
  Parapet (OW) and Martyr (WF). That excludes them from decks, from
  `drawFromPool`'s catalog pools, and from `discardCard` — so a destroyed Swarm
  can never leak into a deck through `reshuffleDiscard`. `catalogCard` and
  `summonHulls` still find them, which is how Martyr already works.
- ⚑ **L-1 — no existing card changes behaviour. Only the 26 new TG cards do.**
  The four `[TG] …` rows in `LH-Built-in.js` keep their exact current costs,
  keywords, card text and vehicle types — in particular **none of them gains
  `UPKEEP_REQUIRED`**; all ten upkeep cards come from `TG-built-in.js`. The one
  edit they receive is `meta: { lhRoboticsPool: true }`, a descriptive tag with
  **no gameplay effect**, whose sole purpose is to keep LH's five pool-reading
  cards behaving exactly as they do today. It is placed on the four rather than
  as an exclusion key on the 26 because it is fail-closed: a future TG card
  joins LH's pool only if someone deliberately marks it. Task 4 pins every
  field of all four, per card, so "unchanged" is a test rather than an
  intention.
- **TG Anguish is permanently `EXEMPT`** — *"it must deploy first before the
  opponent"* is player-conduct guidance for the From The Depths spawn sheet. The
  engine has no deployment-order concept and there is nothing to fire. Same
  judgement as SS Falcon Squadron, for the same reason.

### Consequence accepted rather than fixed

One, not two. The handoff's upkeep-versus-income warning is withdrawn under U-8
above rather than accepted — it compared a card against a turn it cannot be on
the board for. What remains is recorded here and repeated in the close-out.

- **`[TG] Fear` (600k) and `Fear` (800k) are both draftable in a TG deck** once
  TG is a deck faction. `summonOnly` on the four `[TG] …` cards is the only
  lever, and it is unavailable: it would also remove them from `drawFromPool`'s
  catalog pools and from `roboticAssemblersEffect`'s own filter, emptying the LH
  pool this wave exists to preserve. Different names mint different uuids, so
  there is no collision — but `catalogCard(ctx, name)` matches the **bare** name,
  so anything looking up `'Fear'` finds the 800k TG ship and never the borrowed
  one. Nothing does today. Check before adding something that does.

---

## 2. File structure

| File | Change |
|---|---|
| `shared/gameSettings.ts` | `DECK_FACTIONS` gains `'TG'`; `KEYWORDS.UPKEEP_REQUIRED`; `UPKEEP_RATE`; `VENGEFUL_BASE_DAMAGE` |
| `shared/gameSettings.test.ts` | the exact-array pin gains `'TG'` |
| `shared/engine/gameEngine.ts` | `endTurn` upkeep deduction; `discardSnapshotOf`'s strip list gains `factoryEscort` |
| `shared/engine/battleTriggers.ts` | `returnToHand` (beside `reviveEntry`); DP8's resolve-bystander pass; the Factory escort pass in `dispatchBattleLock`; `lockRoster` board-wide fallback |
| `shared/engine/battleResolve.ts` | `participantsOf` board-wide fallback; the destruction branch removes from the hull's own zone; `lostBattleOnTurn` recorded per side's own zone |
| `shared/engine/battleDeclare.ts` | `declareForcedBattle` gains an opt-in `crossZone` flag |
| `shared/engine/placement.ts` | `deployRequiresAiVehicle` predicate in `legalZonesFor` |
| `shared/effects/registry.ts` | `resolveBystander` flag + `RESOLVE_BYSTANDER_EFFECTS`; `DATA_EFFECT_KEYS` gains `deployRequiresAiVehicle` |
| `shared/effects/primitives.ts` | `PoolFilter.metaFlag`; `friendlyVehicleOptions` |
| `shared/effects/lhEffects.ts` | both TG filters read the marker |
| `shared/effects/tgEffects.ts` | **new** — every TG registry name |
| `shared/engine/index.ts` | side-effect import of `tgEffects.ts` |
| `supabase/functions/shared-manifest.json` | `effects/tgEffects.ts` under `game-action` |
| `supabase/seed/source/builtInCards/TG-built-in.js` | **new** — the 26, with three corrections |
| `supabase/seed/source/builtInCards/LH-Built-in.js` | four cards gain `meta: { lhRoboticsPool: true }` |
| `supabase/seed/seed_data.sql` | regenerated by `npm run seed:build` |
| `supabase/seed/effectCoverage.test.ts` | `KNOWN_GAPS` 0 → 13 → 0; `EXEMPT` gains TG Anguish |
| `supabase/seed/tgFaction.test.ts` | **new** — seed-backed pins for all 26 cards and every data key |
| `frontend/src/lib/keywords.ts` | `KEYWORD_INFO` entry for Upkeep Required; the Submarine entry's base-damage wording (E-3) |
| `scripts/smoke-wave7.mjs` | **new** — a TG scenario on `scripts/smoke-lib.mjs` |

`tgEffects.ts` is a **new `shared/` file**, so it needs *both* the side-effect
import in `shared/engine/index.ts` and the `shared-manifest.json` entry. A file
in one and not the other is a card that works in every test and 400s in
production.

---

## 3. Tasks

### Task 1 — record the rulings in the spec

**Files:** modify `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`.

- [ ] Add an **"Added in wave 7"** block to §7.3 carrying every ruling in §1
      above, in the prose style waves 3–6 used. D-1 must say explicitly that it
      *reaffirms* §7.3's first ruling and *overturns* the handoff's
      recommendation, with the Garrison evidence.
- [ ] Add a **DP8** row to §4.3's dispatch-point table and a "DP8 as wave 7
      built it" subsection: resolve phase, every battle, any zone,
      non-participants only, opt-in via `resolveBystander`.
- [ ] Amend §4.4 to record that a battle summon may now be raised by a per-hull
      rider (the Factories) as well as by a participant trigger.
- [ ] Amend §4.6 to record A-1/A-2 — Acceptance is the suppressing arm of B-9.
- [ ] Amend §7.1 to list Havoc Swarm and Mirth Swarm as summon-only.
- [ ] Commit: `docs(spec): wave 7 rulings — DP8, upkeep, and 20 §7.3 entries`

*No test cycle: this task changes no code. It gates every task after it.*

---

### Task 2 — `DECK_FACTIONS` gains TG

**Files:** modify `shared/gameSettings.ts:53`, `shared/gameSettings.test.ts:11`.

**Interfaces produced:** `DECK_FACTIONS` includes `'TG'`.

⚠ The handoff says *"`DECK_FACTIONS` is what `validateDeck` reads"*. **It does
not** — `validateDeck` never references it (it compares `card.faction !==
deck.faction`). The only functional reader in the repo is
`frontend/src/pages/DecksPage.tsx`, which maps it into the builder's faction
`<select>`. So this line is a *UI* gate, not a validation gate, and the live
deck-builder pass in Task 19 is the only end-to-end check of it.

- [ ] Update the exact-array assertion in `gameSettings.test.ts` to
      `['DWG', 'GT', 'LH', 'OW', 'SS', 'TG', 'WF']`. Run
      `npx vitest run shared/gameSettings.test.ts` — expect FAIL.
- [ ] Add `'TG'` to `DECK_FACTIONS`, in alphabetical position.
- [ ] Run again — expect PASS. Confirm the "deck factions are real factions"
      case still passes (`FACTIONS.TG` already exists).
- [ ] `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 3 — `UPKEEP_REQUIRED`: the keyword, the `endTurn` rule, the glossary

**Files:** modify `shared/gameSettings.ts`, `shared/engine/gameEngine.ts`,
`frontend/src/lib/keywords.ts`; tests in `shared/engine/gameEngine.test.ts`.

**Interfaces produced:** `KEYWORDS.UPKEEP_REQUIRED === 'upkeepRequired'`;
`UPKEEP_RATE === 0.15`; upkeep charged in `endTurn`.

⚠ The handoff says a missing `KEYWORD_INFO` entry *"would ship unnoticed"*. **It
would not** — `frontend/src/lib/keywords.test.ts`'s first case iterates
`Object.values(KEYWORDS)` and fails for any keyword with no glossary entry. That
test runs in the root suite. Expect it to go red the moment the keyword is added,
and treat that as the schedule, not a surprise.

- [ ] Write the failing tests in `gameEngine.test.ts`, all driven through
      `applyAction({ type: 'END_TURN' })` rather than by calling `endTurn`:
      - **U-0/U-4:** an incoming side controlling one 70k `UPKEEP_REQUIRED` hull
        starts its turn with `floor(turnNumber) × 75k − 10_500`.
      - **U-4, all zones:** three such hulls in three different zones are all
        charged; a hull belonging to the *other* side is not.
      - **U-4, captured:** a hull carrying `meta.ownerSide` of the enemy is paid
        for by its **controller**.
      - **U-1, the ruling's only witness:** a `t_`-fixture hull carrying **both**
        `UPKEEP_REQUIRED` and `HALF_COST` at `materialCost: 200_000` is charged
        **15,000**, not 30,000. This is the assertion that separates
        `effectiveMaterialCostOf` from printed cost; no real card can.
      - **U-2:** a fixture at `materialCost: 70_001` is charged `10_501`
        (`Math.ceil`), not `10_500`.
      - **U-3:** upkeep exceeding the turn's income leaves `materials` at
        exactly `0`, never negative.
      - **U-5:** a hull deployed during side A's turn is not charged at the end
        of that turn (side B pays then), and *is* charged at the end of B's turn.
      - **U-6:** a fixture carrying both `TEMPORARY` and `UPKEEP_REQUIRED` is
        culled and charged **nothing**.
      - **U-7:** exactly one upkeep log line per turn, carrying the total.
      - A battle summon in `activeBattle.summons` is never charged.
- [ ] Run `npx vitest run shared/engine/gameEngine.test.ts` — expect FAIL.
- [ ] Add `UPKEEP_REQUIRED: 'upkeepRequired'` to `KEYWORDS` and
      `UPKEEP_RATE = 0.15` to `gameSettings.ts`, with a comment carrying U-1's
      reason and the "never `effectiveCostInGame`" prohibition.
- [ ] Implement the deduction in `endTurn`, immediately after the
      `resources[side].materials = Math.floor(turnNumber) * materialsPerTurnOf(...)`
      line and before `drawCard`. Sum over every zone's `cards[side]`, clamp with
      `Math.max(0, …)`, push one log line when the total is non-zero.
- [ ] Run — expect PASS.
- [ ] Run `npx vitest run frontend/src/lib/keywords.test.ts` — expect FAIL on
      the missing glossary entry.
- [ ] Add the `KEYWORD_INFO` entry: label "Upkeep Required", an existing icon
      (`hourglass` is taken by Temporary — reuse `spark` or add one), description
      naming the 15% and the fact that it is charged at *your* turn start off the
      card's Half-Cost-adjusted cost.
- [ ] Run — expect PASS.
- [ ] `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 4 — narrow the LH `[TG] Robotics` pool, **before** anything is seeded

**Files:** modify `shared/effects/primitives.ts`, `shared/effects/lhEffects.ts`,
`supabase/seed/source/builtInCards/LH-Built-in.js`; new
`supabase/seed/tgFaction.test.ts`; tests in `shared/effects/factionEffects.test.ts`.

**Interfaces produced:** `PoolFilter.metaFlag?: string`; the marker
`meta.lhRoboticsPool === true`.

⚠ **This task must land before Task 5.** The LH pool is
`where is_built_in = true and faction = 'TG'` — a query, not a card list — so
seeding TG takes it from 4 to 30 with **no diff to any LH file at all**. Marker
first means the pool is never wide, not even for one commit.

⚠ **Two filters, not one.** `lhEffects.ts:13` (`tgRobotics`, shared by Ampere,
Candela, Quadrupole and Spectrum) **and** `lhEffects.ts:61`
(`roboticAssemblersEffect`'s own inline `c.faction === 'TG'`). A fix applied only
to the first leaves Robotic Assemblers offering all 28 non-summon-only rows.

- [ ] Write the failing tests:
      - In `factionEffects.test.ts`: with a catalog holding the four marked cards
        **plus** an unmarked `faction: 'TG'` card, `ampereOnPlay` can only ever
        draw a marked one, and `roboticAssemblersEffect`'s options are exactly
        the four marked names.
      - In the new `supabase/seed/tgFaction.test.ts`: the seeded pool
        (`isBuiltIn && meta.lhRoboticsPool === true`) has **exactly four**
        members, named `[TG] Amusement`, `[TG] Fear`, `[TG] Hysteria`,
        `[TG] Obsession` — and the marker's **value** is `true`, not merely
        present (blind spot 4). Pin the membership count as well as the names:
        wave 6's Harbringer note is the precedent — a small pool means a filter
        typo would otherwise be invisible.
      - ⚠ **The no-change pin, in `tgFaction.test.ts`.** Owner ruling L-1: the
        four `[TG] …` rows keep their current behaviour exactly, and the marker
        is the *only* edit they receive. Spell out and assert, per card,
        `materialCost`, `blueprintCost`, `vehicleType`, `type`, `cardText` and
        `keywords` as a set — `[TG] Amusement` 400k/400k ship
        `[robotic, mobile]`; `[TG] Fear` 600k/614k ship `[robotic]`;
        `[TG] Hysteria` 410k/414k ship `[robotic]`; `[TG] Obsession` 330k/337k
        ship `[robotic]`; all four `cardText: ''`. Assert separately that **none
        of the four carries `UPKEEP_REQUIRED`**, and that each one's `meta` has
        `lhRoboticsPool` as its only key. Spelled out rather than derived: a
        test that recomputes its expectation from the source it is checking
        proves nothing (`balancePass.test.ts`'s own rule).
- [ ] Run — expect FAIL.
- [ ] Add `metaFlag?: string` to `PoolFilter` and a `meta[f.metaFlag] === true`
      test to `matches()`.
- [ ] Change `tgRobotics` to `filter: { metaFlag: 'lhRoboticsPool' }` — drop the
      `faction` filter, so the marker is the whole rule.
- [ ] Change `roboticAssemblersEffect`'s inline filter to
      `c.meta.lhRoboticsPool === true && c.meta.summonOnly !== true`.
- [ ] Add `meta: { lhRoboticsPool: true }` to the four `[TG] …` cards in
      `LH-Built-in.js` — **the marker and nothing else.** Their keywords, costs,
      card text, vehicle type and names are untouched (ruling L-1). ✅ Confirm
      each has `cardText: ''`, so G2 never inspects them and the marker needs no
      `DATA_EFFECT_KEYS` entry — verify rather than assume.
- [ ] Confirm by diff that `LH-Built-in.js`'s only changed lines are the four
      `meta` blocks, and that no other seed source file outside
      `TG-built-in.js` is touched by this wave at all.
- [ ] Run — expect PASS.
- [ ] `npm run seed:build`; grep the SQL for `lhRoboticsPool` and confirm four
      hits. `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 5 — seed the faction

**Files:** create `supabase/seed/source/builtInCards/TG-built-in.js`; modify
`supabase/seed/effectCoverage.test.ts`, `supabase/seed/tgFaction.test.ts`.

**Interfaces produced:** 26 seeded `faction: 'TG'` rows; `KNOWN_GAPS` at 13.

The supplied file is at `C:/Users/JFinn/Downloads/TG-built-in.js`. Copy it in
verbatim, then apply exactly these edits. **All of them must land before the
first `seed:build`** — `transform.ts` derives each row's uuid from
`card:TG:<name>`, so renaming after a seed mints a new id, orphans every deck
holding the old one, and leaves the stale row in the database.

- [ ] Three owner-confirmed corrections: `Extasy` → **`Ecstasy`**; Havoc Swarm
      `materialCost: 1200000` → **`120000`** (its blueprint cost was already
      120k); `havocEffect` → **`havocFactoryEffect`** (its sibling is already
      `mirthFactoryEffect`, and `havocEffect` is generic enough to be the next
      Kraken/Paddlegun collision).
- [ ] `summonOnly: true` in the `meta` of **Havoc Swarm** and **Mirth Swarm**.
- [ ] ✅ Leave every blueprint-under-material figure alone — Anguish (260k/202k),
      Curiosity (80k/46k), Obelisk (40k/32k), both Factories (…/0), Duel (0/0)
      are intentional buffs. `blueprintCost` is display-only for built-ins
      (`CardDetailsModal.tsx:130`) and drives nothing mechanical.
- [ ] Write the seed-backed pins in `tgFaction.test.ts`, in the style of
      `balancePass.test.ts` — spelled out, never derived from the source being
      checked:
      - all **26** names present, and the count is exactly 26;
      - `materialCost`, `blueprintCost`, `vehicleType`, `type` and `keywords`
        (as a set) for every one of the 26;
      - the type split: **8 airship, 8 ship, 4 plane, 3 sub, 3 ability**;
      - exactly **ten** cards carry `UPKEEP_REQUIRED`, and their per-turn charges
        are 10,500 / 13,500 / 34,500 / 39,000 / 49,500 / 49,500 / 58,500 /
        87,000 / 109,500 / 120,000;
      - **no** TG card carries both `UPKEEP_REQUIRED` and `HALF_COST` — the fact
        that makes U-1 unobservable, asserted so it fails loudly if a later card
        changes it;
      - `Ecstasy` exists and `Extasy` does not;
      - both Swarms carry `summonOnly: true`;
      - the four `[TG] …` LH rows are **not** in this set (different names,
        different uuids).
- [ ] Add `'TG:Anguish'` to `EXEMPT` with the reason
      *"Conduct text for the spawn sheet: the engine has no deployment-order
      concept"*, alongside SS Falcon Squadron.
- [ ] Add **13** `wave 7` entries to `KNOWN_GAPS` — Jealousy, Curiosity,
      Acceptance, Horror, Nostalgia, Alarmed, Duel, Fear, Hysteria, Vengeful,
      Havoc Factory, Mirth Factory, Obelisk — each naming the mechanic it needs.
      Change `toHaveLength(0)` to `toHaveLength(13)` in the same commit, and
      rename that test's title so it no longer claims everything is complete.
- [ ] `npm run seed:build`; grep the SQL for `Ecstasy`, `Havoc Swarm`,
      `havocFactoryEffect` and `summonOnly`; confirm `1200000` appears nowhere.
- [ ] `npx vitest run` — **all green.** 26 rows exist, ten cards have a working
      keyword, LH is provably unchanged, and the whole faction is draftable.
      This is the checkpoint the handoff's §6 step 1 describes.
- [ ] Commit.

---

### Task 6 — Group B: Curiosity and Acceptance (pure data keys, no registry name)

**Files:** modify `supabase/seed/source/builtInCards/TG-built-in.js`,
`supabase/seed/tgFaction.test.ts`, `supabase/seed/effectCoverage.test.ts`; tests
in `shared/engine/placement.test.ts`.

**Interfaces produced:** `Curiosity.meta.additionalSpawns === 1`;
`Acceptance.meta.resourceSurge === { materialsAtLeast: 150000, extraSpawns: 1 }`.

Both close under G2 through `DATA_EFFECT_KEYS`, exactly as Buzzsaw and Veles do
with no registry name at all.

- [ ] Write the failing tests:
      - **seed-backed values** in `tgFaction.test.ts`: `additionalSpawns` is
        exactly `1`; the surge object equals that literal, key for key. Presence
        is not enough (blind spot 4).
      - **behaviour**, in `placement.test.ts`, driven through
        `applyAction('PLAY_CARD_TO_ZONE')` with the real seeded meta: playing
        Curiosity lands **two** hulls in the target zone for one payment;
        playing Acceptance with `materials === 150_000` pays **150,000**
        (Half-Cost suppressed) and lands **two** hulls, while at `149_999` it
        pays **75,000** and lands one.
      - **A-1**, the ruling most likely to be wrong: the surged Acceptance's
        board entry still carries `HALF_COST` in `keywords`, and
        `effectiveMaterialCostOf` on it is still `75_000`.
- [ ] Run — expect FAIL.
- [ ] Author both `meta` blocks. Nothing else: `deployVehicle` is the only
      reader of `additionalSpawns`, and the copies it mints never pass back
      through it, so an inherited `additionalSpawns` on a copy never fires again
      — there is no infinite loop and no guard to look for.
- [ ] ✅ Confirm the surge is read **before** `pay()` at both play handlers.
      Acceptance's threshold equals its own printed cost, which is the exact
      case that ordering exists for (Chrysaor).
- [ ] Run — expect PASS. Delete both `KNOWN_GAPS` entries; `toHaveLength(11)`.
- [ ] `npm run seed:build`; `npx vitest run`; commit.

---

### Task 7 — Group C: Jealousy

**Files:** create `shared/effects/tgEffects.ts`; modify
`shared/engine/index.ts`, `supabase/functions/shared-manifest.json`,
`TG-built-in.js`, `effectCoverage.test.ts`; tests in `factionEffects.test.ts`.

**Interfaces produced:** registry name `jealousyOnDeath`; the module
`tgEffects.ts` and both of its registrations.

- [ ] Write the failing test: a destroyed Jealousy draws its owner one card, and
      `state.counts[actor].hand` matches `privates[actor].hand.length` after.
      `basherOnDeath` is the verbatim precedent.
- [ ] Run — expect FAIL.
- [ ] Create `tgEffects.ts` and register `jealousyOnDeath` as `grant({ draw: 1 })`.
- [ ] Add the side-effect import to `shared/engine/index.ts` **and**
      `effects/tgEffects.ts` to `shared-manifest.json` under `game-action`. Both,
      or the card works in every test and 400s in production.
- [ ] Seed `onDeathEffect: 'jealousyOnDeath'`.
- [ ] ✅ Confirm Jealousy prints `BLOCKER` and nothing else — a built-in must
      never carry both `SCRAPPY` and an `onDeathEffect`, because a Scrappy hull
      auto-repairs in the 80–89.999% band with no prompt and the trigger becomes
      silently unreachable.
- [ ] Run — expect PASS. Delete `'TG:Jealousy'`; `toHaveLength(10)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 8 — Group C: Fear

**Files:** modify `shared/effects/tgEffects.ts`, `TG-built-in.js`,
`effectCoverage.test.ts`; tests in `factionEffects.test.ts`.

**Interfaces produced:** registry name `fearOnPlay`.

- [ ] Write the failing tests, driven through `applyAction('PLAY_CARD_TO_ZONE')`:
      (a) playing Fear puts one Horror in **each** of the three zones on the
      actor's side; (b) each spawned Horror carries its own printed
      `meta.onBattleEffect` — spawning is not playing (§7.4), and that rule skips
      `onPlayEffect` and **nothing else**, so each Horror keeps its own copy
      trigger (wave 6's Nothung/Sacrilego ruling again, and almost certainly
      intended: Fear names Horror rather than a vanilla hull for a reason);
      (c) `CATALOG_EFFECTS.has('fearOnPlay')` is true.
- [ ] Run — expect FAIL.
- [ ] Register `fearOnPlay` as
      `spawnVehicles({ cardName: 'Horror', count: 1, zones: 'all' })` with
      `{ needsCatalog: true }` — `sapphireScreenEffect`'s shape.
- [ ] Run — expect PASS. Delete `'TG:Fear'`; `toHaveLength(9)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 9 — Group C: Obelisk

**Files:** modify `shared/effects/tgEffects.ts`, `TG-built-in.js`,
`effectCoverage.test.ts`; tests in `factionEffects.test.ts`.

**Interfaces produced:** registry name `obeliskBattle`.

- [ ] Write the failing tests: (a) an Obelisk in a battle at **lock** adds one
      Mirth Swarm to `activeBattle.summons` **and** to its own side's id list;
      (b) it fires on a **defensive** battle as well as an offensive one, and on
      a **forced** one (§7.3's Catshark ruling); (c) it fires **once**, at lock
      only — a resolve-phase dispatch of the same key adds nothing; (d) the Swarm
      never reaches `zone.cards`; (e) `CATALOG_EFFECTS.has('obeliskBattle')`.
- [ ] Run — expect FAIL.
- [ ] Register `obeliskBattle`: guard `battle.phase === 'lock'` (Harbringer is
      the worked example — DP2 fires the same key at resolve),
      `summonHulls(game, ctx, 'Mirth Swarm', 1)` + `joinBattle(side, id, entry)`,
      `{ needsCatalog: true }`. No `zoneEffects` entry and no bystander flag:
      Obelisk is a participant, and DP2's lock pass already reaches participants
      on both sides.
- [ ] ✅ Mirth Swarm already prints `TEMPORARY`, so the word in Obelisk's card
      text is decorative and the grant would be idempotent — do not stamp it.
- [ ] ⚠ Note for Task 19: Obelisk is `STEALTHY`, so an `ATTACK_ENEMY_FLEET`
      naming it raises the response window instead of locking, and DP2's whole
      dispatch happens on `RESPOND_TO_ATTACK`.
- [ ] Run — expect PASS. Delete `'TG:Obelisk'`; `toHaveLength(8)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 10 — Group C: Hysteria

**Files:** modify `shared/effects/tgEffects.ts`, `TG-built-in.js`,
`effectCoverage.test.ts`; tests in `factionEffects.test.ts`.

**Interfaces produced:** registry name `hysteriaOnPlay`.

⚠ **This is not a straight `grantKeywords` composition, and composing it will
silently no-op.** `grantKeywords` reads `payload.targetInstanceId`, which is
**not set** on a `RESOLVE_PENDING_EFFECT` re-entry.

- [ ] Write the failing tests: (a) playing Hysteria suspends with
      `pendingEffect.options` listing every enemy vehicle on the **whole board**;
      (b) resolving with one of them adds `INOFFENSIVE` to that hull's
      `keywords`, idempotently; (c) **"you may"** — with no enemy vehicle
      anywhere, the play resolves without suspending and without failing;
      (d) a resolution naming a hull that **left the board** while the dialog sat
      open fails cleanly rather than throwing; (e) the effect ignores
      `resolution.targetInstanceId` entirely.
- [ ] Run — expect FAIL.
- [ ] Implement a bespoke `choice` over `enemyVehicleOptions(game, actor, null)`.
      Stash the chosen id in `data` at first entry and re-check it against
      `enemyVehicleOptions(...).some(o => o.id === choiceId)` on resolve; use
      `findVehicle` to apply the grant. **Never** read
      `resolution.targetInstanceId`, which is client-supplied and unvalidated.
      Air Strafe (`ssEffects.ts`, `AIR_STRAFE`) is the worked example. Handle
      `choiceId === null` — `choice()` calls `resolve(payload, null)` when the
      options are empty.
- [ ] Run — expect PASS. Delete `'TG:Hysteria'`; `toHaveLength(7)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 11 — Group D: Alarmed

**Files:** modify `shared/effects/primitives.ts`, `shared/engine/placement.ts`,
`shared/effects/registry.ts`, `shared/effects/tgEffects.ts`, `TG-built-in.js`,
`tgFaction.test.ts`, `effectCoverage.test.ts`; tests in `placement.test.ts` and
`factionEffects.test.ts`.

**Interfaces produced:** `friendlyVehicleOptions(game, actor, zoneId, filter?)`
in `primitives.ts` (the sibling of `enemyVehicleOptions`, same
`ChoiceOption[]` return); the data key `deployRequiresAiVehicle: true`; registry
name `alarmedOnPlay`.

- [ ] Write the failing tests:
      - **Clause 1**, in `placement.test.ts`: `legalZonesFor` returns only zones
        where the actor controls at least one `isBuiltIn` vehicle (**D-1**); a
        zone holding only the actor's *custom* vehicles is excluded; a zone
        holding only *enemy* built-ins is excluded; with no qualifying zone the
        list is empty and `PLAY_CARD_TO_ZONE` 400s.
      - **The value pin**, in `tgFaction.test.ts`: Alarmed's
        `meta.deployRequiresAiVehicle === true`.
      - **Clause 2**, in `factionEffects.test.ts`: playing Alarmed suspends with
        options listing the actor's own vehicles in that zone; resolving
        sacrifices the chosen hull, which reaches `state.destroyed` under its
        **owner** (`sacrificeEntry` routes through `discardCard`, so a captured
        hull still goes home and a `summonOnly` one never reaches a discard).
      - ⚠ **Alarmed itself is excluded from its own options** — the card's most
        likely bug. `PLAY_CARD_TO_ZONE` places the hull **before** effects fire,
        so Alarmed is already in `zone.cards[actor]` when the effect runs. Assert
        it is absent, and use `zoneOccupants(p, 'own')`, which already honours
        `placedInstanceIds`, rather than a raw zone read. A Curiosity-style
        `additionalSpawns` copy must be excluded the same way.
      - **D-2:** the sacrificed hull's `onDeathEffect` does **not** fire. Use a
        `t_`-prefixed stand-in that would be observable if it did.
- [ ] Run — expect FAIL.
- [ ] Add `friendlyVehicleOptions` to `primitives.ts`, beside
      `enemyVehicleOptions`, with a comment noting own-board vehicles are already
      public so surfacing them as `pendingEffect.options` leaks nothing.
- [ ] Add a `deployRequiresAiVehicle` predicate to `legalZonesFor`, beside
      `battleLossMissing`. It **narrows** the legal set rather than removing
      zones from it — Purifier's own comment draws that distinction. Read off
      seeded `data`, so the next card wanting the rule needs no engine edit.
- [ ] Add `'deployRequiresAiVehicle'` to `DATA_EFFECT_KEYS`.
- [ ] Register `alarmedOnPlay` as a `choice` over `friendlyVehicleOptions`
      scoped to `targetZoneId`, resolving with
      `sacrificeEntry(game, actor, instanceId, zoneId)`.
- [ ] Seed both keys on Alarmed.
- [ ] Run — expect PASS. Delete `'TG:Alarmed'`; `toHaveLength(6)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 12 — Group D: Horror

**Files:** modify `shared/effects/tgEffects.ts`, `TG-built-in.js`,
`effectCoverage.test.ts`; tests in `factionEffects.test.ts`.

**Interfaces produced:** registry name `horrorBattle`.

⚠ The card's own text reads *"create **anther** copy"*. `cardText` is data —
reproduce the typo verbatim rather than silently correcting it, and say in the
close-out that it was a deliberate choice.

- [ ] Write the failing tests: (a) a Horror that **survives** a battle
      (`phase === 'resolve' && battle.survived`) gains one copy in its own zone;
      (b) a Horror that **died** gains nothing; (c) **D-4** — a second battle in
      the same zone on the same turn spawns nothing more, and the next turn
      spawns again; (d) **D-3** — a Horror in another zone spawns nothing;
      (e) the copy carries any keywords **granted** to the surviving entry, not
      merely the printed ones; (f) the copy's meta passes through `copyMeta`, so
      a captured Horror's copy does **not** carry `ownerSide`; (g) the copy's
      `playedOnTurn` is the current turn (which is what D-4 reads back).
- [ ] Run — expect FAIL.
- [ ] Register `horrorBattle`: guard the resolve phase and `battle.survived`,
      locate the hull with `findVehicle`, refuse if any Horror in that zone
      already has `playedOnTurn === game.turnNumber`, then **copy the surviving
      entry** (`clydesdaleEffect` and `loggerheadOnDeath` are the precedents)
      with a fresh `instanceId`, `copyMeta(entry.meta)` and reset turn stamps.
- [ ] ✅ Copying the entry means **no `{ needsCatalog: true }`** and no
      `fireRider` trap: this is a participant trigger, not a `zoneEffects` rider.
      Assert `CATALOG_EFFECTS.has('horrorBattle') === false` so the claim is
      checked rather than commented.
- [ ] Run — expect PASS. Delete `'TG:Horror'`; `toHaveLength(5)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 13 — Group E: Nostalgia (a replacement effect)

**Files:** modify `shared/engine/battleTriggers.ts`,
`shared/effects/tgEffects.ts`, `TG-built-in.js`, `effectCoverage.test.ts`; tests
in `battleTriggers.test.ts` and `factionEffects.test.ts`.

**Interfaces produced:** `returnToHand(game, side, entry)` in
`battleTriggers.ts`, beside `reviveEntry`; registry name `nostalgiaOnDeath`.

`DECIDE_BATTLE_REPORT`'s resolution loop removes from `zone.cards`, calls
`discardCard`, pushes to `destroyedEntries` — and only **afterwards** runs
`fireDeathEffect`. Nothing in the engine can say "instead of". Route **(a)**, an
`onDeathEffect` that undoes the discard, is chosen over a real pre-destruction
hook: every piece already exists (`discardIndexOf` / `sameSnapshot` were written
for `reviveEntry`), and route (b) would touch the single most load-bearing loop
in the engine, on which a dozen cards already depend.

- [ ] Write the failing tests: (a) a Nostalgia destroyed in a battle ends up in
      its **controller's** hand with a fresh `instanceId`, and *not* in
      `state.destroyed`; (b) `state.counts[actor].hand` is resynced — a direct
      push must do it manually (checklist item 5); (c) the returned card carries
      **no** per-entry stamps (it is rebuilt from the discard snapshot, which
      already has them stripped); (d) a **captured** Nostalgia keeps its
      `meta.ownerSide`, so it still goes home when it later leaves play;
      (e) **E-1** — a Nostalgia removed by Alarmed's sacrifice is **not** saved,
      because `sacrificeEntry` fires no death effect.
- [ ] Write the tests that pin the three **divergences** from a true replacement
      effect, so they are recorded rather than discovered: the death is still
      logged; it still counts toward `destroyedCount`; and — the load-bearing
      one — it **still counts as a loss for `battleOutcome`**, because
      `survivingIds` was computed before any trigger ran. So a lone Nostalgia
      losing a battle still hands the enemy the win and still writes
      `zone.lostBattleOnTurn`, which WF Purifier reads.
- [ ] Run — expect FAIL.
- [ ] Implement `returnToHand`: `discardIndexOf` to find the snapshot under
      `ownerSideOf(entry, side)`, splice it out of `state.destroyed`, push it
      into `game.privates[side].hand` with `ctx.newId()`, resync
      `state.counts[side]`. Return `false` without mutating anything when the
      snapshot is not there, matching `reviveEntry`'s contract.
- [ ] Register `nostalgiaOnDeath` and seed `onDeathEffect: 'nostalgiaOnDeath'`.
- [ ] ✅ Confirm Nostalgia is not `SCRAPPY` — checklist item 10 exists for
      exactly this shape. Its owner still *chooses* whether to pay the 80–90%
      repair; repairing means it survives and no trigger fires, which is correct.
- [ ] Run — expect PASS. Delete `'TG:Nostalgia'`; `toHaveLength(4)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 14 — Group E: Vengeful (DP8)

**Files:** modify `shared/gameSettings.ts`, `shared/effects/registry.ts`,
`shared/engine/battleTriggers.ts`, `shared/effects/tgEffects.ts`,
`frontend/src/lib/keywords.ts`, `TG-built-in.js`, `effectCoverage.test.ts`; tests
in `battleTriggers.test.ts`, `factionEffects.test.ts`, `keywords.test.ts`.

**Interfaces produced:** `VENGEFUL_BASE_DAMAGE = 40_000`;
`registerEffect(..., { resolveBystander: true })` and `RESOLVE_BYSTANDER_EFFECTS`;
registry name `vengefulBattle`.

*"Any zone" means a battle Vengeful is not in* — and the existing bystander pass
does not cover it. `BYSTANDER_EFFECTS` (Terawatt) is dispatched only at **lock**,
only on a **forced** battle, only for the **defending** side, and only in the
**battle's own zone**. Vengeful needs the **resolve** phase (a loss is not known
until then), **every** battle, from **any** zone. That is a new dispatch point.

⚠ **The opt-in flag is load-bearing, not bookkeeping**, for precisely the reason
DP7's is: `dwgWatersEffect`'s router falls through to its claim branch on any
context it does not recognise, so a broadcast would make it attempt a claim with
no target zone on every battle in the game.

- [ ] Write the failing tests:
      - **the dispatch:** a Vengeful in zone 2 fires on a battle resolved in
        zone 1; a hull whose `onBattleEffect` is registered *without* the flag is
        **not** dispatched to; a Vengeful that **is** a participant is reached by
        the participant pass and **not** a second time by the bystander pass.
      - **the zone:** the damage lands on the enemy base in **Vengeful's own**
        zone, not the battle's. Locate the hull with
        `findVehicle(card.instanceId)`, the way Braveheart re-derives its own
        zone from `payload.card` rather than stashing it.
      - **E-2:** two casualties on the actor's side deal **80k**, one deals 40k,
        zero deals nothing.
      - **E-2b:** a Vengeful destroyed in that same battle fires nothing —
        `participants` still holds its entry, so `dispatchBattleResolve` *does*
        reach it, and only the `findVehicle` guard stops it.
      - **E-3:** it fires despite Vengeful being a `sub`.
      - **E-4:** it fires despite an enemy `BLOCKER` in its zone.
      - **the arithmetic:** 40k converts through `BASE_DAMAGE_DIVISOR` to **40
        HP** of a default 1000.
      - **the two must-nots:** `zone.lastActivatedTurn` is untouched (a
        card-forced consequence is not a zone activation), and `checkVictory` is
        called when a base reaches 0.
- [ ] Run — expect FAIL.
- [ ] Add `VENGEFUL_BASE_DAMAGE = 40_000` to `gameSettings.ts` — **its own
      constant**, not a reuse of `ONGOING_ATTRITION_DAMAGE_PER_VEHICLE`, which
      is equal by coincidence (the `AMBUSH_DISTANCE_M` precedent).
- [ ] Add the `resolveBystander` flag and `RESOLVE_BYSTANDER_EFFECTS` to
      `registry.ts`, mirroring `BYSTANDER_EFFECTS` and `DEPLOY_WATCHER_EFFECTS`
      exactly.
- [ ] Add DP8's pass to `dispatchBattleResolve`: after the participant loop, over
      every zone's hulls on both sides that are **not** in `participants` and
      whose `onBattleEffect` is in `RESOLVE_BYSTANDER_EFFECTS`. Snapshot the list
      before dispatching, as the lock pass does.
- [ ] Register `vengefulBattle` and seed `onBattleEffect: 'vengefulBattle'`.
- [ ] **E-3's glossary half:** change `VEHICLE_TYPE_INFO[SUB]`'s description from
      *"can never damage an enemy base"* to bombardment-scoped wording, so no
      printed rule contradicts a shipped card. Assert the new wording in
      `keywords.test.ts`.
- [ ] Run — expect PASS. Delete `'TG:Vengeful'`; `toHaveLength(3)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 15 — Group E: Havoc Factory and Mirth Factory (a rider on a hull)

**Files:** modify `shared/engine/gameEngine.ts`,
`shared/engine/battleTriggers.ts`, `shared/effects/tgEffects.ts`,
`TG-built-in.js`, `effectCoverage.test.ts`; tests in `battleTriggers.test.ts`
and `factionEffects.test.ts`.

**Interfaces produced:** the per-entry stamp `meta.factoryEscort: string` (a
catalog card name); registry names `havocFactoryEffect` and `mirthFactoryEffect`.

`state.zoneEffects` is per-**zone**. This is per-**hull**, which is new.

**This departs from the handoff's recommendation, deliberately.** The handoff
proposes stamping `entry.meta.onBattleEffect = 'havocFactoryBattle'` onto the
target. That works, but it costs three things: a `DELIBERATE_ORPHANS` entry (no
seeded card ever names a runtime-written name), a refusal branch for a target
that already carries `onBattleEffect` (Obelisk does), and a strip-list problem
with no clean answer — `onBattleEffect` cannot be added to `discardSnapshotOf`'s
strip list, because Obelisk and Horror carry it as *printed* meta that must
survive.

A distinct key avoids all three. `factoryEscort` is a per-entry stamp exactly
like `costDelta`, which is already named in that strip list for the same reason.

- [ ] Write the failing tests:
      - **the stamp:** playing Havoc Factory on a friendly `ROBOTIC` hull sets
        `entry.meta.factoryEscort === 'Havoc Swarm'`; Mirth Factory sets
        `'Mirth Swarm'`.
      - **E-5:** playing either onto an **enemy** hull returns false → 400
        *"check its target"*; onto a friendly **non-`ROBOTIC`** hull likewise.
        `PLAY_CARD_TARGETING_CARD_ON_FIELD` checks only `findVehicle`, never
        ownership.
      - **the escort:** when that hull enters a battle at lock, one Swarm of the
        named card joins `activeBattle.summons` **and** that hull's own side's id
        list; it fires on offensive, defensive and forced battles; it does
        **not** fire again at resolve.
      - **coexistence:** an Obelisk carrying both its printed `onBattleEffect`
        and a `factoryEscort` produces **both** summons — the collision the
        handoff's design would have had to refuse.
      - ⚠ **the strip list, the bug most likely to be missed:** a Factory'd hull
        that dies has **no** `factoryEscort` in its `state.destroyed` snapshot,
        so it does not return permanently upgraded through `reshuffleDiscard`.
      - ⚠ **the copy paths:** a Horror copy (Task 12) and a Curiosity
        `additionalSpawns` extra do **not** inherit `factoryEscort`.
      - `CATALOG_EFFECTS` membership for both names — the escort pass mints from
        the catalog.
- [ ] Run — expect FAIL.
- [ ] Add `factoryEscort` to `discardSnapshotOf`'s strip list, in the same
      unconditional position as `costDelta`, with a comment saying why.
- [ ] Add the escort pass to `dispatchBattleLock`, over the **snapshotted**
      participant roster, after the participant trigger pass: for each entry
      carrying a string `meta.factoryEscort`, `summonHulls` one of that card and
      `joinBattle(side, id, entry)`.
- [ ] Register `havocFactoryEffect` and `mirthFactoryEffect` as
      `playOnVehicleEffect` handlers that validate own-side + `ROBOTIC` and write
      the stamp, both `{ needsCatalog: true }`.
- [ ] Strip `factoryEscort` in Task 12's Horror copy path.
- [ ] ✅ G3 needs no new row — `onBattleEffect` is already in
      `REACHABLE_TRIGGERS`' `vehicle` list, and `factoryEscort` is never seeded
      so G3 never sees it. Verify rather than trust: the missing-row trap bit
      waves 2, 3 and 4.
- [ ] ✅ G4 needs no `DELIBERATE_ORPHANS` entry — both names are seeded under
      `playOnVehicleEffect`. Confirm the map is still exactly its three names.
- [ ] Run — expect PASS. Delete both entries; `toHaveLength(1)`.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 16 — Group E: Duel (a cross-zone battle)

**Files:** modify `shared/engine/battleDeclare.ts`,
`shared/engine/battleTriggers.ts`, `shared/engine/battleResolve.ts`,
`shared/effects/tgEffects.ts`, `effectCoverage.test.ts`; tests in
`battleDeclare.test.ts`, `battleResolve.test.ts`, `factionEffects.test.ts`.

**Interfaces produced:** `declareForcedBattle` spec gains `crossZone?: boolean`;
registry name `duelEffect`.

Two independent gaps. ✅ `PLAY_ABILITY_CARD` already accepts Duel's shape,
because the card carries no `playOn*` target key and all targeting happens
inside the choice chain — verified against the handler's `needsTarget` check.

**Gap 1 — two targets.** The action vocabulary carries one `targetInstanceId`.
The route is a two-hop `choice` chain, Orbit Flank's shape, which works because
`RESOLVE_PENDING_EFFECT` nulls `pendingEffect` before re-entering. ⚠ Orbit Flank
writes its second `pendingEffect` **by hand**, bypassing `choice()`'s one-slot
check; `card-effects.md` says explicitly to route a new suspension through
`choice()` instead. Do that — build hop 2 as its own `choice()` closure and
invoke it from hop 1's `resolve` with `resolution` cleared.

**Gap 2 — the cross-zone battle.** Four sites assume a battle happens in exactly
one zone. Each becomes a find-by-**id** instead of a find-by-**zone**;
`findVehicle` already does board-wide lookup, so the change is bounded.

⚠ **The tempting shortcut is wrong**: bringing the enemy hull in via
`battle.summons` looks like it fits, but a summon **evaporates on report approval
regardless of HP** (§4.4) — no death, no discard, no `destroyedEntries`. That
makes the enemy hull unkillable, which defeats the entire card.

✅ **No new `PublicGameState` field.** `zoneId` stays the battle's home zone
(the Duel player's own hull's), and the away hull is resolved by id. That is why
trap 6's two-halves rule does not apply to this wave.

- [ ] Write the failing tests **for the four sites first**, each in two forms —
      the cross-zone case, and a single-zone regression asserting today's
      behaviour is byte-identical:
      - `declareForcedBattle`: with `crossZone: true` an away-zone defender id is
        accepted; **without** it, the same declaration is still refused (the
        guard is narrowed to an opt-in, not removed — the `activatesZone`
        precedent, which Eclipse alone passes).
      - `lockRoster`: the away hull's DP2 lock triggers fire.
      - `participantsOf`: the away hull appears in the report roster, rather than
        falling through to the summon map and being **silently dropped**.
      - the destruction branch: a destroyed away hull is removed from **its own**
        zone — the failure mode here is a destroyed hull that stays on the board.
      - **E-9:** `lostBattleOnTurn` is recorded for each side in **that side's
        own** participant's zone; for a single-zone battle this is identical to
        what it records today.
- [ ] Run — expect FAIL.
- [ ] Implement the four site changes plus `crossZone`.
- [ ] Run — expect PASS, with the whole existing battle suite green. **This is
      the riskiest commit in the wave**; do not proceed until
      `npx vitest run shared/engine` is fully green.
- [ ] Write the failing tests for the card: (a) hop 1 offers the actor's own
      vehicles board-wide via `friendlyVehicleOptions(game, actor, null)`; (b)
      hop 2 offers `enemyVehicleOptions(game, actor, null)`; (c) the battle locks
      with exactly those two ids; (d) **E-7** — the aggressor is the Duel player,
      so `isDefender` is correct for every DP2 trigger in that battle; (e)
      **E-8** — `lastActivatedTurn` is untouched in **both** zones; (f) the hop-1
      pick is read back from `pending.data`, never from
      `resolution.targetInstanceId`; (g) a hop-1 pick that left the board before
      hop 2 resolves fails cleanly; (h) with no enemy vehicle anywhere, the card
      fizzles without failing.
- [ ] Run — expect FAIL. Implement `duelEffect`; run — expect PASS.
- [ ] Delete `'TG:Duel'`; **`toHaveLength(0)`**; restore that test's title to
      claim completeness, now naming wave 7 among the closed labels.
- [ ] `npm run seed:build`; `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 17 — the late re-read

**Files:** none necessarily; whatever the re-read finds.

This single pass is what caught Ongoing Attrition firing on forced battles in
wave 5, and nothing else would have.

- [ ] Read all 26 `cardText` values in
      `supabase/seed/source/builtInCards/TG-built-in.js` again, one at a time,
      **against the built implementation** rather than against this plan.
- [ ] For each, write one line in the close-out saying which clause of the text
      each implemented behaviour serves, and name any clause nothing serves.
- [ ] Re-check the four `[TG] …` LH rows and the five LH cards that read the
      pool: Ampere, Quadrupole, Candela, Spectrum, Robotic Assemblers.
- [ ] Fix whatever this finds, TDD, and commit separately so the finding is
      visible in the history.

---

### Task 18 — mutation testing

**Files:** none.

- [ ] **Prove the harness can fail for the right reason first.** Wave 6 got a
      perfect 62/62 that was entirely false — every mutation was killed by a
      drift test that fails for *any* `shared/` edit, hiding 16 real gaps.
      Mutate one line by hand, run `npx vitest list` over the scope, and confirm
      **which** test catches it.
- [ ] Run `scripts/mutation-harness.mjs` scoped at **all** of `shared/` — never
      one file, which reports false survivors.
- [ ] Treat every survivor as a finding. Fix or write down why not.
- [ ] ⚠ After any `git checkout --` on a `shared/` file, re-run
      `npm run functions:sync` — `core.autocrlf` makes the drift test fail on a
      tree `git diff` calls clean. This bites mutation testing hardest.

---

### Task 19 — live verification

**Files:** create `scripts/smoke-wave7.mjs`.

⚠ The kickoff says to *"pull `signIn` / `buildDeck` / `startGame` / `step` into
`scripts/smoke-lib.mjs` first"*. **That work is already done** — wave 6 did the
extraction in `805a301` (PR #26), and `smoke-lib.mjs:385` exports `keep`, `die`,
`step`, `results`, `api`, `rest`, `fn`, `signIn`, `builtIns`, `buildDeck`,
`startGame`, `cleanUp` and `report`. Write the scenario against it; extract
nothing.

Three things the harness already knows that a fresh one would have to relearn:
`ATTACK_ENEMY_FLEET` does not always lock the battle (a Stealthy or omissible
defender raises the response window instead, and the lock — with it DP2's whole
dispatch — happens on `RESPOND_TO_ATTACK`); staging spans turns, because income
is *set* to `floor(turnNumber) × 75k` rather than accumulated; and
`read_console_messages` returns a cumulative buffer that survives reloads, so any
frontend check needs a **fresh tab**.

- [ ] Deploy: merge to `main` deploys `game-action` automatically. For an
      out-of-band deploy use `npm run functions:deploy -- game-action`, **never**
      the `deploy_edge_function` MCP tool (a truncated deploy **deletes every
      file it omits**), and verify the version incremented **by content**, not by
      file count — type-only imports are erased during transpilation, so a
      correct deploy legitimately reads back with fewer modules.
- [ ] ⚠ **Apply the seed by hand.** Merging to `main` deploys functions and
      **never** reseeds card data. `supabase/seed/seed_data.sql` is a manual
      `execute_sql`. For a whole new faction that is the difference between 26
      cards and none — wave 6's close-out §6.1 records a precedent for it being
      forgotten.
- [ ] **Query production before and after**, and record both: `select count(*)
      from cards where is_built_in and faction = 'TG'` should read **4** before
      and **30** after; `... and meta->>'lhRoboticsPool' = 'true'` should read
      **4** both times. That second query is the LH regression check, and it is
      the only one that would catch a pool that widened with no diff.
- [ ] Write `scripts/smoke-wave7.mjs` covering, at minimum: upkeep charged at a
      turn start and visible in `resources`; Fear spawning three Horrors; a
      Horror surviving a battle and copying itself; Alarmed refused from a zone
      with no built-in hull and accepted into one that has it; Obelisk's Swarm
      joining through `RESPOND_TO_ATTACK`; Vengeful damaging a base from another
      zone; a Factory'd hull's escort; Nostalgia returning to hand; and Duel's
      two-hop chain across two zones.
- [ ] ⚠ **A live test whose result depends on the shuffle is not a test yet.**
      Wave 6 lost two of three harness bugs to exactly that. Use
      `spec.materialsPerTurn`, `waitForMaterials` and `spendInto` to put the
      player on a chosen side of a threshold rather than hoping the ramp lands
      there, and make every card the run needs `required` rather than hoped for.
- [ ] **The one check no unit test can make:** open the real deck builder and
      build a TG deck. If `DECK_FACTIONS` is wrong, that is where it shows —
      `DecksPage.tsx` is its only functional reader (Task 2).
- [ ] Record the pass count.

---

### Task 20 — close-out

**Files:** create
`docs/superpowers/plans/2026-08-31-tg-faction-wave-7-closeout.md`; modify
`docs/claude/card-effects.md`, `docs/claude/architecture.md`,
`docs/claude/testing.md`.

- [ ] Fold the durable lessons into `docs/claude/*`: DP8 and the
      `resolveBystander` flag into `architecture.md`'s dispatch-point list; the
      `factoryEscort` per-entry-stamp pattern and its strip-list obligation into
      `card-effects.md`; `smoke-lib.mjs`'s export list into `testing.md` so the
      next wave does not re-extract it.
- [ ] Write the close-out on the wave-6 model, answering **card by card** which
      of the 26 are built, which rulings reality contradicted, and what is left
      unverified — **including its correction section**, which is the part most
      worth imitating.
- [ ] Record `KNOWN_GAPS` at 0, the before→after passing count, and the live
      run's score.
- [ ] Commit; open the PR against `main`.

---

## 4. Verification gates

Run at every commit:

```bash
npx vitest run
```

Run before the PR:

```bash
npx tsc -p tsconfig.json --noEmit
```

```bash
npm --prefix frontend run build
```

```bash
npm --prefix frontend run lint
```

Count the lint warnings rather than copying a number out of a document.

---

## 5. What this wave deliberately does NOT do

Each of these looks like work and is not. **Verify each claim before relying on
it** — the missing-`REACHABLE_TRIGGERS`-row trap bit waves 2, 3 and 4.

- **No new trigger key, and so no `REACHABLE_TRIGGERS` row.** Every card here
  uses a key the engine already dispatches for its type. DP8 reuses
  `onBattleEffect`; the Factories' stamp is `factoryEscort`, which is not a
  trigger key at all.
- **No hero power.** SS, WF and GT are all deck factions with none, and spec §10
  has them out of scope throughout.
- **No card art, and no asset upload.** `imageUrl` is a bare filename for *every*
  built-in card in the game, and `frontend/src/lib/cards.ts:24` uses the value
  only when it starts `http` or `blob:`. `jealousy.png` behaves exactly like
  every existing built-in.
- **No Fragile audit for TG's airships.** The glossary says airships are always
  Fragile, but no built-in airship in *any* faction prints it and nothing
  enforces it for built-ins (`customCards.ts:19` is custom-cards-only). TG's
  eight match every other faction's. Pre-existing; not this wave's to reopen.
- **No new catalog-probe source** — the existing four still cover these cards.
- **No `HandBar.tsx` `ALL_TRIGGER_KEYS` change** — this wave adds no key to
  `TRIGGERS`. The duplication remains an open backlog item.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **The LH pool widens silently.** No diff to any LH file causes it, and five cards in another faction start behaving differently | Task 4 lands **before** Task 5; the marker's value and the pool's membership at exactly four are both pinned; Task 19 queries production before and after |
| **Task 16 regresses the battle loop** every other card depends on | `crossZone` is opt-in, so every existing caller keeps its guard; each of the four sites gets a single-zone regression test asserting byte-identical behaviour; Task 18's mutation run is scoped over all of `shared/` |
| **A Factory stamp rides into a deck** through a strip list TypeScript will not check | A distinct key (`factoryEscort`) rather than `onBattleEffect`, named in `discardSnapshotOf`'s strip list, with a test asserting the destroyed snapshot is clean |
| **The seed is deployed but never applied** | Task 19 makes the manual `execute_sql` a checklist item with a before/after row count |
| **A card is renamed after the first seed**, orphaning decks | All three corrections land in Task 5, before the first `seed:build` |

---

## 7. Where the handoff drifted

Verified against the code at `9691fd0` and against the supplied seed source.
Six findings. The fifth changes a ruling; the sixth withdraws a balance warning
the handoff asked to be escalated to the owner.

1. **§2.2 — "eight of the ten upkeep cards carry [`ROBOTIC`]".** It is **nine**.
   Joy is the only `UPKEEP_REQUIRED` card without it.
2. **Kickoff, "Verification" — `smoke-lib.mjs` "exports nothing and runs its own
   scenarios on import".** It exports thirteen names at `smoke-lib.mjs:385`,
   including all four the kickoff asks for. Wave 6 did the extraction in
   `805a301`; its own close-out §6 says so. **Do not re-extract it.**
3. **§2.1 — "`DECK_FACTIONS` is what `validateDeck` reads".** `validateDeck`
   never references `DECK_FACTIONS`; it compares `card.faction !== deck.faction`.
   The only functional reader in the repo is `frontend/src/pages/DecksPage.tsx`.
   The conclusion (add `'TG'`) is unchanged; the *reason* is not, and it moves
   the end-to-end check from the engine suite to the live deck-builder pass.
4. **§2.2 — a missing `KEYWORD_INFO` entry "would ship unnoticed".** It would
   not. `frontend/src/lib/keywords.test.ts`'s first case iterates
   `Object.values(KEYWORDS)` and fails for any keyword with no glossary entry,
   and that file runs in the root suite. This is the one drift in the wave's
   favour.
5. **§3 Group D and §7's ruling D-1 — "The engine has no AI concept".** It has
   had one since wave 1. **Spec §7.3's first ruling** reads *"'AI' means
   `isBuiltIn === true`"*; `OW:Garrison` prints the identical phrase *"Target an
   AI vehicle in hand"*; and `owEffects.ts:138`, `ssEffects.ts:86/127` and
   `wfEffects.ts:169` all implement it. The handoff's recommendation
   (`ROBOTIC`) would give one printed phrase two meanings, which spec decision 1
   forbids. **Ruling D-1 is `isBuiltIn`.**
6. **§2.2 — "Fear plus its three Horrors is 151.5k, more than a full turn's
   income at turn 2", flagged as needing the owner's decision.** Both numbers
   are right and the comparison is not: income is **set** to
   `floor(turnNumber) × materialsPerTurn`, so an 800k card is unplayable until
   **turn 11**, where income is 825k. Measured where Fear can actually be, its
   upkeep is 14.5% of that turn's income — the same ratio Horror pays at turn 1.
   The rate is scale-invariant by construction (U-8). Withdrawn rather than
   escalated: there was no decision to make.

Everything else in the handoff checked out against the code, including several
things worth confirming rather than assuming: the 26-card count and its
8/8/4/3 + 3 type split; all ten upkeep cards and their exact charges; the LH
pool's four members and their 435k mean; the post-seed mean of ~293k; the
Temporary-cull-before-income ordering in `endTurn`; the fact that
`PLAY_CARD_TO_ZONE` places the hull before effects fire; `baseStrikersIn`'s sub
exclusion; and `gameSettings.ts:53`.
