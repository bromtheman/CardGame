# Effect coverage — close-out

Wave 5 was the last wave **of the effect-coverage spec**. This is what that
spec is owed: which of its cards are built, which of its own rulings reality
contradicted, and what is left.

It is not the last wave of the project. The 2026-08-30 balance pass added
twelve cards whose behaviour was deliberately left out of scope, and
`docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-handoff.md` is the
wave that closes them.

Everything below is **measured on this branch**, not remembered. Where a number
here disagrees with an earlier document, believe the number.

---

## 1. Coverage, measured

Run over the real seed source (`loadSeedData()`), with every effect module
imported:

| | Count |
|---|---:|
| built-in cards | 123 |
| …carrying non-empty card text | **77** |
| …of those, resolving at least one **implemented** effect | **67** |
| …satisfied by a data key alone | **9** |
| …silent | **1** — Falcon Squadron, the permanent exemption |

67 + 9 + 1 = 77. **There is no fourth category.** `KNOWN_GAPS` and `PARTIAL`
are both empty, both still asserted over, and the wave assertion now loops all
five waves across both — so a reopened entry fails the build, and
`expect(Object.keys(KNOWN_GAPS)).toHaveLength(0)` fails an added one.

The spec's headline number is **65**, which was the size of the *broken* set
the §1 audit found. The guard's population is the 77 text-carrying built-ins,
which is the larger and more useful denominator: it includes cards that already
worked. Both numbers are now fully accounted for.

The nine data-key cards, listed because "no registry name" reads like a gap and
is not one:

| Card | Key |
|---|---|
| DWG Abactor, DWG Pilferer, GT [GT] Osprey | `additionalSpawns: 1` |
| DWG Corsair, WF Pulverizer | `additionalSpawns: 2` |
| SS PredatorX | `resourceSurge { materialsOver: 120000, extraSpawns: 1 }` |
| LH Orbit | `resourceSurge { materialsAtLeast: 140000, extraSpawns: 1 }` |
| WF Buzzsaw, WF Veles | `defensiveOmission: 'unlessShipOrTank'` |

### Wave 5's five, and how each was built

| Card | Home | Trigger it actually keys off |
|---|---|---|
| Ambush (WF) | `zoneEffects`, `expiresOnTurn` | **fighting a battle** there as the aggressor — so a *forced* battle springs it |
| Ongoing Attrition (DWG) | `zoneEffects`, `expiresOnTurn` | **activating the zone** (fleet lock or bombardment) — so a forced battle does **not** |
| Sub Killer (OW) | `zoneEffects`, `expiresOnTurn` | nothing; the rider is data read by `legalZonesFor` |
| Recurring Threat (DWG) | `zoneEffects`, permanent, `data.summon` | a defensive battle lock in that zone |
| Sabotage (OW) | `scheduled`, `sabotageWatch` | the owner's own `END_TURN` |

The first two sitting on the same machinery and reading **differently** is the
sharpest thing this wave learned: their triggers are written differently on the
cards, and §4.3 already ruled that a forced battle is not a zone activation.

---

## 2. Where reality contradicted the spec

Five places. Each is amended in the spec itself; this is the index.

| The spec said | Reality | Where |
|---|---|---|
| DP5's riders extend `state.scheduled[]` | That serves **one** of the four. A zone-scoped rider has to be readable at battle lock and at placement time, and has to be *visible* — Ambush's "deploy after the defending player" is a rule the **defender** obeys in From The Depths. Three riders live on `state.zoneEffects`; only Sabotage fits the original row | §4.3, "DP5 as wave 5 built it"; decision 26 |
| Decision 3's engine-set alert card, narrowed three times to reach "only wave 5's riders" | It reaches **none of them**. Four fire on their owner's own action; the fifth — Recurring Threat — is the loudest card in the wave (permanent public badge, then a public `pendingEffect`, then a visible summon). Closed with no customer | §4.2 departure 4; decision 27 |
| DP2's third lock source scans the defending side | Wave 4's own review flagged that as an open question, and wave 5 is the answer: Ambush and Ongoing Attrition fire on a battle their **owner** declares. Both sides are dispatched now, each rider reading its own `isDefender` | §4.3, DP2 departure 8 |
| `ATTACK_ENEMY_BASE` offers the defender's riders an interception | It now also dispatches the **attacker's** riders. That is what exposed the bug below | §4.3, DP2 departure 9 |
| — | "Destroy" and "remove from play" had never been distinguished, because no card outside a battle did either. This wave prints both words, one card apart | §7.3; decision 28 |

