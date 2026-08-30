# Effect coverage — close-out

Wave 5 was the last wave, so there is no wave-6 handoff. This is what the spec
is owed instead: which cards are built, which of its own rulings reality
contradicted, and what is left.

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

The handoff predicted 661 tests. Believe the run: the wave-4 follow-up added ten
before this branch opened.

---

## 5. What is left

### Unverified

1. **The live smoke test is written and has not been run.**
   `scripts/smoke-wave5.mjs` stages two games (DWG vs OW for four cards, WF vs
   SS for Ambush) and asserts the paths no unit test can reach: the catalog
   probe's fourth source for three **new** rider names, the attacker-side lock
   dispatch, `ZoneEffect.expiresOnTurn` / `data` surviving jsonb, and
   `state.scheduled` as a real union. It needs the wave-5 `game-action`
   deployed, and **there are 6 active games**, so putting unreviewed engine code
   in front of them is the owner's call rather than a step this wave should take
   on its own. Run it after the merge deploys:

   ```bash
   node scripts/smoke-wave5.mjs --keep
   ```

2. **No wave-5 card has been seen in a browser.** The four new zone badges
   (`crosshair`, `torpedo`, `noSubs`, `ghostShip`) render through code paths
   wave 4 verified for DWG Waters, and the Recurring Threat summon reuses
   wave 3's summon rendering — which wave 4 *did* verify live — but neither has
   been looked at. `--keep` leaves a game to open.

3. **Sub Killer's GT placement block is unit-tested only.** It cannot be
   exercised live in the natural fixture: decks are single-faction, so an OW
   player holding Sub Killer can never also hold a GT vehicle to be refused.
   Proving it end to end needs a GT-faction deck on the *same* side, which is a
   fixture the smoke harness does not build.

4. **Wave 4's six unplayed cards are still unplayed** — Dryad, The Onyx Throne,
   Sacrilego, Iron Cordon, Terawatt, Plunderer. The wave-4 handoff named
   Terawatt (a choice dialog rendering *over* the battle overlay) and
   Buzzsaw/Veles (`StealthyResponseBar`, untested at any level) as the two with
   the most unseen UI surface. Still true.

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
