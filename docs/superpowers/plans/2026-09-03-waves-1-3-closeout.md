# 2026-09-02 balance pass — DWG / OW / WF close-out and handoff

Three parallel waves executed off Wave 0 (`38d9290`). All three complete, reviewed clean,
**verified independently by the coordinator**, and **unmerged** at time of writing.

Read this before starting **TG** (needs WF's `deployOrder`, now landed) or **SS**.

## Result

| Wave | Branch | Range | Commits | Tests | Gates |
|---|---|---|---|---|---|
| DWG | `balance/wave-1-dwg` | `38d9290..ebbd076` | 5 | 1281 → **1296** | all green |
| OW | `balance/wave-2-ow` | `38d9290..072342a` | 8 | 1281 → **1294** | all green |
| WF | `balance/wave-3-wf` | `38d9290..14ec58f` | 18 | 1281 → **1356** | all green |

Every wave: `KNOWN_GAPS` empty (`{}`, `toHaveLength(0)` intact), `tsc --noEmit` exit 0,
frontend build and lint clean (warnings only, all in untouched files).

Coordinator re-ran the suite, typecheck and the key invariants on each tip rather than
accepting the controllers' reports.

## What the waves found that the plans got wrong

The plans predate Wave 0 and the spec has been amended twice. Five real defects:

1. **Spec §7.2's breakage inventory is not trustworthy.** It claims "three files carry
   them". DWG found two more (`placement.test.ts:155-165`, `dwgEffects.test.ts:1237`);
   WF found a third class. Root cause: **a hard-coded literal duplicating a constant's
   value is invisible to a grep for that constant's name.** Both waves independently
   concluded the list must be *derived*, not trusted (DWG ruling 6, WF R-WF-11).
   **TG and SS: sweep for the literal VALUES you move, not just identifiers.**
2. **Spec §6.3 undercounts WF by one card.** Header says "12 updated"; the table lists 11.
   `WF:Pontus` (150k→75k) appears only in §7.2 and in no plan. Added to WF (R-WF-3).
   Found independently three times. **§6.4/§6.5 deserve the same arithmetic check.**
3. **OW's plan mandated an assertion that could not fail.** It specified `toBeDefined()`
   for the R-6 registration check, but `effectFor` returns `null` for unregistered names
   (`registry.ts:97`) and `expect(null).toBeDefined()` passes. The plan's own
   "3 RED expected, 2 observed" was the evidence. Fixed to `.not.toBeNull()` (R-OW-3).
   **Demonstrate a new assertion can go red before trusting it.**
4. **WF's plan ruling W-2 was superseded.** It relocated `PURIFIER_LOSS_WINDOW_TURNS` and
   `HARBRINGER_GUEST_MAX_COST` out of `gameSettings.ts`. Amended R-8 forbids both deleting
   *and* relocating them. Dropped (R-WF-1).
5. **Spec §7.2 still says to delete the Harbringer pool assertion.** The kickoff says that
   row is struck through; **on main it is not**, and §7.2 contradicts its own R-8 and §5.
   Left alone (R-WF-2). **§7.2 needs a central amendment — see Carry-forwards.**

## The bug no per-task review could have caught

DWG's whole-branch review found that `loggerheadOnDeath` mints its free deck copy via
`copyMeta`, which strips only `capturedCopy` — **not `costDelta`**. This pass ships the
game's first *positive* `costDelta`, so a Plunderer-raided Loggerhead that died left a deck
copy at `materialCost: 0` **and** `+20_000` — costing 20k while its text promises
"It costs 0.", re-seeding on every later death.

Neither task's diff contained both halves. This is `discardSnapshotOf`'s documented trap
("TypeScript does NOT catch one you forget") reappearing in a sibling helper.
Fixed at the call site per the `tgEffects.ts:238` precedent; `copyMeta` untouched.

**SS: `handEnteredTurn` (§4.2) lands on `ZoneCardEntry` and has this exact shape.**

## Carry-forwards — work these waves deliberately did NOT do

- ~~**Amend spec §7.2 centrally.**~~ **DONE** — see the docs commit on this branch. Its "three files" inventory and its Harbringer "delete"
  row are both wrong. All three waves were barred from editing the spec (three-way
   conflict). Precedent: Wave 0's `93ca689` / `84926d2`. Landed in the same PR as this doc.
- **Post-merge cleanup sweep.** `takeFromDeck`/`costDelta` accumulation now has three
  verbatim copies (WF R-WF-13, parked). Cheapest once all five waves land; DWG already
  reshapes one copy. Do not extract into `primitives.ts` mid-pass — it widens the merge
  surface across concurrent branches.
- **M4 — Veles wording (parked, needs a spec decision, not a code change).** Veles's text
  says a card *"may* be spawned after all enemies"; the battle panel renders
  `deployOrder: 'last'` as *"your opponent spawns in first"* — a mandate. Purifier and
  Anguish both print "must", so only Veles mismatches. Verified **advisory only**:
  `deployOrderFor` has exactly two consumers (the panel and one log line), and nothing in
  `placement.ts`, `gameEngine.ts` or `validation.ts` reads `deployOrder`. Zero mechanical
  consequence. Fixing it means editing printed card text on a guess about spec intent.
- **Two deployment-order surfaces now exist and are unaware of each other**: the new
  `deployOrder` panel, and Ambush's pre-existing "deploy after the defending player"
  (log-only). Within WF they always agree. They can only contradict in a deck holding
  **both TG Anguish and WF Ambush** — and Buzzsaw now mints Ambush cards into exactly
  those games. **TG should decide whether these reconcile.**

## For TG specifically

- **`TG:Anguish`'s `deployOrder: 'first'` is DONE** (WF owned it), and Anguish has been
  removed from `EXEMPT`. Only its cost move `260000 → 200000` remains for TG.
- `deployOrder` is in `DATA_EFFECT_KEYS` — required, or G2 flags Anguish and Veles as
  silent and logs a false "plays as vanilla" line **to players**.
- `tgFaction.test.ts` is a 343-line guard TG must move wholesale: 26→31 fresh / 30→35
  total, Obelisk `sub`→`ship` changing the split, and the upkeep table going ten → eight
  entries. `balancePass.test.ts` contains **no** TG assertions.

## For SS specifically

- `DELIBERATE_ORPHANS`'s reformat was **Wave 0's** (`208672a`), *not* OW's as SS's plan
  claims. `victoriaActivate` inserts as one clean line into the map and one into the
  sorted array literal.
- Both remaining engine mechanics are absent from `shared/`: §4.1 `zoneCapFor`/`slotDenial`
  and §4.2 `handEnteredTurn`/`putInHand`. Tiger Shark blocks on the first, Tyr on the second.
- §4.2's warning stands: derive the hand-entry site list **by grep at implementation time**,
  not from the spec's list.

## Merge notes

- `main` moved to `dabc5f6` during the run (one line of `shared/customBattle.ts`).
  Verified harmless: `customBattle.ts` is **not** in `supabase/functions/shared-manifest.json`
  and is not synced into `game-action/shared/`, so it needs no `functions:sync`, and no wave
  touches it.
- `supabase/seed/seed_data.sql` and `supabase/functions/*/shared/**` conflict by design.
  Resolution is fixed and never a hand-edit: **take either side, run `npm run seed:build`
  / `npm run functions:sync`, commit.**
- `shared/gameSettings.ts` conflicts on constants: **keep both sides.** DWG deletes
  `MARAUDER_DISCOUNT` and adds `PLUNDERER_CAPTURE_SURCHARGE`; WF adds three and deletes none.
- **Expect an add/add conflict at the tail of `shared/effects/factionEffects.test.ts`**
  when merging WF after OW. Both waves appended a faction-scoped `describe`. This is not
  breakage — keep both blocks, order irrelevant. (The coordinator's R-X-1 recommended
  appending on a mistaken merge rationale; OW's reviewer caught the error. The ruling still
  stands for its other reason — it prevents a sibling restructuring a shared block.)
- Card count: 159 → **160** per wave (Brandistock in OW, Sub Strike in WF; DWG adds none), and 159 → **161** for all three combined.
  Confirm `seed:build` prints the expected total after each merge.
- After all three: confirm `KNOWN_GAPS` still empty, then verify `game-action`'s deployed
  version incremented **by content, not file count** — type-only imports are erased in
  transpilation, so a correct deploy legitimately reads back with fewer modules.

## Still unimplemented after these three waves

58 of 62 spec-named cards, across the two remaining factions:

- **§6.4 TG — 21 of 23.** 5 new (Mania, Spawn Audacious, Agony, Wonder, Repurpose);
  4 effect rewrites (Horror, Duel, Spite, Loathing); 11 data-only, plus Anguish's cost.
- **§6.5 SS — 26 of 27.** 4 new (Thresher Shark, Tiger Shark, Bull Shark, Cash advance);
  16 effect reworks; 6 data-only; **plus both §4 engine mechanics.**

Nothing in §6.1 (DWG), §6.2 (OW) or §6.3 (WF) remains.
