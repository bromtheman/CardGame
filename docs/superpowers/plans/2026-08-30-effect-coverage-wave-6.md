# Effect coverage wave 6 — the twelve balance-pass cards

> **For agentic workers:** implement task-by-task, TDD, one commit per task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close all twelve `KNOWN_GAPS` entries labelled `balance 2026-08-30`,
emptying the map for the first time since the balance pass opened it.

**Architecture:** four cards are one-liners over existing primitives; four are
small extensions to `resourceSurge`, `ACTIVATE_VEHICLE` and `costModifier`;
four need new machinery — a placement rule read off seeded data, a new
per-zone `PublicGameState` field, and **DP7**, a zone rider that fires when the
*opponent* deploys into the zone.

**Tech stack:** TypeScript (strict) in `shared/`, Vitest, React 19 frontend,
Supabase edge functions (Deno) fed by `npm run functions:sync`.

**Specs:**
- `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — binding for
  the *machinery* (DP1–DP7, suspension rules, battle summons, the `zoneEffects`
  rider contract). Its card list is finished; wave 6's cards are not in it.
- `supabase/seed/effectCoverage.test.ts`'s `KNOWN_GAPS` — **the authority on
  the backlog.** Where this plan and that map disagree, the map wins.
- `docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-handoff.md` — the
  briefing. §7 below records where it drifted.

---

## Global constraints

Copied verbatim from `CLAUDE.md` and `docs/claude/card-effects.md`. Every task
inherits them.

- **TDD, no exceptions.** Failing engine test first, then implement, then
  `npx vitest run` and report the **before→after passing count**.
- **Never pass `--root` to vitest** — it silently runs 0 tests.
- **Every commit touching `shared/` runs `npm run functions:sync`** and
  includes its output. `supabase/seed/functionSharedSync.test.ts` fails
  otherwise.
- **Every commit touching a card's `meta` runs `npm run seed:build`.**
  `seedDataSync.test.ts` catches a stale SQL only if the suite is run.
- **Relative imports inside `shared/` need the `.ts` extension.**
- **Key effects by a unique registry id, never by a card's name.** A reused
  name rebinds another card's behaviour mid-game (Kraken/Paddlegun, spec §9.2).
- **`state.log` must never name a card in a hidden hand.**
- **A `state.zoneEffects` rider needs `{ needsCatalog: true }`** even when it
  reads no catalog — `fireRider` mints the payload card from `ctx.catalog`.
  Unit tests cannot see a missing flag; assert `CATALOG_EFFECTS` membership.
- **A data key's VALUE is never checked by the guard, only its presence.**
  Every new data key needs a seed-backed assertion in `balancePass.test.ts`.
- **A new `PublicGameState` field needs both halves**: a `normalizeState`
  default *and* an initial value in `buildInitialGame`.
- **Delete a `KNOWN_GAPS` entry and decrement its `toHaveLength` literal in the
  same commit that makes its card work.**
- **Never use a real seeded effect name as a test stand-in** — use a `t_` prefix.
- After `git checkout --` on a `shared/` file, **re-run `functions:sync`**;
  `core.autocrlf` makes the drift test fail on a tree `git diff` calls clean.

**Baseline, measured on this branch at `356735c`** (not copied from the
handoff): `npx vitest run` → **780 passed / 33 files, 0 failed**. This matches
the handoff's prediction.

---

## 1. The rulings

Settled before any code, per the kickoff. **Task 1 writes all of these into the
spec's §7.3** before anything else is built.

### Group A

**A-1. Nothung's spawned Sacrilego keeps its own battle trigger.** Spawning is
not playing (§7.4), and that rule skips `onPlayEffect` and nothing else. A
spawned hull carries its printed meta, and Sacrilego prints
`onBattleEffect: sacrilegoBattle`, so it *will* fire at lock and at resolve.
Intended — it is why the card names Sacrilego rather than a vanilla hull.

**A-2. Balmung's "reduce its cost to zero" is a price, not a rewrite.**
`costDelta: -230000` (Hydra's printed `materialCost`), never a minted
`materialCost: 0`. `costDelta` never reaches `effectiveMaterialCostOf`, so the
free Hydra still deals its printed base damage and still costs its printed
repair — which is what "reduce its **cost**" says. `loggerheadOnDeath` mints at
zero and is **not** the precedent: its copy goes into a *deck*, where nothing
but the price ever reads that number.

**A-3. Balmung's log line does not name the Hydra.** The card's own public text
already reveals it, so naming it leaks nothing new — but `state.log` is
governed by an absolute rule and `drawFromPool` sets the precedent ("adds a
card to their hand"). Generic line.

**A-4. Harbringer reads to every battle it fights.** "Whenever this ship is in
fleet combat" — offensive, defensive, and **forced** (§7.3's Catshark ruling:
"a battle it is a participant in is a battle whatever declared it"). Guard on
`phase === 'lock'` and `isParticipant`, with **no** `isDefender` check.

**A-5. Harbringer is a participant, not a rider.** It needs no `zoneEffects`
entry and no rider dispatch — DP2's lock roster already reaches participants on
both sides. It *does* need `{ needsCatalog: true }`, because it reads
`ctx.catalog` for its own pool.

**A-6. Harbringer's pool is `<= 100k`, inclusive, on printed `materialCost`,
WF ships only.** Measured at `356735c` the pool is exactly **two** cards —
Buzzsaw (80k) and Earth Raker (50k) — so the empty-pool path is unreachable
today and a filter typo would be invisible. `The Repentance` is a WF **plane**
at exactly 100k and is excluded by the type filter, which makes the type filter
load-bearing rather than decorative. Pin the membership.

### Group B

**B-1. Judgement's discount reads the whole board; its duel reads one zone.**
"While your opponent **has** a submarine or airship" names no zone; the second
sentence says "in this zone" explicitly. The contrast inside one card is the
evidence. So `judgementCostModifier` scans every zone on the enemy's side, and
`judgementActivate` scopes to the hull's own zone.

**B-2. Judgement needs `activateCpCost: 1` seeded.** Its text says "pay 1cp",
and `ACTIVATE_VEHICLE` refuses a card without the key. Without it the card has
no activated ability and no board button at all.

**B-3. An activation price is charged flat.** `activateMaterialCost` is not
run through `effectiveCostInGame`: Half-Cost and `costModifier` are *play*-time
purchase mechanics (§4.5, §4.6), and activating is not playing (DP1).

**B-4. Victoria's chain is per-hull, per-turn, and bounded by materials.**
Spawning is not playing, so the spawned Victoria carries its printed
`onActivate` + `activateMaterialCost`, and DP1 imposes no freshly-deployed
restriction — so it may be activated the same turn it appears. Each activation
costs a further 200k against income that is *set* to `floor(turnNumber) × 75k`,
so the chain is hard-bounded by the turn's budget. This is **not** Trebuchet's
unbounded-chain problem (§7.3, corrected after wave 4): there the repeat was
free and a Dryad replaced its own casualty; here every link is paid for. No cap
is invented, because the card prints none and the material cost already is one.

**B-5. Victoria re-derives its own zone; it never trusts `action.zoneId`.**
`ACTIVATE_VEHICLE` passes the client-supplied `zoneId` straight through as
`targetZoneId`. Braveheart is the precedent: find the hull with
`findVehicle(card.instanceId)` and use *its* zone.

**B-6. Chrysaor's surge raises the play price only.** "Costs 100k more" is a
purchase-price mechanic like every other, so `effectiveMaterialCostOf` is
untouched and base damage, repairs and in-battle resources still read 100k.
Consistent with §4.5 and §4.6.

**B-7. Paladin lands with BOTH keywords on the hull — a departure from §4.6.**
§4.6 rules a surge "pricing only — hulls keep their printed keywords". Paladin
prints "this can be played with halfcost and temporary", and `temporary` is
unambiguously a hull property (the cull reads it off the board). The LH hero
power **`flyby`** is the direct in-codebase precedent for that exact pair: it
stamps `halfCost` + `temporary` onto a card in hand, so both travel onto the
deployed hull. Splitting the pair — pricing with `halfCost` but stamping only
`temporary` — would be a rule with no precedent and no text behind it.
Consequence to accept openly: a surged Paladin deals `floor(120000/1000) = 120`
base damage rather than 240, and repairs at half price. **§4.6 is amended.**

**B-8. Paladin's surge is automatic, not offered.** "**Can** be played with"
describes the legality the condition unlocks, not a per-play election. An offer
would freeze the game on every Paladin, and declining is strictly worse for the
chooser alone — the same test §7.3 applies to Ambush and to DWG Waters' clause 3.

**B-9. A surge with no `grantKeywords` of its own is a Half-Cost
*suppression*; one with `grantKeywords` adds them.** One rule, two arms. This
preserves PredatorX and Orbit byte-for-byte (neither carries `grantKeywords`,
so both still lose Half-Cost) while giving Paladin the inverse, with no seed
change to either older card.

**B-10. Every surge field is read BEFORE `pay()`.** Both play handlers already
capture `const surged = halfCostSuppressed(...)` ahead of payment, because
paying moves the materials the condition reads. Chrysaor is the card that would
expose a regression here: its surged price is 200k against a `> 200k`
condition, so a post-payment re-read flips its own condition off.

### Group C

**C-1. Albacore and Tarpon restrict THEIR OWN CONTROLLER.** The text says
"**you** may not play any other aircraft into this zone". Three reasons to read
the pronoun literally: (a) spec decision 1 makes card text authoritative and
"you" is unambiguous; (b) `AIR_SCREEN` already exists as the enemy-facing
version, so seeding a second key that did the same thing would be redundant;
(c) both cards are `FRAGILE`, which is drawback-shaped, not weapon-shaped.
**The alternative reading is recorded and rejected**: if playtesting shows
these were meant as enemy lockouts, the change is one predicate — the rule is
read off `data`, not off an effect name.

**C-2. "Aircraft" is `plane` + `airship`** — exactly the pair `screenBlocks`
already treats as air. Reuse the same predicate rather than a second one.

**C-3. "Any OTHER aircraft" falls out for free.** `legalZonesFor` prices a card
in *hand* against a zone that already holds the locking hull, so the hull can
never block itself. A **second** Albacore into the same zone *is* blocked, and
so is a Tarpon into an Albacore's zone — which is what "any other" says.

**C-4. The lock reaches plays and nothing else.** `additionalSpawns` copies,
`resourceSurge` extras, summons and `MOVE_VEHICLE` / Rapid Redeployment all
bypass placement legality (§7.4, and `riderBlocks`'s own comment). The card
says "play". Sub Killer's block is the precedent and takes the same latitude.

**C-5. Purifier's "the previous turn" means the last full round, current turn
included** — `lostBattleOnTurn >= turnNumber - 1`. The turn counter moves in
half steps, so the strictly-previous half-turn is the *opponent's*, and reading
it that way would mean only a **defensive** loss ever qualified — an arbitrary
restriction the text does not print. The fiction is "your wreckage is still
floating there", and wreckage from an attack you lost on your own last turn
counts as much as wreckage from a defence. §7.3's wave-5 ruling already
establishes that "the turn" in card text is read from the actor's own frame,
and the actor's previous turn began at `turnNumber - 1`. A loss on the current
turn is fresher still, so the window includes it.

**C-6. Any battle resolved through `DECIDE_BATTLE_REPORT` counts as a lost
fleet battle** — forced ones included, either role. §7.3's Catshark ruling
("a battle it is a participant in is a battle whatever declared it") and its
Recurring Threat ruling ("defensive fleet battle is any battle its claimant
defends, forced or declared") both point the same way. A **bombardment** is not
a battle and records nothing (§7.3's Ambush ruling: "a bombardment is not a
battle fought"). A **draw** records nothing for either side.

**C-7. Purifier's "no damage to the enemy base" is a `baseStrikersIn`
exclusion, not `INOFFENSIVE`.** `INOFFENSIVE` also means "cannot attack a
fleet", which Purifier can. Excluding it from `baseStrikersIn` also excludes it
from `dispatchBaseAttackVictory` — correct, because a hull that dealt no damage
did not "inflict damage to the enemy base" for Plunderer's purposes. A zone
holding only Purifiers bombards for 0, which `ATTACK_ENEMY_BASE` already
refuses with "No vehicles able to strike".

**C-8. The blockader is the aggressor.** Every forced battle in the codebase
names the effect's owner as aggressor — Braveheart, Martyr Attack, Gang Up,
Air Strafe, Orbit Flank, Eclipse. DWG Waters' clause 3 is the sole inversion,
and it inverts for a reason that does not apply here: there the enemy's own
action *was already an attack* (a bombardment) being intercepted, so the
aggression pre-existed. Deploying a vehicle is not an attack. Consequence,
recorded because it is not cosmetic: the deploying player becomes the
**defender** of a battle on their own turn, and their defensive DP2 triggers
fire. That is the trap the card describes.

**C-9. A Blockade battle is a fleet battle: every eligible hull on both sides
in that zone fights.** The text says *fleet* battle, the trigger condition
frames a force ("while you have at least one vehicle there"), and the removal
condition ("if you lose with no surviving vehicles") only reads correctly if
everything was at risk. The aggressor's side excludes `INOFFENSIVE` hulls —
§7.3's Gang Up ruling: "Inoffensive is precisely *cannot attack*, and a forced
battle is not a licence to break it". The defender's side has no such
exclusion: Inoffensive means it cannot attack, not that it cannot be attacked,
and `ATTACK_ENEMY_FLEET` already lets any hull be targeted.

**C-10. "No surviving vehicles" is read off the post-resolution board.**
`zone.cards[blockader].length === 0` at continuation time. §7.3's Trebuchet
ruling blesses exactly this ("read off the post-resolution state, which needs
no outcome plumbing on the payload"), and it is not wave 4's mistake — that was
re-deriving a win from a roster stashed at *declare* time, which a late joiner
made stale. Reading the current board cannot go stale. It is also the only
route that works: `contextForResolve` gives the continuation `won` for its own
side, which is "the enemy has no survivors" — the opposite of what this clause
asks — and `survived` is meaningless for an ability card that was never a
participant. With C-9 (everything fights), "no vehicles left in the zone" and
"lost with no surviving vehicles" are the same statement.

**C-11. A blockade that does not spring is not spent.** If the blockader has no
vehicle in the zone when the enemy deploys, no battle begins and the rider
stays. The card removes it on a loss and on nothing else.

**C-12. A Blockade battle is not a zone activation.** `declareForcedBattle`
without `activatesZone`, per §4.3's standing ruling; Eclipse remains the sole
exception. The deploying player may still attack or bombard in that zone later
the same turn, with whatever survived.

**C-13. One battle per play, and one battle per zone.** `additionalSpawns` and
surge copies all arrive inside a single `deployVehicle` call, so the dispatch
fires once per *play*, not once per hull. A rider that finds
`state.activeBattle` already set returns without declaring (the
`dispatchZoneInterception` precedent), and a second Blockade claim on a zone
the same side already holds is **refused at play time** (the `ambushClaim`
precedent) so the play is not spent on a no-op.

**C-14. DP7 dispatches only to opted-in effects.** `dispatchDeployWatchers`
fires only riders whose effect registered `{ deployWatcher: true }` — the same
mechanism and the same reasoning as wave 4's `battleBystander` flag ("the pass
dispatches only to members, which is what keeps every other battle trigger out
of it"). This is load-bearing, not tidiness: `dwgWatersEffect`'s router falls
through to `dwgWatersClaim` for any phase it does not recognise, so handing it
an unknown `'deploy'` context would make it try to claim a zone with no
`targetZoneId` and log a spurious failure on every enemy deploy into a zone it
holds. Verified by reading all eight rider/battle-trigger routers at `356735c`.

**C-15. Blockade needs `{ needsCatalog: true }`.** It reads no catalog itself,
but `fireRider` mints its payload card from `ctx.catalog` by `cardName`.
Assert `CATALOG_EFFECTS` membership at runtime — a unit test cannot see it.

**C-16. DP7 introduces no new trigger key**, so `REACHABLE_TRIGGERS` needs no
new row. **Verified, not assumed:** `blockadeEffect` sits under
`playOnZoneEffect` on an `ability` card, and the `ability` row already lists
`playOnZoneEffect`. The trap that bit waves 2, 3 and 4 does not bite this one.

---

## 2. File structure

| File | Change |
|---|---|
| `shared/gameSettings.ts` | 3 constants: `JUDGEMENT_DISCOUNT`, `HARBRINGER_GUEST_MAX_COST`, `PURIFIER_LOSS_WINDOW_TURNS` |
| `shared/engine/gameInit.ts` | `ZoneState.lostBattleOnTurn`; its `buildInitialGame` initial value |
| `shared/engine/gameEngine.ts` | `normalizeState` default for the above |
| `shared/engine/engineTypes.ts` | `BattleContext.phase` gains `'deploy'` |
| `shared/engine/placement.ts` | `ResourceSurge` extended; `resourceSurgeActive`; `surgeCostDeltaFor`; `surgeKeywordsFor`; `aircraftLocked`; `battleLossBlocks`; `legalZonesFor` gains `turnNumber`; `deployVehicle` stamps granted keywords; DP7 call from both play handlers |
| `shared/engine/activate.ts` | `activateMaterialCostOf`; charge materials; the two-key gate becomes "`onActivate` + at least one price" |
| `shared/engine/battleTriggers.ts` | `dispatchDeployWatchers`; `DEPLOY_WATCHER_EFFECTS` consumer |
| `shared/engine/battleResolve.ts` | record `lostBattleOnTurn` at resolve |
| `shared/engine/baseAttack.ts` | `baseStrikersIn` excludes `meta.noBaseDamage` |
| `shared/effects/registry.ts` | `deployWatcher` flag + `DEPLOY_WATCHER_EFFECTS`; `DATA_EFFECT_KEYS` gains 3 keys |
| `shared/effects/wfEffects.ts` | `basherOnDeath`, `harbringerBattle`, `judgementCostModifier`, `judgementActivate` |
| `shared/effects/ssEffects.ts` | `nothungOnPlay`, `balmungOnPlay`, `victoriaActivate`, `blockadeEffect` |
| `supabase/seed/source/builtInCards/{DWG,SS,WF}-built-in.js` | 7 cards' `meta` |
| `supabase/seed/seed_data.sql` | regenerated by `npm run seed:build` |
| `supabase/seed/effectCoverage.test.ts` | `KNOWN_GAPS` 12 → 0, `toHaveLength` with it |
| `supabase/seed/balancePass.test.ts` | seed-backed value assertions for every new data key |
| `frontend/src/pages/game/BoardZone.tsx` | activate gate accepts a material price |
| `frontend/src/pages/game/GameBoardPage.tsx` | `legalZonesFor` ×2 + `turnNumber` prop to HandBar |
| `frontend/src/pages/game/HandBar.tsx` | `legalZonesFor` + new `turnNumber` prop |
| `frontend/src/pages/game/zoneEffectBadges.ts` | Blockade badge |
| `scripts/smoke-wave6.mjs` | wave-5 harness re-pointed |

No new `shared/` **file**, so `shared-manifest.json` and
`shared/engine/index.ts` need no new entry. `npm run functions:sync` is still
mandatory on every commit that touches `shared/`.

---

## 3. Tasks

### Task 1 — record the rulings in the spec

**Files:** modify `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`
(§7.3 "Added in wave 6"; §4.6 for B-7/B-9; §4.3 for DP7 and C-14).

- [ ] Add an "Added in wave 6" block to §7.3 carrying every ruling in §1 above,
      in the same prose style waves 3–5 used.
- [ ] Amend §4.6: record B-7 (a surge may grant hull keywords) and B-9 (the
      two arms), naming Paladin as the card that forced it.
- [ ] Add a DP7 row to §4.3's dispatch-point table and a "DP7 as wave 6 built
      it" subsection covering C-8 … C-16.
- [ ] Commit: `docs(spec): wave 6 rulings — DP7, surge keyword grants, and 16 §7.3 entries`

*No test cycle: this task changes no code. It gates every task after it.*

---

### Task 2 — WF Basher

**Files:** modify `shared/effects/wfEffects.ts`; test in
`shared/effects/factionEffects.test.ts`; modify
`supabase/seed/effectCoverage.test.ts`.

**Interfaces produced:** registry name `basherOnDeath`.

- [ ] Add `'basherOnDeath'` to the `DRAW_ONE` table at the top of
      `factionEffects.test.ts`. Run `npx vitest run shared/effects` — expect
      the two new cases to FAIL with `effectFor('basherOnDeath')` undefined.
- [ ] Register `basherOnDeath` as `grant({ draw: 1 })` in `wfEffects.ts`,
      beside `excruciatorOnPlay`.
- [ ] Confirm Basher prints no `SCRAPPY` (it prints no keywords at all), so the
      Scrappy/`onDeathEffect` prohibition in `card-effects.md` is clear.
- [ ] Delete `'WF:Basher'` from `KNOWN_GAPS`; change `toHaveLength(12)` to `(11)`.
- [ ] `npx vitest run` — all green, count up.
- [ ] `npm run functions:sync`; commit both.

---

### Task 3 — SS Nothung

**Files:** modify `shared/effects/ssEffects.ts`; test in
`factionEffects.test.ts`; modify `effectCoverage.test.ts`.

**Interfaces produced:** registry name `nothungOnPlay`.

- [ ] Write three failing tests: (a) playing Nothung into a zone puts a
      Sacrilego on the board on the actor's side in **that** zone; (b) the
      spawned Sacrilego carries its printed
      `meta.onBattleEffect === 'sacrilegoBattle'` — ruling A-1, asserted rather
      than assumed; (c) `CATALOG_EFFECTS.has('nothungOnPlay')` is true.
      Drive (a) through `applyAction('PLAY_CARD_TO_ZONE')`, not the effect
      directly, so the deploy ordering is real.
- [ ] Run them; expect FAIL.
- [ ] Register `nothungOnPlay` as `spawnVehicles({ cardName: 'Sacrilego',
      count: 1, zones: 'target' })` with `{ needsCatalog: true }`.
- [ ] Run; expect PASS.
- [ ] Delete `'SS:Nothung'` from `KNOWN_GAPS`; `toHaveLength(10)`.
- [ ] `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 4 — SS Balmung