### The bug that departure 9 exposed

`dwgWatersInterception` branched on `phase === 'baseAttack'` alone, which was
sufficient while only the defender's riders were ever handed that phase. Reached
as the **attacker**, it intercepted its owner's own bombardment — and everything
downstream reads `otherSide(actor)` as the aggressor, so the attacker became the
defender of a battle they never declared. It is guarded on `isDefender` now,
which is what "if **the enemy** attacks you directly in this zone" always meant.

Worth recording *how* it surfaced: the regression test written for departure 9
passed on the first run, for the wrong reason — with no enemy hull in the zone,
clause 3 bailed on "nothing to fight" rather than on the guard. Only after the
fixture was given a hull that could be mis-cast as the aggressor did it fail.
**A green test written for a bug you have not yet fixed is a finding, not a
relief.**

---

## 3. What the wave found, and where it came from

Wave 4 measured this honestly and it is worth continuing.

| Finding | Found by |
|---|---|
| `endTurn`'s existing `scheduled` loop consumed every due item of its side **regardless of type**, so the new union member would have been silently eaten | a test written to pin the *other* pass's side check |
| DWG Waters intercepting its owner's own bombardment, roles inverted | the regression test for departure 9 — but only after being strengthened |
| Ongoing Attrition firing on a forced battle, which §4.3 says is not an activation | **re-reading all five cards against their own text after they were built** |
| Recurring Threat's "offers nothing to the aggressor" test passing on the wrong guard | a **surviving mutation** |
| Nothing stopped an **enemy** Recurring Threat marker on the same zone being offered to the defender | a **surviving mutation** |
| A redundant `copyMeta` no test could distinguish from its absence | a **surviving mutation** |
| The plan's own claim that only Recurring Threat needed `{ needsCatalog: true }` | implementation — the flag is about what the **dispatcher** reads, not the effect |
| ~~Seven live built-in cards the repo has never seen~~ — **a false finding**, see §5 | checking the live catalog during the smoke run. The divergence was real; the conclusion drawn from it was not |
| A React duplicate-key error on every idle board, since the overlay was built | **browser verification** — `StealthyResponseBar` and `BattleOverlay` are siblings and both fell back to the bare key `'none'` |

Mutation testing paid for itself three times, and every one of those three was
a *test* defect rather than a code defect — which is exactly the class of
problem no other check finds. The single highest-value pass, though, was the
cheapest: reading the five card texts again, in one sitting, after all five were
built. That is what caught the forced-battle ruling, and nothing else would have.

**Sixty-two mutations** were applied across the wave's production changes and
every one is now dead — but five survived their first run and needed the test
that should have killed them strengthened, and a sixth was resolved by deleting
the redundant line it mutated. A survivor is the finding; the eventual kill is
just the fix.

One caution for whoever runs the harness next (`scratchpad/mut.sh`): scope its
test filter to the whole `shared/` tree, not one file. A mutation of
`battleResolve.ts`'s death dispatch "survived" a file-scoped run purely because
the tests that cover it live in a different file — a false survivor costs the
same investigation as a real one.

---

## 4. Gates

| Gate | Baseline (wave-4 tip) | Now |
|---|---|---|
| `npx vitest run` | 671 passed / 32 files | **753 passed / 32 files**, 0 failed |
| `npx tsc -p tsconfig.json --noEmit` | 0 | 0 |
| `npm --prefix frontend run build` | 0 | 0 |
| `npm --prefix frontend run lint` | 0, 7 warnings | 0, **7** warnings — the same inherited set, in the same 5 files |
| `npm run seed:build` | — | byte-identical; no card `meta` changed this wave |
| secrets audit over `main...HEAD` | — | clean |
| `game-action` deploy | v13 | **v14**, ACTIVE, verified **by content** (every wave-5 symbol present in the deployed bundle) and by boot (its own `401 {"errors":["Not signed in"]}`, not a `BOOT_ERROR`) |
| `scripts/smoke-wave5.mjs` | — | **27/27 steps passed** against v14 |
| browser | — | zero console errors; badge, FRAGILE and the 600 m spawn distance all render |

### What the live run actually proved

Two staged games against the deployed function, 27 assertions:

