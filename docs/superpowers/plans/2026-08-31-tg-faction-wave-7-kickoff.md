# FTD Card Game — Wave 7

You're picking up work on the FTD Card Game, a turn-based companion app for the
game From The Depths. Repo: https://github.com/bromtheman/CardGame

**You are doing wave 7: adding the TG faction.** Twenty-six new cards, supplied
by the owner as a single seed-source file. This is not an effect-coverage
backlog — waves 0–5 finished that spec, and wave 6 finished the 2026-08-30
balance pass's twelve. `KNOWN_GAPS` is empty. **Wave 7 fills it from scratch.**

## Read these first, in this order

1. `CLAUDE.md` — the project's hard rules. A fresh worktree needs `npm install`
   in **both** the root and `frontend/`, and a copied `frontend/.env.local`.
2. **`docs/superpowers/plans/2026-08-31-tg-faction-wave-7-handoff.md`** — your
   primary briefing. The faction plumbing, the 26 cards grouped by what they
   actually need, the thirteen rulings they are owed, and what this wave does
   *not* need. Read all of it.
3. The card texts themselves, in `supabase/seed/source/builtInCards/TG-built-in.js`
   once you have placed the file. **Not the handoff's summaries of them.** Every
   wave so far has found at least one place where a summary had drifted, and
   wave 5 found one in its own plan.
4. `docs/claude/architecture.md`, `card-effects.md`, `supabase.md` and
   `testing.md` — the ones matching the work in front of you.
5. `docs/superpowers/plans/2026-08-30-effect-coverage-wave-6-closeout.md` §6 and
   §7 — what wave 6 left unverified, and the tooling lesson. §6.1's warning
   about the seed **not** being applied by a merge is the one this wave most
   needs.

The effect-coverage spec (`docs/superpowers/specs/2026-08-27-effect-coverage-design.md`)
is still **binding for the machinery** — DP1–DP7, the suspension rules, battle
summons, the `zoneEffects` rider contract, §4.6's surge shape — even though its
card list is long finished. Amend it when you depart from it, the way waves 4, 5
and 6 did, and record every ruling in its §7.3.

## Verify the state before trusting any of it

```bash
npx vitest run
```

Wave 6's close-out recorded **932 passing / 33 files**. That figure was not
re-verified when the handoff was written. Never pass `--root` — it silently runs
0 tests. **If your numbers disagree with the handoff's, believe your own run and
say so.**

## The shape of wave 7

Three things are the wave, and none of them is a card.

- **`DECK_FACTIONS` doesn't contain `TG`.** One line in `shared/gameSettings.ts`
  (plus the test that pins the array exactly) is the difference between a
  faction and 26 undraftable rows.
- **`UPKEEP_REQUIRED` doesn't exist.** The word "upkeep" appears in no file in
  this repo. Ten of the 26 cards carry the keyword, so seeding as-is writes
  `null` into ten keyword arrays, silently. The owner has defined it: *at turn
  start, reduce your resources this turn by 15% of this card's cost.* That is a
  new keyword **and** a new rule in `endTurn`.
- **Five LH cards draw from `filter: { faction: 'TG' }`** — and the catalog they
  filter is the whole `cards` table. **That pool is a query, not a card list**:
  `where is_built_in = true and faction = 'TG'` returns 4 rows today and 30 once
  you seed. Putting the new cards in their own faction is not what avoids this;
  it is what causes it, and **wave 7's diff can touch zero LH files and LH still
  changes**. The owner has decided LH keeps its original four; handoff §2.3 has
  the build, and there are **two** filters to change, not one.

Then the cards, which are gentler than they look:

- **Ten are vanilla** (no card text, `meta: {}` is final) and **two are pure
  data keys** with no registry name at all — Curiosity is `additionalSpawns`,
  Acceptance is a `resourceSurge` in PredatorX's shape.
- **Four are one-liners** over primitives that already exist (Jealousy, Fear,
  Obelisk, Hysteria), and **one is permanently `EXEMPT`** — Anguish is conduct
  text, like SS Falcon Squadron.
- **Two are small extensions** (Alarmed, Horror), each owed rulings before a
  line is written.