**Files:** modify `shared/effects/ssEffects.ts`; test in
`factionEffects.test.ts`; modify `effectCoverage.test.ts`.

**Interfaces produced:** registry name `balmungOnPlay`.

- [ ] Write five failing tests: (a) a Hydra instance lands in the actor's hand;
      (b) its `meta.costDelta === -230000` and its `materialCost` is still
      `230000` — ruling A-2, and the assertion that would catch a mint-at-zero;
      (c) `effectiveCostInGame` for that instance is `0` while
      `effectiveMaterialCostOf` is still `230000`; (d) `state.counts[actor].hand`
      matches `privates[actor].hand.length` afterwards; (e) the log line does
      not contain the string `Hydra` — ruling A-3.
- [ ] Run; expect FAIL.
- [ ] Implement `balmungOnPlay` in `ssEffects.ts`: `catalogCard(ctx, 'Hydra')`,
      push a `{ ...snapshot, instanceId: ctx.newId(), meta: { ...snapshot.meta,
      costDelta: -snapshot.materialCost } }` into the hand, resync
      `state.counts`, push a generic log line. Return `false` when the catalog
      has no Hydra (a data bug, the `spawnVehicles` contract).
      `{ needsCatalog: true }`.
- [ ] Add `'balmungOnPlay'` to the `CATALOG_EFFECTS` runtime assertion in
      `factionEffects.test.ts`.