| Proved live | Why a unit test could not |
|---|---|
| the catalog probe's **fourth source for three new rider names** | the probe is edge-function code, outside the root tsconfig, with no test harness — and a name missing from `CATALOG_EFFECTS` is a rider that never fires, in production only |
| **the attacker-side lock dispatch** (DP2 departure 8) | measured, not asserted: surplus 3 × 40 took the enemy base from 5000 to 4880 |
| **`ZoneEffect.data` carrying a whole `SnapshotCard` through jsonb** | Recurring Threat's remembered hull came back out of Postgres and was minted into the battle |
| **`ZoneEffect.expiresOnTurn`** swept by `endTurn`'s ending-side pass | the GT block was gone at its owner's very next `END_TURN`, leaving the permanent marker behind |
| **`state.scheduled` as a real union** | `sabotageWatch` round-tripped and paid out — hand 14 → 15 on the guest's own end of turn |
| **Ambush moving `distanceM` without spending the hero power** | 1200 → 600 with `distanceModifiedBy` still empty, and Tactical Positioning still offered in the overlay |

In the browser, on a real board: the **RECURRING THREAT** badge renders on its
zone with icon and tooltip; FRAGILE renders on exactly the one sabotaged hull
and not its two `additionalSpawns` siblings; the battle overlay reads
**"Spawn distance: 600 m"**; and the public log carries the deploy-order line
the defender needs. Zero console errors.

The two games are kept (`--keep`) for inspection, along with four lobbies from
earlier runs — all named `wave5-smoke-*`, all safe to delete.

### Three harness bugs, and why they are worth recording

The smoke test failed twice before it passed, and **not once because of engine
code**:

1. It staged two hulls on one turn's income. Income is *set* to
   `floor(turnNumber) × 75k` each turn, so staging has to span turns.
2. It asserted "no card by that name in the discard" for the summon — but
   Recurring Threat had already put a card of that name there when it destroyed
   the original. The assertion could never pass, and had been failing for a
   reason unrelated to what it claimed to test.
3. **It did not handle the Stealthy response window.** `ATTACK_ENEMY_FLEET`
   only locks the battle when no defender may opt out; otherwise the lock — and
   with it DP2's entire dispatch — happens on `RESPOND_TO_ATTACK`. The first run
   passed because the deal handed out a Corsair (no keyword); the second failed
   because it handed out an Abactor (Stealthy). **A live test whose result
   depends on the shuffle is not a test yet**, and it took a re-run with a
   different deal to see it.

The handoff predicted 661 tests. Believe the run: the wave-4 follow-up added ten
before this branch opened.

### The diff, measured the way wave 4 measured its own

`git diff main...HEAD --shortstat -- '<glob>'`, 12 commits, 39 files:

