# Effect coverage — wave 5 handoff

Written at the close of wave 4 for whoever picks up wave 5. Wave 5 is the last
one: after it, all 65 cards are built and `KNOWN_GAPS` is empty.

Everything below was verified against the code at the wave-4 tip. Where a
document and the code disagreed, wave 4 corrected the document — twice this
round the correction was to a claim a previous wave had stated as fact
(`docs/claude/card-effects.md`'s plain-data key list, and `architecture.md`'s
"the two freezes are mutually exclusive"). Take that as a standing warning
rather than history: **verify what you read here against the code, and correct
this doc if wave 5 finds it wrong.**

**Binding authority:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`.
§4.3's DP5 row is your dispatch point, §8's wave-5 table is your card list, and
§4.2's departure 4 is the alert-card decision that has now been narrowed twice
to reach **only** your five cards.

---

## 1. Where things stand

Run this yourself before you touch anything; do not trust the numbers below if
they disagree with your own run.

```bash
npx vitest run                      # 655 passed / 32 files, 0 failed  ← NEVER pass --root
npx tsc -p tsconfig.json --noEmit   # exit 0
npm --prefix frontend run build     # exit 0
npm --prefix frontend run lint      # exit 0, with 7 pre-existing warnings across 5 files
```

The 7 lint warnings (`react(set-state-in-effect)` ×5, `react(only-export-components)`
×2, in `auth.tsx`, `ConfirmDialog.tsx`, `CardDetailsModal.tsx`,
`CreateCardPage.tsx`, `HandBar.tsx`) are the same set waves 2, 3 and 4 all
inherited — still unchanged, still not yours. Count them; do not repeat "7"
from this doc.

### The coverage guard (`supabase/seed/effectCoverage.test.ts`)

| | Count | Contents |
|---|---:|---|
| `KNOWN_GAPS` | **5** | all wave 5 |
| `PARTIAL` | **0** | empty — wave 4 closed both entries |
| `EXEMPT` | 1 | Falcon Squadron, permanently |

Waves 1–4 are closed. The assertion now **loops** waves 1–4 over *both* maps,
so a reopened entry in either fails the build, and `toHaveLength(5)` pins the
remainder. **The map entry and the `toHaveLength` literal move in the same
commit that registers a name** — closing a card without deleting its entry
fails the build, by design.

`PARTIAL` being empty is not an invitation to delete it. It is asserted over,
so it works empty, and it is the only correct home for a card whose text is
partly built — such a card passes G1/G2 and cannot go in `KNOWN_GAPS`.

**Regenerate `supabase/seed/seed_data.sql` (`npm run seed:build`) after every
commit that touches a card's `meta`.** `seedDataSync.test.ts` fails on drift,
so forgetting is caught rather than silent — but the whole guard reads
`source/*.js`, so a stale SQL would otherwise deploy while every check stayed
green.

---

## 2. What wave 4 built that you are standing on

Read this section. **Two of your five cards sit directly on machinery wave 4
finished**, and one of them is very nearly already built.

### 2.1 DP2 — the battle triggers (`shared/engine/battleTriggers.ts`)

The module registers no handler. Three existing seams call it: `battleDeclare.ts`
at lock, `battleResolve.ts` at resolve, `baseAttack.ts` on a bombardment.
Effects receive:

```ts
interface BattleContext {
  phase: 'lock' | 'resolve' | 'baseAttack'
  zoneId: number
  isDefender: boolean
  isParticipant: boolean
  forced: boolean              // declared by a card, not ATTACK_ENEMY_FLEET
  survived: boolean            // resolve/baseAttack only
  won: boolean                 // resolve/baseAttack only
  casualties: BattleCasualty[] // resolve only: { entry, side, hp }
}
```

on `payload.battle`, and its presence is the **only** thing telling a battle
trigger apart from an ordinary play — the role `continuation` plays for
Trebuchet. Spec §4.3's "DP2 as wave 4 built it" records all seven departures;
`docs/claude/architecture.md` has the operational version.

**Lock dispatches from three sources**, in a fixed order: every participant on
both sides (summons included); then, *only on a forced battle*, the defending
side's non-participants in that zone whose effect registered
`{ battleBystander: true }`; then `state.zoneEffects` riders on that zone
belonging to the defending side. That third source is yours (§3 below).

### 2.2 A spent ability can keep firing — `state.zoneEffects` riders

This is the piece **Recurring Threat needs, and it already exists.** DWG
Waters is an ability: it is `spendCard`'d the moment it is played, so by the
time its battle riders matter its card is in neither hand nor field. The
`zoneEffects` entry stores the **registry name** it was claimed under, and
`dispatchBattleLock` looks the effect up by that name, mints a `CardInstance`
from the catalog by `cardName`, and calls it with a lock-phase `BattleContext`.

Consequences you inherit:

- **One registry name per card, whatever the occasion.** `dwgWatersEffect`
  serves the zone claim, the defensive-battle guest offer, and the base-attack
  interception, told apart by `payload.battle`. It *must* stay one name — the
  stored `zoneEffects.effect` is what dispatches it. Recurring Threat is the
  same shape: a play effect that leaves a marker, plus a rider the marker
  fires.
- **A rider effect needs `{ needsCatalog: true }` if it mints anything**, and
  `game-action`'s probe grew a **fourth source** for exactly this case
  (`state.zoneEffects[].effect ∈ CATALOG_EFFECTS`). If your rider mints, that
  source already covers it; if you invent a fifth dispatch point that fires for
  a card in neither hand nor field, you need a fifth source. See
  `docs/claude/supabase.md`.

### 2.3 `joinBattle` — the only way into a battle already in progress

```ts
joinBattle(game, side, instanceId, entry?): boolean
```

`declareForcedBattle` refuses outright while `state.activeBattle` is non-null,
which at lock it always is — so a lock trigger that wants to add a combatant
uses this instead. `entry` present mints a battle **summon** (pushed to
`summons`, evaporates on approval, spec §4.4); `entry` absent adds an id
already on the board. Recurring Threat's "battle summon of that vehicle in
defensive battles there" is the first case, exactly as DWG Waters' clause 2 and
The Onyx Throne's Parapet already do it.

### 2.4 Reviving and sacrificing

```ts
canRevive(game, side, entry): boolean
reviveEntry(game, side, entry, zoneId): boolean
sacrificeEntry(game, side, instanceId, zoneId): boolean
sacrificeToSave({ effect, prompt, eligible })   // primitives.ts — the whole two-phase dance
```

Iron Cordon and Sacrilego share these. **`canRevive` is not optional decoration**
— see trap 4.3.

### 2.5 Both freezes may now be set at once

`state.pendingEffect` and `state.activeBattle` can be non-null together, and
two shipped cards do it (Terawatt's join, DWG Waters' clause 2). It is safe for
three reasons that all predate wave 4, and
**`shared/engine/battleFreeze.test.ts` pins the whole sequence** — every action
type × both players, driven by a synthetic bystander rather than by either
card. If you add a suspension anywhere near a battle, read that file first; if
you add an **action type**, that file fails until you decide how it behaves
under the two freezes (it asserts its sweep covers `knownActionTypes()`).

### 2.6 `choice()` now drops a second offer

There is one suspension slot, and since wave 4 a single action can dispatch
several effects that each want it. `choice()` checks `state.pendingEffect`
itself: if it is taken, it logs and returns true rather than overwriting.
Two things follow, and both are load-bearing:

- **Put an unconditional clause BEFORE the choice.** Sacrilego's "gain 1cp.
  Additionally you may sacrifice it…" grants the CP first, so it still lands
  when the offer cannot be made. The rule used to live in the dispatcher, which
  skipped the whole effect and starved exactly that clause — a review caught it.
- **An effect that writes `state.pendingEffect` by hand bypasses the check.**
  Orbit Flank's second hop does. Route a new suspension through `choice()`.

### 2.7 Defender omission (§4.8) — plain card data, not an effect

Buzzsaw and Veles close with **no registry name at all**:
`meta.defensiveOmission: 'unlessShipOrTank'`, in `DATA_EFFECT_KEYS`, read by
`ATTACK_ENEMY_FLEET` into a second opt-out list `awaitingResponse.omissibleIds`.
If one of your cards is a *rule* rather than an *action*, this is the precedent
— and trap 4.4 is the bill that comes with it.

---

## 3. What wave 5 owns

| Card | Faction | Mechanism |
|---|---|---|
| Ambush | WF | zone rider for the rest of the turn: deploy after the defender and 600 m closer in the next offensive battle there; unused at turn end → draw |
| Ongoing Attrition | DWG | zone rider: on activation while out-numbering, 40k base damage per surplus vehicle; leaves play without dealing damage → draw |
| Sub Killer | OW | remove a targeted enemy sub, plane or airship from a zone where you hold no GT vehicle; rider blocks GT deployment there for the turn |
| Recurring Threat | DWG | destroy a friendly vehicle; permanent `zoneEffect` offering a battle summon of that vehicle in defensive battles there |
| Sabotage | OW | `grantKeywords(['fragile'])` plus a `scheduled` rider: survives the turn → draw |

Plus **decision 3, the alert card**, which spec §4.2 departure 4 and §4.3
departure 2 have now narrowed twice to reach only these riders: an effect
planted on the opponent's own next battle is the one case where nothing else
announces itself. A forced battle raises the `BattleOverlay`; a choice writes
public `pendingEffect`. A rider does neither. Read both departures before
deciding whether to build it.

### Recurring Threat is 80% built

It is DWG Waters' clause 2 with a different pool: a permanent `zoneEffect`
whose rider offers a battle summon in defensive battles in that zone. Read
`dwgWatersEffect` in `shared/effects/dwgEffects.ts` end to end before writing a
line — the three-clause-one-name shape, the `zoneEffects` rider dispatch, the
"alongside your fleet needs a fleet" guard, and `joinBattle` with an `entry`.
The differences are: the summoned hull is a *specific destroyed friendly
vehicle* rather than a pool pick, and the destruction is part of the play. That
second half means you must decide how the destroyed vehicle's identity is
stored on the `ZoneEffect` — which today carries only
`{ effect, zoneId, side, cardName, setOnTurn }`. **A new `ZoneEffect` field is
a `PublicGameState` change**: it needs a `normalizeState` default, and
`zoneEffectBadges.ts` in the frontend reads the shape too.

### Ambush and Ongoing Attrition need DP5, which does not exist

Spec §4.3's DP5 row says the rest-of-turn riders extend the existing
`state.scheduled[]` discriminated union rather than adding a state field — it
already carries `side` and `dueTurn` and is already processed in `endTurn`.
**Sabotage fits that exactly** ("survives the turn → draw"). Ambush and Ongoing
Attrition may not: both are *zone* riders that modify a battle, and
`state.zoneEffects` may be the better home for those, with `scheduled` carrying
only the "unused at turn end → draw" tail. That is a real design fork and
deserves a spec amendment either way — wave 4 amended §4.3 seven times and
§7.3 six, and that precedent is what made this handoff writable.

Ambush in particular touches `ActiveBattle.distanceM` / `distanceModifiedBy`,
which today only Tactical Positioning writes. Read `heroPowers.ts` before
assuming the field is free.

---

## 4. Traps — read this section twice

Everything here bit wave 4 or is verified to be waiting for wave 5.

### 4.1 Deploy runbook, unchanged and still true

- **Use `node scripts/deploy-function.mjs game-action`, never the
  `deploy_edge_function` MCP tool** for `game-action`. Its payload is 23 files
  and ~161 KB; the MCP path truncates silently, and a partial payload **deletes
  the files it omits**. `$env:SUPABASE_ACCESS_TOKEN` (PowerShell — `export` is
  bash and fails).
- **Apply the seed first, then deploy.**
- **Rebase or merge `main` before deploying.** A deploy ships the whole branch
  state, not your diff.
- **Check for live games holding a name you're about to register.** A game's
  `meta` is frozen but the name→implementation mapping is shared code.
- **Verify by content, not file count** — type-only imports are erased in
  transpilation, so a legitimate deploy reads back with fewer modules.

### 4.2 `REACHABLE_TRIGGERS` needs its row before a card can leave `KNOWN_GAPS`

Evergreen. G3 skips any card still in `KNOWN_GAPS`, so the table only bites the
moment you close one, and the failure reads as "this card is mis-wired", not
"the table is out of date". Wave 2 hit it with `onActivate`, wave 3 with
`playOnCardEffect`, wave 4 added the three DP2 keys ahead of Catshark. **If DP5
introduces a trigger key, add its row first.** If your rider is dispatched from
`zoneEffects` (Recurring Threat), it needs no new key at all — it rides its
existing `playOn*` name, which is why DWG Waters added nothing to the table.

### 4.3 A death trigger can empty the discard under you

Found by review in wave 4, and the sharper half of a general rule.
`DECIDE_BATTLE_REPORT` fires `onDeathEffect`s **before** DP2's resolve pass.
Several of those are `grant({ draw: 1 })` — and `drawCard` on an empty deck
calls `reshuffleDiscard`, which moves the **whole** discard into the deck. So
by the time a resolve trigger runs, a hull that died moments earlier may have
no snapshot left in `state.destroyed`. Iron Cordon and Sacrilego offered such a
hull and then 400'd on the answer, leaving Decline as the only working reply.
**Anything that reads `state.destroyed` after a death trigger has run must
check the entry is still there** (`canRevive`).

The general rule: **`state.destroyed` is not a log, it is a live reservoir**.

### 4.4 A data key's VALUE is never checked — only its presence

New in wave 4, and the guard's newest blind spot. `DATA_EFFECT_KEYS` is what
lets a card close with no registry name (Buzzsaw, Veles), but G2's `hasData`
and `noteUnimplemented`'s `hasData` both test whether the key **exists**, never
what it holds. Seed `'unlessShipOrTanks'` and you get a card that is inert
**and** invisible: the guard stays green and no "plays as vanilla" note is
logged either. **A data key whose value the engine compares needs its own
seed-backed assertion** — `battleDeclare.test.ts`'s "the two real seeded cards
carry exactly the value the engine compares" is the worked example.

### 4.5 `{ needsCatalog: true }` is still invisible to unit tests

Unchanged and still the sharpest production-only failure mode. `makeCtx`
hand-builds the catalog, so a missing flag is green suite, dead card. Wave 4
verified its four flags by asserting `CATALOG_EFFECTS` membership at runtime
rather than by reading the code — cheap, and worth repeating. Recurring
Threat's summon will read the catalog.

### 4.6 After `git checkout --` on a `shared/` file, re-run `functions:sync`

New in wave 4, and it costs ten confused minutes each time. `core.autocrlf`
smudges the restored file back to CRLF while the synced edge copy stays LF.
`git diff` reports **nothing** — both normalize to the same blob — but
`functionSharedSync.test.ts` compares bytes and fails. It presents as a phantom
failure on a clean tree. This bites mutation testing hardest, where reverting a
production file is the whole loop; the harness in this wave's scratch dir
resyncs automatically after each restore.

Related: **never `git checkout --` a file whose work is uncommitted.** Wave 4
did it once during a teeth check and lost a task's production changes; they
were recoverable only because `functions:sync` had already copied them into
`supabase/functions/`. Commit first, then mutate.

### 4.7 `npx tsc` does not typecheck edge functions or test files

Unchanged. `supabase/functions/**` and `**/*.test.ts` are both outside the root
tsconfig's `include`. Two consequences wave 4 hit: `game-action/index.ts` is
gated only by careful reading and the live smoke test, and a *compile-time*
exhaustiveness check written inside a test file is never actually checked — the
reason `knownActionTypes()` is exported from `gameEngine.ts`.

### 4.8 Still true, and every wave keeps re-learning it

- **Grep the seed source for a name before you register it**, and again before
  you call the task done — a registered effect no card names is invisible to
  G1/G2/G3.
- **Card text is authoritative** over any ported implementation.
- **`state.log` is public, and so is `pendingEffect.options`.**
- **Every commit touching `shared/` includes `npm run functions:sync` output.**
  A new file also needs a side-effect import in `shared/engine/index.ts` **and**
  a `supabase/functions/shared-manifest.json` entry.
- **Relative imports inside `shared/` carry the `.ts` extension.**
- Consumers import `shared/engine/index.ts`, never an individual engine module.

---

## 5. What wave 4 verified, and what it did not

**The in-game smoke test finally ran.** It had been outstanding since wave 2 —
three waves' worth of "the engine is unit-tested, the wiring on top of it is
not". `scripts/smoke-wave4.mjs` is the harness, and **it is reusable: point its
`required` deck lists at your own cards and it builds the fixture for you.**

It signs in both QA accounts, builds two legal 20-card decks, creates a lobby,
starts a game, and then drives the **real deployed `game-action`** through the
paths that no unit test can reach. **16/16 steps passed** against `game-action`
v11. What it actually proves:

| Proved live | Why it needed a live test |
|---|---|
| catalog probe source 1 (card in the caller's hand) | the probe is edge-function code, outside the root tsconfig, with no test harness |
| **catalog probe source 4 (`state.zoneEffects`)** | wave 4 added it; a spent ability's rider is in no hand, on no field, and not the pending card |
| catalog probe source 3 (`pendingEffect.card`) | the only prior exercise anywhere was wave 3's, which never ran |
| DP2's lock dispatch | Catshark's 30k landed in production — measured, 150k − 100k + 30k = 80k |
| `joinBattle` | the summoned Corsair is in the battle and **not** on the board |
| both freezes set at once | `pendingEffect` owed to the defender while `activeBattle` stood, then reportable after the answer |

And in the browser, on a real board, with **zero console errors**:

- The `BattleOverlay` renders a battle summon correctly — labelled `(summoned)`
  and carrying its "vanishes when the report is approved regardless of HP,
  cannot be repaired" note. **This is wave 3's summon rendering, verified for
  the first time.**
- The battle-report form includes the summon, so report completeness works
  through the UI and not just in the engine.
- The `DWG WATERS` zone badge renders on the claimed zone.
- The public battle log reads cleanly end to end and names no hidden card.

### Still unverified

1. **Six of the ten cards were not played in a live game.** The smoke test
   exercises DWG Waters (all three clauses' machinery), Catshark, and the
   summon/battle plumbing. Dryad, The Onyx Throne, Sacrilego, Iron Cordon,
   Terawatt, Buzzsaw/Veles and Plunderer are covered only by unit tests. The
   harness makes adding them cheap — a `required` deck list and a few more
   steps — and the two with the most UI surface are **Terawatt** (the choice
   dialog rendering *over* the battle overlay, which no player has yet seen)
   and **Buzzsaw/Veles** (the response bar's new "sit out" label, which has no
   test of any kind — `StealthyResponseBar` is untested, pre-existing).
2. **Two rulings are open for the owner**, both raised in PR #19 and neither a
   defect. See §3's traps and the PR body: Dryad × Trebuchet makes Trebuchet's
   repeat non-terminating (spec §7.3's "self-limiting on the zone's
   population" premise is now false), and a DWG Waters zone becomes
   *permanently* un-bombardable rather than merely un-bombardable this turn.
   **Check whether they were resolved before you build on either card.**
3. **The bystander pass scans only the defending side.** DWG Waters' clause 3
   is the one caller where a card effect drags the *attacker's* hulls into a
   fight, so an attacker-side Terawatt can never react to it. Flagged by
   review as a question; not resolved.

---

## 6. How to run this wave — measured, not remembered

Wave 4 measured **17 commits** and a **~6,000-line diff** against `main`:

| Slice | Lines | vs wave 3 |
|---|---:|---|
| hand-written production (`shared/` non-test + `frontend/src`) | ~1,146 | 1,023 |
| tests (`shared/**/*.test.ts`) | ~2,322 | ~1,700 |
| docs + spec + plan | ~1,312 | ~1,250 |
| — of which the implementation plan | 878 (15% of the diff) | 1,050 (22%) |
| mechanical `functions:sync` output | ~1,155 | ~880 |
| seed source + generated SQL | ~27 | — |

Measure yours the same way: `git diff main...HEAD --shortstat -- '<glob>'`.

The tests-to-production ratio rose from ~1.7 to ~2.0, entirely because the
reviews demanded regression tests for what they found. That is the right
direction, not scope creep.

### Where wave 4's findings actually came from

| Finding | Found by |
|---|---|
| A death trigger's draw can empty the discard, so a revive offer 400s with Decline the only exit | Task 6's **dedicated reviewer** |
| Trebuchet's repeat scored a battle it lost as a clean win, because Terawatt's join made its declare-time roster stale | Task 7's **dedicated reviewer** |
| Two surviving Sacrilegos granted 1 CP between them — the dispatcher skipped a whole effect, starving an unconditional clause | Task 6's **dedicated reviewer** |
| Nothing pinned `'unlessShipOrTank'`; a seed typo would ship a card both inert and invisible | Task 8's **dedicated reviewer** |
| `reviveEntry` matched on `cardId` alone, so a plain and a Scrappy copy of one card were interchangeable | Task 6's **dedicated reviewer** |
| `PendingChoiceDialog` and `BattleOverlay` are both `z-50`; only JSX sibling order kept the dialog reachable | Task 7's **dedicated reviewer** |
| Two mutations survived their own teeth checks, exposing tests that proved less than they claimed | **implementer**, during the teeth-check loop (twice: Terawatt's "alone" re-check, the bombardment dispatch's position) |
| A registered-but-unnamed effect — none this wave; the §4.8 sweep came back clean | **controller verification** |

**Every should-fix finding this wave came from a dedicated review.** That is a
sharper result than wave 3's (four of eight reviews clean) and much sharper
than wave 2's (twelve of seventeen returned nothing). The difference is not
luck: wave 4 reviewed only the four tasks that write `pendingEffect`,
`ActiveBattle` or `awaitingResponse`, and gave each reviewer the card text, the
specific invariants, and an explicit "the brief may be wrong". Narrow scope
plus a stated hypothesis is what made them productive.

### Spend here

1. **Dedicated review for every task touching a freeze-adjacent field**, and
   give the reviewer the card text and the rules doc rather than just the diff.
   Four for four this wave.
2. **Tell the reviewer the brief may be wrong.** Two findings this wave were
   "the code does not do what your description says".
3. **Mutation-test every test, and treat a SURVIVING mutation as a finding.**
   Two of wave 4's own test improvements came from mutations that did not go
   red — which is the only way to learn that a test proves less than its name.
   Build the fixture so a wrong branch yields a different *legal* outcome, not
   a 400 that dies before its assertion.
4. **The whole-branch review is still the highest-leverage single spend.** It
   sees the shape no per-task review can: a leak whose cause and reachability
   live in different tasks.

### Save here

5. **Keep the plan free of inlined code bodies** — 15% of the diff this wave,
   down from 22%, with no quality cost. Name files, signatures, values, test
   cases and counter arithmetic; let the implementation be written once.
6. **Batch mechanical, related card work.** Wave 4's Task 5 shipped three cards
   in one dispatch.
7. **Demand terse reports** — `file:line`, a failure scenario, a severity. Every
   row in the table above came straight off a review in that shape.

### The one thing not to cut

Write wave 5's close-out. You are the last wave, so there is no wave 6 handoff
to write — but there **is** a final accounting the spec is owed: which of its
65 cards are built, which rulings reality contradicted, and what is left. Do
that instead.

---

## 7. Before you start

1. Read spec §4.2 (five departures) and §4.3 (four DP3/DP6 + seven DP2), §4.4,
   §4.8, §7.3's rulings, and §8's wave-5 table.
2. Read `docs/claude/architecture.md` (DP2's dispatch, both freezes,
   `awaitingResponse`'s two lists, the destructure trap and
   `discardSnapshotOf`), `card-effects.md` (the five suspension rules, the
   registration flags, the five guard blind spots), `testing.md` (the CRLF
   trap, `battleFreeze.test.ts`) and `supabase.md` (four probe sources, the
   deploy runbook).
3. Run the four commands in §1 and record your own baseline.
4. **Read `dwgWatersEffect` end to end before designing Recurring Threat.** It
   is the same card shape and the machinery is already there.
5. Decide, and amend the spec: does DP5 live on `state.scheduled`, on
   `state.zoneEffects`, or both? §4.3's DP5 row predicts `scheduled`; Ambush and
   Ongoing Attrition may not fit it.
6. Decide, and amend the spec: is decision 3's alert card built for your riders,
   or narrowed out of existence? It has been narrowed twice and now reaches
   nothing else.