- **Five are genuinely new.** Nostalgia needs a replacement effect the engine has
  never had; Vengeful needs a resolve-phase bystander pass (call it DP8); the
  two Factories need a rider on a *hull* rather than a zone. **Duel is the
  wave's decision**: a cross-zone battle, which `ActiveBattle` cannot express —
  four load-bearing sites assume a battle happens in exactly one zone.

**Every one of the 26 carries `meta: {}` today**, so you author all of their meta
as well as their behaviour. That makes `npm run seed:build` mandatory throughout,
not a formality at the end.

## How to proceed

1. **Decide Duel first.** Either budget it as the wave's largest task, or ship
   the other 25 and put it in `KNOWN_GAPS` labelled `wave 7`, incrementing the
   `toHaveLength(0)` literal visibly. Decide before you plan, not during.
2. Settle the handoff's §7 rulings **before** writing code and record each in the
   spec's §7.3. The sharpest are what "an AI vehicle" means, whether a submarine
   may damage a base, and which cost upkeep reads — that last one is
   **unobservable on every card that exists**, so it will silently be decided for
   you if you don't decide it.
3. Write an implementation plan to
   `docs/superpowers/plans/YYYY-MM-DD-tg-faction-wave-7.md` and get sign-off
   before implementing. Keep code out of the plan — wave 5's ran to 10% of its
   diff and lost nothing by it.
4. Card effects are **TDD, no exceptions**: failing test first, then the
   implementation, then the full suite with the before→after passing count.

## What the last waves learned that this one should keep

- **Read the card texts once more after everything is built.** That single late
  pass is what caught Ongoing Attrition firing on forced battles; nothing else
  would have.
- **Mutation-test every test, and treat a survivor as a finding** — but prove the
  harness can fail for the right reason first. Wave 6 got a perfect 62/62 that
  was entirely false, with 16 real gaps hidden behind a drift test that fails for
  any `shared/` edit. `scripts/mutation-harness.mjs` is in the repo now with both
  bugs fixed; scope it at all of `shared/`, never one file.
- **A difference between your checkout and production is a question, not a
  finding.** `git fetch --all && git log --all -S'<name>'` before you write it up.

And the one specific to this wave: **its worst failures are all silent.** No red
test, no 4xx, no log line — an undefined keyword, an unlisted deck faction, a
pool that widened without a diff. After each step, ask what would still look fine
if you had got it wrong, then go check that.

## Verification

`scripts/smoke-wave5.mjs` is a reusable harness, but wave 6's close-out §6 flags
that it exports nothing and runs its own scenarios on import — pull `signIn` /
`buildDeck` / `startGame` / `step` into `scripts/smoke-lib.mjs` first, then write
a TG spec against it. Three things it already knows that a fresh harness would
have to relearn: `ATTACK_ENEMY_FLEET` does not always lock the battle (a Stealthy
or omissible defender raises the response window instead, and the lock — with it
DP2's whole dispatch — happens on `RESPOND_TO_ATTACK`); staging spans turns,
because income is *set* to `floor(turnNumber) × 75k` rather than accumulated; and
`read_console_messages` returns a cumulative buffer that survives reloads, so
confirm any frontend fix in a **fresh tab**.

Wave 7 is also the first wave whose live pass can check something no unit test
can: build a TG deck in the real deck builder. If `DECK_FACTIONS` is wrong, that
is where it shows.

## Deploying

`docs/claude/supabase.md` carries the runbook. **Merging to `main` deploys
functions automatically — and never reseeds card data.** Applying
`supabase/seed/seed_data.sql` is a manual `execute_sql`, and for a whole new
faction that is the difference between 26 cards and none. For an out-of-band
function deploy use `npm run functions:deploy -- game-action`, never the
`deploy_edge_function` MCP tool, and verify by **content** rather than file
count.

Work on a branch off `main`. The owner reviews via PR rather than local merges.

## Finishing

Regenerate `supabase/seed/seed_data.sql`, leave `KNOWN_GAPS` at whatever you
consciously decided (0 if Duel shipped, 1 if it didn't — with the literal
incremented in the same commit), fold the durable lessons into `docs/claude/*`,
and write a close-out that answers, card by card: which of the 26 are built,
which rulings reality contradicted, and what is left unverified. The wave-6
close-out is the model — including its correction section, which is the part most
worth imitating.