| Slice | Lines | vs wave 4 |
|---|---:|---|
| hand-written production (`shared/` non-test + `frontend/src`) | **662** | ~1,146 |
| tests (`**/*.test.ts`) | **1,197** | ~2,322 |
| docs + spec + plan + close-out | **894** | ~1,312 |
| — of which the implementation plan | 407 (10% of the diff) | 878 (15%) |
| — of which the close-out (new this wave) | 210 | — |
| mechanical `functions:sync` output | **668** | ~1,155 |
| live smoke harness (`scripts/`) | **508** | — (wave 4's lives in its own file) |
| seed source + generated SQL | 8 | ~27 |

Tests-to-production is **1.8**, against wave 4's ~2.0 and wave 3's ~1.7. The
wave is roughly half wave 4's size in every slice, which is what five cards on
mostly-existing machinery should look like. The plan came in at 10% of the
diff, continuing the trend wave 4 started (22% → 15% → 10%) with no quality
cost — the savings went into the close-out and the smoke harness, both of which
are read after the wave ends rather than during it.

---

## 5. What is left

### ⚠ A finding this wave reported, and got WRONG

**Corrected after the fact.** This section originally read
"Production carries seven built-in cards this repo has never seen, naming eight
effects that do not exist", called it a sixth guard blind spot and "the widest
one", and speculated that something predating the seed pipeline had inserted
them. **That was wrong, and it is worth leaving the correction in rather than
quietly deleting the claim.**

What was actually true: while wave 5 was in flight, a separate **2026-08-30
balance pass** (PR #22) added eleven new cards, retired Rhea and reworked nine
more. Its seed had been applied to production; its branch had not yet merged.
So the live table legitimately held cards wave 5's branch could not see — a
branch-vs-production **timing** difference, not orphan data. The effects are
unimplemented **on purpose**: that pass was told to seed the cards and leave
their behaviour out of scope, and it recorded all twelve in `KNOWN_GAPS` under
`balance 2026-08-30`, each annotated with the mechanic it needs. Exactly the
process this guard exists to support.

Both halves of the original claim fail:

- "*Cards the repo has never seen*" — they were in a branch, in review. `git
  log -S` on **my** branch found nothing because the commit was not an ancestor
  of it. Searching one branch and concluding something about the repository is
  the error.
- "*The widest blind spot*" — the guard saw these cards the moment their branch
  merged, and had them listed with reasons before I ever looked. Nothing was
  invisible; I was looking at a stale tree.

What survives is much narrower, and worth keeping: **nothing compares the
generated SQL to the live `cards` table**, so a seed applied from one branch
while another is in flight is indistinguishable, from inside the repo, from
data nobody owns. That is a real gap in the chain — it just was not evidence of
one here.

The lesson is the mirror of §6's, and sharper for being self-inflicted: reading
the primary source is not enough if you read it **on the wrong branch**. A
divergence between your checkout and production is a question, not a finding,
until you have checked `origin` for a branch that explains it — which is one
`git fetch` and one `git log --all -S`.

### Unverified

1. **Sub Killer's GT placement block is unit-tested only.** It cannot be
   exercised live in the natural fixture: decks are single-faction, so an OW
   player holding Sub Killer can never also hold a GT vehicle to be refused.
   Proving it end to end needs a GT-faction deck on the *same* side, which is a
   fixture the smoke harness does not build.

2. **Ambush's decline path and Ongoing Attrition's compensation draw were not
   exercised live** — the smoke run takes every offer and spends every rider.
   Both are covered end to end by unit tests through `applyAction`; only the
   deployed-function round trip is unproven, and it shares every line with the
   accept path that did run.

3. **Wave 4's six unplayed cards are still unplayed** — Dryad, The Onyx Throne,
   Sacrilego, Iron Cordon, Terawatt, Plunderer. The wave-4 handoff named
   Terawatt (a choice dialog rendering *over* the battle overlay) and
   Buzzsaw/Veles (`StealthyResponseBar`, untested at any level) as the two with
   the most unseen UI surface. Still true — though wave 5's smoke run did drive
   `RESPOND_TO_ATTACK` through the deployed function for the first time, which
   is the handler behind that bar.

### Not built, and deliberately

- **Decision 3's alert card.** Closed with no customer (§2 above). Nothing in
  the codebase now sets `state.alertCard` except the manual `SET_ALERT_CARD`
  action, which has no UI caller.
- **The `PARTIAL` map.** Empty, kept, still asserted — it is the correct home
  for the next partly-built card and costs nothing standing empty.

### Open, and inherited

- The five guard blind spots in `docs/claude/card-effects.md` are unchanged in
  kind, though wave 5 shrank the reach of two: the `t_`-prefix rule now has **no
  offenders** (its last two were this wave's own card names), and blind spot 5
  (a registered effect no card names) was swept clean at close — every one of
  the **69** registry names outside test files is named by a seeded card.
- `HandBar.tsx`'s `ALL_TRIGGER_KEYS` still duplicates the registry's private
  list. Still a backlog item; wave 5 added no meta key, so it did not bite.
- SS/WF/GT hero powers remain unbuilt (spec §10, out of scope throughout).

---

## 6. The one thing worth carrying forward

Every wave's handoff has warned that a document can be wrong, and every wave has
found one that was. Wave 5 found five, including two in **its own plan**, written
days earlier by the same process that then disproved them.

The habit that caught them is not a checklist item: **read the primary source
again after you have built against it.** The card texts, not the summary of the
card texts; the dispatcher, not the note about the dispatcher. Both of this
wave's most consequential findings — the forced-battle ruling and the
`needsCatalog` correction — came from doing that once, late, when the code was
already green.

And the rule has a second half this wave learned the hard way, one paragraph
after congratulating itself on the first. Asking production what it actually
held was right; **concluding what that meant without asking `origin` the same
question was not.** Twelve cards were sitting in a branch under review, seeded
deliberately, already listed in `KNOWN_GAPS` with the mechanic each needed —
and the write-up called them orphans that nobody owned. The check that would
have caught it costs one command:

```bash
git fetch --all && git log --all --oneline -S'<the name you cannot explain>'
```

Read the primary source, then — before you write down what it means — make sure
you are reading **all** of it.
