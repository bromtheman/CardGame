# 2026-09-02 balance pass — kickoff for the three parallel faction waves

Hand this document to the agent starting DWG, OW and WF. It is the delta between
what those plans say and what is actually true after Wave 0 shipped.

---

## Your task

Execute three independent waves of the 2026-09-02 balance pass — **DWG, OW and
WF** — in parallel. Each is its own branch off Wave 0 and merges separately.

| Wave | Plan | Tasks | Shape |
|---|---|---|---|
| DWG | `docs/superpowers/plans/2026-09-02-wave-1-dwg.md` | 5 | 6 cards, 2 effect edits |
| OW | `docs/superpowers/plans/2026-09-02-wave-2-ow.md` | 6 | 6 cards, 1 new effect |
| WF | `docs/superpowers/plans/2026-09-02-wave-3-wf.md` | 11 | 14 cards, 7 effects + the deploy-order mechanic |

The binding authority is the spec: `docs/superpowers/specs/2026-09-02-balance-pass-design.md`.
**Read it before the plans.** Where a plan and the spec disagree, the spec wins;
where this kickoff and either disagree, **this kickoff wins** — it is newer than
both.

Use **superpowers:subagent-driven-development** to execute each plan.

---

## Prerequisite — do not start until this is true

Wave 0 must be merged. It is open at
**https://github.com/bromtheman/CardGame/pull/44** (`balance/wave-0-foundation`).

Every one of these three waves depends on things Wave 0 introduces:
`poolEligible()`, the per-faction balance guard files, and the `retired` meta key.
Branch each wave off `main` **after** Wave 0 lands, not off each other.

Verify before starting:

```bash
git checkout main; git pull
npx vitest run          # expect 1281 passing / 46 files
ls supabase/seed/balance/   # expect dwg/ow/ss/tg/wf .balance.test.ts
```

If the counts differ, stop and find out why before writing code.

---

## Six corrections Wave 0 discovered — the plans predate all of them

These are not style notes. Each one cost real time or shipped a real bug.

### 1. An effect and the card that names it MUST land in the same commit

Both split orderings leave the suite red:

- **Effect first** → G4 in `supabase/seed/effectCoverage.test.ts` fails, because a
  registered name no seeded card mentions is exactly what G4 hunts.
- **Seed first** → G1/G2 fail, because a card naming an unimplemented effect needs
  a `KNOWN_GAPS` entry, and spec §1.1 requires that map to stay **empty** for this
  whole pass.

Keep TDD ordering *inside* the task; put the registration, the seed row,
`npm run seed:build` and the balance-guard row in one commit. **Run the full
`npx vitest run` before committing** — a targeted run of one test file will not
show G4 going red, which is how this shape survives review. OW's plan already
had this defect and was fixed; WF's and TG's plans were written with it in mind.

### 2. When you add an exclusion, grep the whole repo — not just `shared/`

Wave 0 extracted `poolEligible()` to replace six copy-pasted exclusions in
`shared/effects/`. It missed two more in `scripts/smoke-lib.mjs` and
`scripts/smoke-wave4.mjs`, and — far worse — missed that
`supabase/functions/lobby-action/index.ts` builds its **own** `DeckCardInfo` map
and never populated the new field at all. The field was optional, so TypeScript
said nothing, and retirement was not enforced server-side. It shipped that way
through seven task reviews before the whole-branch review caught it.

`DeckCardInfo.retired` is now **required** for that reason. If you add a field
that gates behaviour, make it required, and grep for every construction site.

### 3. `npx vitest run supabase/seed/balance` reports **6 files / 35 tests**, not 5/5

Vitest filters by path *substring*, and `supabase/seed/balance` is a prefix of
`supabase/seed/balancePass.test.ts`, so that file is swept in. The plans were
corrected, but if you see 6/35 it is right.

### 4. Paste command output verbatim; never retype it

Two reports in Wave 0 reconstructed a transcript from memory and both invented the
same non-existent path (`supabase/seed/balance/balancePass.test.ts`). The counts
were right; the evidence was worthless. If you cannot copy something exactly, say
so and paste only what you can — an honestly truncated transcript beats a complete
reconstructed one.