- [ ] Run; expect PASS. Delete `'SS:Balmung'`; `toHaveLength(9)`.
- [ ] `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 5 — WF Harbringer

**Files:** modify `shared/gameSettings.ts`, `shared/effects/wfEffects.ts`;
tests in `factionEffects.test.ts` and `supabase/seed/balancePass.test.ts`;
modify `effectCoverage.test.ts`.

**Interfaces produced:** registry name `harbringerBattle`; constant
`HARBRINGER_GUEST_MAX_COST = 100_000`.

- [ ] Write failing tests: (a) at `phase: 'lock'` with `isParticipant: true`
      and `isDefender: **false**`, the offer is written to
      `state.pendingEffect` with both pool names as options; (b) the same with
      `isDefender: true` — ruling A-4, so both must pass; (c) resolving a
      choice pushes a summon into `activeBattle.summons` **and** onto the
      actor's own id list; (d) `phase: 'resolve'` is a no-op; (e)
      `isParticipant: false` is a no-op; (f) a 100_000 card is IN the pool and
      a 100_001 card is out — the inclusive boundary; (g) a WF *plane* at
      100_000 is out; (h) `CATALOG_EFFECTS.has('harbringerBattle')`.
- [ ] Add a `balancePass.test.ts` assertion pinning the pool's real membership
      at `{ Buzzsaw, Earth Raker }` off `loadSeedData()` — ruling A-6, so a
      filter typo is visible rather than silent.
- [ ] Run; expect FAIL.
- [ ] Implement: guard `phase === 'lock' && isParticipant`; build the pool from
      `ctx.catalog` (`isBuiltIn`, faction WF, type vehicle, vehicleType ship,
      `materialCost <= HARBRINGER_GUEST_MAX_COST`, `meta.summonOnly !== true` —
      repeated by hand, because this filters the catalog directly rather than
      through `drawFromPool`); offer via `choice`; on resolve re-derive the
      pool, `summonHulls(..., 1)` then `joinBattle`. `{ needsCatalog: true }`.
- [ ] Run; expect PASS. Delete `'WF:Harbringer'`; `toHaveLength(8)`.
- [ ] `npx vitest run`; `npm run functions:sync`; commit.

---

### Task 6 — WF Judgement

**Files:** modify `shared/gameSettings.ts`, `shared/effects/wfEffects.ts`,
`supabase/seed/source/builtInCards/WF-built-in.js`; tests in
`factionEffects.test.ts` and `balancePass.test.ts`; modify
`effectCoverage.test.ts`.

**Interfaces produced:** registry names `judgementCostModifier`,
`judgementActivate`; constant `JUDGEMENT_DISCOUNT = 100_000`.

- [ ] Write failing tests: (a) `effectiveCostInGame` is `540_000` with an empty
      enemy board; (b) `440_000` with an enemy **sub** in **any** zone —
      including a zone Judgement is not in, ruling B-1; (c) `440_000` with an
      enemy **airship**; (d) still `540_000` when the sub/airship is the
      actor's OWN; (e) the modifier does not stack for two enemy subs;
      (f) `judgementActivate` offers only enemy subs and airships in the
      hull's own zone — an enemy *ship* in the same zone is not offered, and an
      enemy sub in a **different** zone is not offered; (g) resolving declares
      a 1v1 forced battle with `attackerIds: [judgement]`; (h) the zone's
      `lastActivatedTurn` is untouched (a forced battle is not an activation);
      (i) a seed assertion that `WF:Judgement`'s `meta.activateCpCost === 1`.
- [ ] Run; expect FAIL.
- [ ] Seed `activateCpCost: 1` on Judgement; run `npm run seed:build`.
- [ ] Implement `judgementCostModifier` via `registerCostModifier` and
      `judgementActivate` as Braveheart's shape with a
      `vehicleType ∈ {sub, airship}` filter passed to `enemyVehicleOptions`,
      re-deriving the zone via `findVehicle(card.instanceId)`.
- [ ] Run; expect PASS. Delete `'WF:Judgement'`; `toHaveLength(7)`.
- [ ] `npx vitest run`; `npm run functions:sync`; commit seed source, generated
      SQL, shared and function copies together.

---

### Task 7 — SS Victoria and `activateMaterialCost`

**Files:** modify `shared/engine/activate.ts`, `shared/effects/ssEffects.ts`,
`supabase/seed/source/builtInCards/SS-built-in.js`,
`frontend/src/pages/game/BoardZone.tsx`; tests in
`shared/engine/activate.test.ts`, `factionEffects.test.ts`,
`balancePass.test.ts`; modify `effectCoverage.test.ts`.

**Interfaces produced:** `activateMaterialCostOf(card): number | null`
(exported from `activate.ts`, mirroring `activateCpCostOf`); registry name
`victoriaActivate`.

- [ ] Write failing engine tests in `activate.test.ts`: (a) a card with
      `onActivate` + `activateMaterialCost` and **no** `activateCpCost` has a
      working ability; (b) it charges exactly the material price and no CP;
      (c) it is refused with 400 when the actor cannot afford it, **and the
      refusal leaves resources untouched**; (d) a card with `onActivate` and
      neither price still errors "has no activated ability"; (e) a card
      carrying **both** prices is charged both.
- [ ] Write failing tests for `victoriaActivate`: (f) it spawns one Victoria
      into the activating hull's **own** zone even when `action.zoneId` names a
      different one — ruling B-5; (g) the spawned hull carries
      `meta.onActivate` and `meta.activateMaterialCost`, and its
      `activatedOnTurn` is `null` — ruling B-4, asserted rather than assumed;
      (h) `CATALOG_EFFECTS.has('victoriaActivate')`; (i) a seed assertion that
      `SS:Victoria`'s `meta.activateMaterialCost === 200_000`.
- [ ] Run; expect FAIL.
- [ ] Seed `activateMaterialCost: 200000` on Victoria; `npm run seed:build`.
- [ ] Implement `activateMaterialCostOf` and widen `ACTIVATE_VEHICLE`'s gate to
      "a registered `onActivate` **and** at least one valid price". Charge
      materials alongside CP, **after** both affordability checks and **before**
      the effect runs and the turn is stamped — the ordering `activateCpCost`
      already uses.
- [ ] Implement `victoriaActivate` with `{ needsCatalog: true }`:
      `findVehicle(card.instanceId)`, then `spawnInto` a catalog Victoria in
      that zone.
- [ ] Update `BoardZone.tsx`'s `activateEligible` to accept either price — the
      silent-pair trap in a new costume.
- [ ] Run; expect PASS. Delete `'SS:Victoria'`; `toHaveLength(6)`.
- [ ] `npx vitest run`; `npm --prefix frontend run build`;
      `npm run functions:sync`; commit.

---

### Task 8 — the `resourceSurge` extension (Chrysaor and Paladin)

**Files:** modify `shared/engine/placement.ts`,
`supabase/seed/source/builtInCards/SS-built-in.js`; tests in
`shared/engine/placement.test.ts` and `balancePass.test.ts`; modify
`effectCoverage.test.ts`.

**Interfaces produced (all exported from `placement.ts`):**
- `resourceSurgeActive(state, side, card): boolean` — the shared condition
  §4.6 predicted by name. Handles `materialsOver`, `materialsAtLeast` and the
  new `materialsUnder`.
- `halfCostSuppressed(state, side, card): boolean` — **kept**, now expressed as
  `resourceSurgeActive(...) && no grantKeywords`, so every existing caller and
  test keeps its meaning.
- `surgeCostDeltaFor(state, side, card): number`
- `surgeKeywordsFor(state, side, card): string[]` — the keyword array
  `effectiveCostInGame` prices with, and the list `deployVehicle` stamps.

`ResourceSurge` gains `materialsUnder?: number`, `costDelta?: number`,
`grantKeywords?: string[]`.

- [ ] Write failing tests for **Chrysaor**: (a) at 200_000 materials the surge
      is off — price 100_000, one hull; (b) at 200_001 the surge is on — price
      200_000, **two** hulls; (c) `effectiveMaterialCostOf` is still 100_000
      either way (ruling B-6); (d) the played hull's keyword array is unchanged;
      (e) at exactly 200_000 materials the card is affordable and at 200_001 the
      *surged* price is still affordable — the self-flip guard, driven through
      `applyAction` so `pay()`'s real ordering is exercised.
- [ ] Write failing tests for **Paladin**: (f) at 240_000 materials the surge is
      off — price 240_000, hull keywords `[]`; (g) at 239_999 the surge is on —
      price 120_000, and the deployed hull carries **both** `halfCost` and
      `temporary` (ruling B-7); (h) an `additionalSpawns`/surge copy carries the
      granted keywords too; (i) `END_TURN` culls a surged Paladin at the next
      turn start and does **not** cull an unsurged one — the proof that
      `temporary` really landed on the hull rather than only on the price;
      (j) no `pendingEffect` is written (ruling B-8).
- [ ] Write a regression test that **PredatorX and Orbit still lose Half-Cost**
      under their own conditions — ruling B-9's other arm, which must not
      break.
- [ ] Add `balancePass.test.ts` assertions pinning both seeded surge objects
      **by value**, field by field.
- [ ] Run; expect FAIL.
- [ ] Seed Chrysaor's and Paladin's `resourceSurge`; `npm run seed:build`.
- [ ] Implement the four helpers; wire `surgeCostDeltaFor` and
      `surgeKeywordsFor` into `effectiveCostInGame`; have `deployVehicle` merge
      `surgeKeywordsFor`'s grant into the entry **and** every copy,
      idempotently. Both play handlers keep reading the surge before `pay()`
      (ruling B-10) — pass the already-captured `surged` flag down rather than
      re-deriving inside `deployVehicle`.
- [ ] Run; expect PASS. Delete `'SS:Chrysaor'` and `'SS:Paladin'`;
      `toHaveLength(4)`.
- [ ] `npx vitest run`; `npm --prefix frontend run build` (the frontend prices
      through `effectiveCostInGame`); `npm run functions:sync`; commit.

---

### Task 9 — DWG Albacore and Tarpon

**Files:** modify `shared/effects/registry.ts`, `shared/engine/placement.ts`,
`supabase/seed/source/builtInCards/DWG-built-in.js`; tests in
`placement.test.ts` and `balancePass.test.ts`; modify `effectCoverage.test.ts`.

**Interfaces produced:** data key `aircraftLock: true`; predicate
`aircraftLocked(state, side, zoneId, vehicleType): boolean`, private to
`placement.ts` and read inside `legalZonesFor` alongside `screenBlocks` and
`riderBlocks`.

- [ ] Write failing tests: (a) with an own Albacore in zone 1, `legalZonesFor`
      for an own **plane** omits zone 1 and still offers 2 and 3;
      (b) same for an own **airship**, including a second Albacore
      (ruling C-3); (c) an own **ship**/**tank**/**sub** is unaffected;
      (d) an **enemy** Albacore in zone 1 does **not** block the actor's
      aircraft — ruling C-1, the assertion that pins the pronoun; (e)
      `MOVE_VEHICLE` still relocates an own plane into the locked zone —
      ruling C-4; (f) an `additionalSpawns` copy of an aircraft still lands
      there — ruling C-4's other half; (g) `PLAY_CARD_TO_ZONE` returns 400
      "That vehicle cannot deploy to that zone" for a locked play, driven
      through `applyAction`.
- [ ] Add `balancePass.test.ts` assertions that `DWG:Albacore` and `DWG:Tarpon`
      each carry `meta.aircraftLock === true` — blind spot 4.
- [ ] Run; expect FAIL.
- [ ] Seed `aircraftLock: true` on both; `npm run seed:build`.
- [ ] Add `'aircraftLock'` to `DATA_EFFECT_KEYS` so G2 closes both cards with
      no registry name at all.
- [ ] Implement `aircraftLocked`, reading the **actor's own** side of the zone
      and the same air predicate `screenBlocks` uses; add it to
      `legalZonesFor`'s filter.
- [ ] Run; expect PASS. Delete both entries; `toHaveLength(2)`.
- [ ] `npx vitest run`; `npm --prefix frontend run build`;
      `npm run functions:sync`; commit.

---

### Task 10 — WF Purifier

**Files:** modify `shared/gameSettings.ts`, `shared/engine/gameInit.ts`,
`shared/engine/gameEngine.ts`, `shared/engine/placement.ts`,
`shared/engine/battleResolve.ts`, `shared/engine/baseAttack.ts`,
`shared/effects/registry.ts`, `shared/engine/testFixtures.ts`,
`supabase/seed/source/builtInCards/WF-built-in.js`,
`frontend/src/pages/game/{GameBoardPage,HandBar}.tsx`; tests in
`placement.test.ts`, `battleResolve.test.ts`, `baseAttack.test.ts`,
`gameInit.test.ts`, `gameEngine.test.ts`, `balancePass.test.ts`; modify
`effectCoverage.test.ts`.

**Interfaces produced:**
- `ZoneState.lostBattleOnTurn: { a: number | null; b: number | null }` —
  required, so `tsc` finds every zone literal.
- `legalZonesFor(state, side, card, turnNumber: number): number[]` — a
  **required** 4th parameter, for the same reason `activatedOnTurn` is a
  required field: `tsc` finds every call site.
- data keys `deployRequiresBattleLoss: true`, `noBaseDamage: true`.
- constant `PURIFIER_LOSS_WINDOW_TURNS = 1`.

- [ ] Write failing tests for the **record**: (a) after
      `DECIDE_BATTLE_REPORT` approves a report where side `b` has no survivor,
      `zone.lostBattleOnTurn.b === game.turnNumber` and `.a` is still `null`;
      (b) a **draw** (both sides retain a survivor) records nothing for either;
      (c) a **forced** battle records the same way — ruling C-6; (d) an
      `ATTACK_ENEMY_BASE` bombardment records nothing; (e) the record is
      written for the zone the battle was in and no other.
- [ ] Write failing tests for the **normalize pair**: (f) `normalizeState` on a
      zone missing the field defaults it to `{ a: null, b: null }`;
      (g) `buildInitialGame` sets it on every zone. Both halves, always.
- [ ] Write failing tests for the **prerequisite**: (h) `legalZonesFor` for
      Purifier returns `[]` with no recorded loss; (i) it returns exactly the
      zone whose `lostBattleOnTurn[side]` is `turnNumber`; (j) `turnNumber - 1`
      qualifies and `turnNumber - 1.5` does not — the ruling C-5 boundary, both
      sides of it; (k) a loss recorded for the **enemy** in that zone does not
      qualify; (l) biome legality still applies on top (Purifier is a ship, so
      a `land` zone is out even with a loss recorded there).
- [ ] Write failing tests for **no base damage**: (m) `baseDamageFrom` omits a
      Purifier's contribution; (n) a zone holding only a Purifier is refused
      with "No vehicles able to strike"; (o) `dispatchBaseAttackVictory` does
      not fire for it — assert via a `t_`-prefixed probe effect, never a real
      card's name; (p) Purifier can still be an attacker in
      `ATTACK_ENEMY_FLEET` — the whole reason `INOFFENSIVE` was rejected
      (ruling C-7).
- [ ] Add `balancePass.test.ts` assertions that `WF:Purifier` carries
      `meta.deployRequiresBattleLoss === true` and `meta.noBaseDamage === true`.
- [ ] Run; expect FAIL.
- [ ] Seed both keys on Purifier; `npm run seed:build`.
- [ ] Add both keys to `DATA_EFFECT_KEYS`.
- [ ] Implement, in order: the `ZoneState` field + both defaults +
      `testFixtures.makeGame`; the record in `DECIDE_BATTLE_REPORT` (read
      `outcome.wonBy[otherSide(side)]` for each side, using the `battleZoneId`
      local already captured before `activeBattle` is nulled); the
      `baseStrikersIn` exclusion; the `legalZonesFor` signature and predicate.
- [ ] Update all five `legalZonesFor` call sites — 2 in `placement.ts`, 2 in
      `GameBoardPage.tsx`, 1 in `HandBar.tsx` — and thread `turnNumber` into
      `HandBar` as a new prop from `game.turn_number`.
- [ ] Run; expect PASS. Delete `'WF:Purifier'`; `toHaveLength(1)`.
- [ ] `npx vitest run`; `npm --prefix frontend run build`;
      `npm run functions:sync`; commit.

---

### Task 11 — SS Blockade (DP7)

**Files:** modify `shared/engine/engineTypes.ts`,
`shared/effects/registry.ts`, `shared/engine/battleTriggers.ts`,
`shared/engine/placement.ts`, `shared/effects/ssEffects.ts`,
`frontend/src/pages/game/zoneEffectBadges.ts`,
`frontend/src/pages/game/BoardZone.tsx` (icon map); tests in
`shared/engine/battleTriggers.test.ts`, `placement.test.ts`,
`factionEffects.test.ts`, `shared/engine/battleFreeze.test.ts`; modify
`effectCoverage.test.ts`.

**Interfaces produced:**
- `BattleContext.phase` gains `'deploy'`.
- `registerEffect(name, fn, { deployWatcher: true })` and
  `DEPLOY_WATCHER_EFFECTS: ReadonlySet<string>` in `registry.ts`, derived from
  registration exactly as `BYSTANDER_EFFECTS` is.
- `dispatchDeployWatchers(game, ctx, zoneId, actor)` in `battleTriggers.ts` —
  fires riders on that zone whose `side !== actor` **and** whose effect is a
  `DEPLOY_WATCHER_EFFECTS` member, with `phase: 'deploy'`,
  `isDefender: true` (the rider's owner is not the acting player),
  `isParticipant: false`.
- registry name `blockadeEffect`, one name serving four occasions:
  `continuation` → aftermath; `resolution` → unreachable today, but routed for
  symmetry; `battle.phase === 'deploy'` → spring; `battle` any other phase →
  no-op; otherwise → claim.

- [ ] Write failing tests for the **claim**: (a) `PLAY_CARD_TO_ZONE` with
      Blockade writes one permanent `zoneEffects` entry with no
      `expiresOnTurn`; (b) a second claim by the same side on the same zone is
      **refused** (400) and writes nothing — ruling C-13; (c) the opposing side
      may claim the same zone.
- [ ] Write failing tests for the **spring**: (d) the enemy deploying a vehicle
      into the blockaded zone while the blockader has a hull there declares a
      forced battle with `aggressor === blockader` — ruling C-8; (e) every
      eligible hull on both sides is listed, not just the one just played —
      ruling C-9; (f) the just-played hull IS on the deployer's list;
      (g) an `INOFFENSIVE` hull on the **blockader's** side is excluded from
      `attackerIds` and an `INOFFENSIVE` hull on the **deployer's** side is
      still in `defenderIds`; (h) with no blockader hull in the zone, nothing
      is declared and the rider **remains** — ruling C-11; (i) the blockader's
      own deploy into that zone declares nothing; (j) an **ability** played to
      that zone declares nothing (the text says "plays a vehicle");
      (k) `zone.lastActivatedTurn` is untouched — ruling C-12; (l) an
      `additionalSpawns` card that lands three hulls declares exactly **one**
      battle — ruling C-13; (m) the same spring happens through
      `PLAY_CARD_TARGETING_CARD_IN_HAND` (Excalibur's path) — the second seam,
      which is the one a single-handler dispatch would miss.
- [ ] Write failing tests for **re-entrancy and isolation**: (n) the
      `dispatchBattleLock` rider pass that runs inside `declareForcedBattle`
      re-enters `blockadeEffect` with `phase: 'lock'` and it declares nothing
      further; (o) a `dwgWatersEffect` rider on the same zone is **never**
      handed a `'deploy'` context — ruling C-14, asserted by spying on
      `state.log` for DWG Waters' failure line; (p)
      `CATALOG_EFFECTS.has('blockadeEffect')` — ruling C-15.
- [ ] Write failing tests for the **aftermath**: (q) after the battle resolves
      with the blockader holding at least one hull in the zone, the rider
      **remains**; (r) with the blockader's zone emptied, the rider is
      **removed** — ruling C-10; (s) removal takes only that side's Blockade
      rider on that zone, leaving an enemy Blockade and any other rider alone.
- [ ] Confirm `battleFreeze.test.ts` still passes — it asserts coverage over
      `knownActionTypes()`, and wave 6 adds no action type, so this is a
      verification step rather than an edit. Add one case: a play that both
      raises a `pendingEffect` and springs a blockade leaves both freezes set,
      and `RESOLVE_PENDING_EFFECT` is still admitted.
- [ ] Run; expect FAIL.
- [ ] Implement, in order: the `'deploy'` phase; the `deployWatcher` flag and
      set; `dispatchDeployWatchers`; one shared call from **both**
      `PLAY_CARD_TO_ZONE` and `PLAY_CARD_TARGETING_CARD_IN_HAND`, gated on
      `card.type === 'vehicle'`, placed after `resolvePlayEffects`' failure
      check and after the deploy log line so the log reads deploy-then-battle;
      then `blockadeEffect`'s four branches with `{ needsCatalog: true,
      deployWatcher: true }`.
- [ ] Add the Blockade badge to `zoneEffectBadges.ts` and its icon to
      `BoardZone.tsx`'s `ZONE_EFFECT_ICONS` — the marker is public, like every
      other zone claim, and the deploying player must be able to see the trap
      before sailing into it.
- [ ] Run; expect PASS. Delete `'SS:Blockade'`; **`toHaveLength(0)`**.
- [ ] `npx vitest run`; `npm --prefix frontend run build`;
      `npm run functions:sync`; commit.

---

### Task 12 — the late re-read, and mutation testing

The two cheapest high-yield passes wave 5 identified. Neither is optional.

- [ ] **Re-read all twelve card texts** from
      `supabase/seed/source/builtInCards/` in one sitting, against the built
      code. This is what caught Ongoing Attrition firing on forced battles, and
      nothing else would have. Record every discrepancy as a finding.
- [ ] **Mutation-test the wave's production changes** with
      `scratchpad/mut.sh`, **scoped to all of `shared/`** — a file-scoped run
      reports false survivors. Treat every survivor as a finding: strengthen
      the test that should have killed it, or delete the line it mutated.
- [ ] Fix what both passes find; commit each fix with the finding named.

---

### Task 13 — live verification

**Files:** create `scripts/smoke-wave6.mjs` by re-pointing
`scripts/smoke-wave5.mjs`'s `required` deck lists.

The harness already knows the three things that cost wave 5 a re-run:
`ATTACK_ENEMY_FLEET` does not always lock (a Stealthy or omissible defender
raises the response window instead, and `lockIfPending` is the fix); staging
spans turns because income is *set*, not accumulated; and
`read_console_messages` returns a cumulative buffer that survives reloads, so a
frontend fix is confirmed in a **fresh tab**.

- [ ] Apply the seed to production **before** the code reaches it. This wave
      changes seven cards' `meta`, so it is a real step, not a formality.
- [ ] Deploy: merging to `main` deploys automatically. For an out-of-band
      deploy use `npm run functions:deploy -- game-action` — **never** the
      `deploy_edge_function` MCP tool, and never via a subagent. Verify the
      version incremented and verify **by content**, not by file count.
- [ ] Drive a spec with `p1Faction: 'SS'`, `p1Required: ['Blockade', 'Victoria',
      'Chrysaor', 'Paladin', 'Nothung', 'Balmung']` and `p2Faction: 'WF'`,
      `p2Required: ['Purifier', 'Judgement', 'Harbringer', 'Basher']`, plus a
      second game for DWG's Albacore/Tarpon.
- [ ] **Blockade gets its own live pass.** A battle declared for the
      non-acting player, out of a play handler, is a shape production has never
      run. Prove: the rider survives jsonb, the spring declares with the
      blockader as aggressor, the overlay renders for both players, and the
      aftermath removes the rider only on a wipe.
- [ ] Browser-verify in a **fresh tab**: the Blockade badge renders, Victoria's
      board button appears with a material-only price, and a locked zone
      refuses an aircraft. Zero console errors.

---

### Task 14 — close-out

- [ ] Confirm `KNOWN_GAPS` is empty and `toHaveLength(0)`.
- [ ] Regenerate `supabase/seed/seed_data.sql` and confirm
      `seedDataSync.test.ts` is green.
- [ ] Fold the durable lessons into `docs/claude/architecture.md`,
      `card-effects.md`, `supabase.md` and `testing.md`. **Two known doc drifts
      to fix**: `architecture.md` says "Both are EMPTY as of wave 5" of
      `KNOWN_GAPS`/`PARTIAL`, and `card-effects.md`'s blind-spot-5 note says
      "every registry name outside test files is named by a seeded card" —
      §7 below shows both are now false.
- [ ] Write `docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-closeout.md`
      answering, card by card: which of the twelve are built, which rulings
      reality contradicted, and what is left unverified. The wave-5 close-out
      is the model — **including its correction section**, which is the part
      most worth imitating.
- [ ] Run a secrets audit over `main...HEAD` before pushing.
- [ ] Open the PR. The owner reviews via PR rather than local merges.

---

## 4. Verification gates

Run after every task; report before→after on the last.

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run seed:build
npm run functions:sync
```

