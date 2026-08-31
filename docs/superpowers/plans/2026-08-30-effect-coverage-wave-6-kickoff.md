# FTD Card Game — Wave 6

You're picking up work on the FTD Card Game, a turn-based companion app for the
game From The Depths. Repo: https://github.com/bromtheman/CardGame

**You are doing wave 6: the twelve cards the 2026-08-30 balance pass seeded but
deliberately left unimplemented.** They are not part of the effect-coverage
spec — waves 0–5 finished that, all 65 of its cards are built — so this wave has
no spec section to obey. It has a `KNOWN_GAPS` map and twelve card texts.

## Read these first, in this order

1. `CLAUDE.md` — the project's hard rules.
2. **`docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-handoff.md`** —
   your primary briefing. The twelve cards grouped by what they actually need,
   the rulings each one is owed, and what wave 6 does *not* need. Read all of
   it.
3. `supabase/seed/effectCoverage.test.ts` — `KNOWN_GAPS` is the **authority**
   on the backlog, and the comment above it names the mechanic each card needs.
   Where the handoff and that map disagree, the map wins.
4. `docs/claude/architecture.md`, `card-effects.md`, `supabase.md` and
   `testing.md` — read the ones matching the work in front of you.
5. `docs/superpowers/plans/2026-08-30-effect-coverage-wave-5-closeout.md` §2
   and §7 — the five places reality contradicted the spec, and the one thing
   the last wave got wrong. §7's mistake is the one most worth not repeating.

The effect-coverage spec (`docs/superpowers/specs/2026-08-27-effect-coverage-design.md`)
is still **binding for the machinery** — DP1–DP7, the suspension rules, battle
summons, the `zoneEffects` rider contract — even though its card list is
finished. Amend it when you depart from it, the way waves 4 and 5 did.

## Verify the state before trusting any of it

```bash
npx vitest run
```

Expect **780 passing, 33 files**. Never pass `--root` — it silently runs 0
tests. If your numbers disagree with the handoff's, believe your own run and
say so.

## The shape of wave 6

Twelve cards, and only one of them needs a new dispatch point.

- **Four are one-liners** over primitives that already exist (Basher, Nothung,
  Balmung, Harbringer). Ship these first — a third of the backlog for a day's
  work, and the map visibly shrinks.
- **Four are small extensions** to machinery that is already there (Judgement,
  Victoria, Chrysaor, Paladin) — a cost modifier that reads the enemy's board,
  an activated ability paid in materials rather than CP, and two
  `resourceSurge` variants the current shape cannot express.
- **Four are new mechanics.** Albacore and Tarpon share one placement rule.
  Purifier needs per-zone battle-loss history — new `PublicGameState`, so both
  halves of the `normalizeState` / `buildInitialGame` pair. **Blockade is the
  wave**: a zone rider that fires when the *opponent* deploys, declaring a
  battle for the player who is not acting. Call it DP7.

**Five of the twelve carry `meta: {}`**, so you are authoring their meta as well
as their behaviour — which makes `npm run seed:build` mandatory, not optional.

## How to proceed

1. Read the twelve card texts in `supabase/seed/source/builtInCards/`. Not the
   handoff's summaries of them — the texts. Every wave so far has found at
   least one place where a summary had drifted, and wave 5 found one in its own
   plan.
2. Settle the rulings the handoff lists **before** writing code, and record
   each one in the spec's §7.3 the way waves 3–5 did. The sharpest are:
   whose aircraft Albacore blocks, what "the previous turn" means when turns
   advance in halves, and who the aggressor is in a Blockade battle.
3. Write an implementation plan to
   `docs/superpowers/plans/YYYY-MM-DD-effect-coverage-wave-6.md` and get
   sign-off before implementing. Keep code out of the plan — wave 5's ran to
   10% of its diff and lost nothing by it.
4. Card effects are **TDD, no exceptions**: failing test first, then the
   implementation, then the full suite with the before→after count.

## What the last wave learned that this one should keep

- **Mutation-test every test, and treat a survivor as a finding.** Wave 5 ran
  62 mutations; five survived their first run and each exposed a test that
  proved less than its name. Scope the runner at all of `shared/`, not one
  file — a file-scoped run reports false survivors.
- **Re-read the card texts once more after everything is built.** That single
  late pass is what caught Ongoing Attrition firing on forced battles, and
  nothing else would have.
- **A difference between your checkout and production is a question, not a
  finding.** `git fetch --all && git log --all -S'<name>'` before you write it
  up. Wave 5 skipped that and reported these very cards as orphans nobody
  owned.

## Verification

`scripts/smoke-wave5.mjs` is a reusable harness — point its `required` deck
lists at your cards rather than writing a third one. It already knows the three
things that cost wave 5 a re-run: the Stealthy response window that decides
whether `ATTACK_ENEMY_FLEET` locks the battle at all, staging that has to span
turns because income is *set* rather than accumulated, and a browser console
buffer that survives reloads.

Blockade deserves a live pass on its own: a battle declared for the non-acting
player, out of a play handler, is a shape production has never run.

## Deploying

`docs/claude/supabase.md` carries the runbook. **Merging to `main` deploys
automatically.** For an out-of-band deploy use
`npm run functions:deploy -- game-action`, never the `deploy_edge_function` MCP
tool, and verify by **content** rather than file count. Apply the seed before
the code reaches production — and this wave changes seed `meta`, so that is a
real step rather than a formality.

Work on a branch off `main`. The owner reviews via PR rather than local merges.

## Finishing

Empty `KNOWN_GAPS` (and decrement its `toHaveLength` literal as you go, one
card at a time), regenerate `supabase/seed/seed_data.sql`, fold the durable
lessons into `docs/claude/*`, and write a close-out that answers, card by card:
which of the twelve are built, which rulings reality contradicted, and what is
left unverified. The wave-5 close-out is the model — including its correction
section, which is the part most worth imitating.