### 5. Never hand a reviewer the literal string of a prior defect

Wave 0's controller warned a reviewer to watch for that exact invented path. The
reviewer then "found" it in a file where it did not appear, and a fix round was
spent before the implementer pushed back with evidence and won. **Name the class
of defect** ("check whether transcripts look reconstructed"), never the string.

### 6. If a finding looks wrong, push back with evidence

The withdrawn finding above was the right outcome, reached because an implementer
disagreed and proved it. Do not implement a change you believe is incorrect;
report why, with file:line.

---

## Wave-specific corrections

### WF — three things its plan gets wrong

**(a) Do NOT delete `HARBRINGER_GUEST_MAX_COST` or `PURIFIER_LOSS_WINDOW_TURNS`.**
Spec R-8 originally listed four deletable constants. Only two are: `MARAUDER_DISCOUNT`
(DWG) and `SACRILEGO_HP_BOOST` (SS). These two WF constants keep live readers —
`wfEffects.ts:220` and `placement.ts:95` — because R-8 *keeps* the rules that read
them, and the retired Harbringer row stays seeded and still names `harbringerBattle`.
Deleting either is a compile error. R-8 now carries the table.

**(b) Do NOT delete the "Harbringer draws from exactly the WF ships at or under
100k" assertion.** Spec §7.2 told you to; that row is now struck through. Its
premise was that the constant was going. It isn't, and the assertion's pool is
unchanged by your wave anyway: Buzzsaw moves 80k→75k and is still ≤100k, Earth
Raker doesn't move, and every other WF card you touch is over 100k, a sub, or an
ability. Wave 0 also rewrote it to call `poolEligible`. **Leave it entirely alone.**

**(c) You own one edit to a TG file.** Flip `TG:Anguish` to `deployOrder: 'first'`
in `TG-built-in.js` and remove it from the `EXEMPT` map in `effectCoverage.test.ts`.
TG's wave expects this. Also: `deployOrder` must go in `DATA_EFFECT_KEYS`, or G2
flags Anguish and Veles as silent and logs a false "plays as vanilla" note **to
players**. And `shared/customBattle.ts` cannot carry deploy order — FtD spawns both
teams at once; the only honest surface is `BattleOverlay.tsx`.

### OW — one thing its plan already handles, one to know

Its plan reformats the `DELIBERATE_ORPHANS` assertion so SS's later edit is a clean
insertion. **Wave 0 already did that** (`208672a`). Check before redoing it. OW
still adds `bulwarkOnPlay` to the map — that entry is real, unlike the three
retirement-caused names, which are **not** orphans because their cards stay seeded.

### DWG — nothing wave-specific

Its plan is accurate as written. Note only that `balancePass.test.ts` pins
`DWG:Tarpon` and `DWG:Buccaneer`, so both go red the moment your seed edit lands —
expected, and your plan updates them in place.

---

## Standing rules from CLAUDE.md

- **Shell is PowerShell.** No `&&` chaining.
- `npx vitest run` — **never** pass `--root`; it silently runs 0 tests.
- Any `shared/` edit needs `npm run functions:sync` in the same commit.
- Any `supabase/seed/source/` edit needs `npm run seed:build` in the same commit.
- Relative imports inside `shared/` need the `.ts` extension.
- Effects are keyed by a **unique** registry id; never reuse another card's name.
  Two cards sharing behaviour still get two ids (spec R-6).
- `{ needsCatalog: true }` on any effect reading `ctx.catalog`. **Unit tests cannot
  catch a missing flag** — it is a production-only dead card. Check `CATALOG_EFFECTS`
  before closing a wave.
- A card's `name` is immutable — the row uuid derives from it.
- Report the suite's **before→after** passing count, not "tests pass".

## Merge order

The three are mutually independent, but merges serialize.
`supabase/seed/seed_data.sql` conflicts on every rebase by design — the resolution
is always: take either side, run `npm run seed:build`, commit. Never hand-edit it.
`shared/gameSettings.ts` will also conflict on constants; resolve by keeping both.

After all three land, TG follows (it needs WF's `deployOrder`), then SS.