Baseline at `356735c`: **780 passed / 33 files**. The lint baseline is 7
inherited warnings across 5 files — **count them, do not copy the number.**

---

## 5. What this wave deliberately does NOT do

- **No new trigger key** — DP7 rides `playOnZoneEffect`, already in G3's
  `ability` row (ruling C-16, verified).
- **No new catalog-probe source** — all four existing sources cover these
  cards.
- **No new `shared/` file**, so no `shared-manifest.json` entry and no
  `shared/engine/index.ts` import.
- **No new action type**, so `battleFreeze.test.ts`'s coverage assertion over
  `knownActionTypes()` stays satisfied.
- **No `PARTIAL` entries.** Every one of the twelve is built whole or not at
  all.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| `legalZonesFor`'s new parameter is missed at a call site | Make it **required**, not optional — `tsc` then finds all five |
| A rider misfires on the new `'deploy'` phase | Opt-in `deployWatcher` set (ruling C-14), plus test (o) |
| Blockade recursing through its own battle's lock pass | Phase guard, plus test (n) |
| The surge refactor silently changes PredatorX/Orbit | An explicit regression test for both, in Task 8 |
| A data key seeded with the wrong value | Four `balancePass.test.ts` value assertions, one per key |
| A missing `{ needsCatalog: true }` | Four runtime `CATALOG_EFFECTS` assertions — the only way to test a flag |
| Paladin's `temporary` priced but never stamped | Test (i): drive `END_TURN` and assert the cull |

---

## 7. Where the handoff drifted

Recorded now, per the standing instruction that every wave finds at least one.
Each was checked against the seed source at `356735c`.

1. **Chrysaor needs more than "a surge that raises the price".** Its text is
   "costs 100k more **and spawns in a second Chrysaor**". `extraSpawns` already
   exists in `ResourceSurge`, so only the cost delta is new — the handoff's
   summary named half the card.
2. **Judgement's `costModifier` reads the whole board, not the zone.** The
   handoff says "a cost modifier that reads the enemy's board", which is right;
   its §2 table's phrasing "reading the **enemy's** hull types" could be read
   as zone-scoped. Ruling B-1 settles it off the card's own internal contrast.
3. **Three registry names are now orphaned** — `purifierEffect`,
   `victoriaOnDeath` (both `grant({ draw: 1 })`) and `rheaOnPlay`. The balance
   pass rewrote Purifier's and Victoria's text and retired Rhea, but left all
   three registrations standing. That is **guard blind spot 5 reopened**, and
   it contradicts wave 5's close-out claim that the blind spot "was swept clean
   at close — every one of the 69 registry names outside test files is named by
   a seeded card". Checked against `origin` before writing it up, per wave 5's
   own lesson: `git log --all -S` confirms the balance pass (`342f0c6`) is the
   commit that orphaned them.
   **Wave 6 leaves the registrations in place and does not reuse the names.**
   An in-flight game dealt before the balance pass carries a frozen snapshot
   naming `victoriaOnDeath`; deleting the registration would change that game's
   behaviour mid-flight, and *reusing* the name would be the Kraken/Paddlegun
   collision itself (spec §9.2). The close-out records them as a known,
   deliberate residue rather than silently clearing them.
4. **The handoff says five cards carry `meta: {}`; seven cards' meta changes.**
   Albacore, Tarpon, Chrysaor, Paladin and Purifier start empty, and Victoria
   and Judgement each gain a price key. `npm run seed:build` is mandatory for
   all seven.
