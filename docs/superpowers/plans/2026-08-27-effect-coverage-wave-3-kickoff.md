# FTD Card Game — Effect Coverage Wave 3

You're picking up work on the FTD Card Game, a turn-based companion app for the
game From The Depths. Repo: https://github.com/bromtheman/CardGame

**You are doing wave 3: nine cards, forced battles and battle summons.**

## Read these first, in this order

1. `CLAUDE.md` — the project's hard rules.
2. **`docs/superpowers/plans/2026-08-27-effect-coverage-wave-3-handoff.md`** —
   your primary briefing. It is the accumulated knowledge of waves 0–2: what
   exists, what wave 3 owns, eleven traps that will bite you, what wave 2 did not
   verify, and how to run this wave without burning context. Read all of it.
3. `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — **binding**.
   Game rules come from it, not from guesswork. §4.3 (dispatch points), §4.4
   (battle summons) and §8's wave-3 table are yours. §4.2 and §7.4 describe what
   wave 2 built underneath you.
4. `docs/claude/architecture.md`, `card-effects.md`, `supabase.md` and
   `testing.md` — read the ones matching the work in front of you. All four were
   updated at the close of wave 2.

The handoff's §7 ("Before you start") is a checklist. Do it before writing code.

## Verify the state before trusting any of it

```bash
npx vitest run
```

Expect **423 passing, 29 files**. Never pass `--root` — it silently runs 0 tests.
If your numbers disagree with the handoff's, believe your own run and say so.

`KNOWN_GAPS` in `supabase/seed/effectCoverage.test.ts` is the authority on what
is left: 22 entries, nine labelled `wave 3`. The map is **shrink-only** — an
assertion fails if a listed card has silently started working, so you delete each
entry in the same commit that closes its card.

## The shape of wave 3

Nine cards — Flying Squirrel Attack, Martyr Attack, Air Strafe, Orbit Flank, Gang
Up, Braveheart, Eclipse, Trebuchet, plus **Excalibur** re-filed out of wave 1.
Three pieces of new machinery: **DP3** `declareForcedBattle`, **DP6**
`playOnVehicleEffect` on vehicle cards, and **battle summons**
(`ActiveBattle.summons`) — combatants that live only inside a battle, never touch
the board, and evaporate on report approval regardless of HP.

Handoff §3 lists what wave 2 deliberately left you, including two cards that ship
with an empty `meta: {}` and must have their effect names authored, not merely
implemented.

**Read handoff §4.9 before you write `declareForcedBattle`.** Spec §4.3 tells you
to reuse `lockBattle` and separately rules that a forced battle does not consume
`lastActivatedTurn` — but `lockBattle` stamps it unconditionally. The spec
contradicts itself, and reused unchanged it surfaces two actions later as a 409
on a legitimate fleet attack.

## How to proceed

This wave adds a state field (`ActiveBattle.summons`), a new dispatch path, and
changes battle resolution — so it needs design agreement before code:

1. **Brainstorm the design with the owner.** In particular: how a forced battle
   differs from a declared one at every point the existing battle flow touches,
   how summons enter and leave `activeBattle`, what the report and spawn sheet
   show for a summon, and how Trebuchet's repeat interacts with `pendingEffect`.
2. Amend the spec wherever your design departs from §4.3 or §4.4, and get
   sign-off. §4.2 was rewritten this way at the close of wave 2 — follow that
   precedent rather than leaving the spec describing something you did not build.
3. Write an implementation plan to
   `docs/superpowers/plans/YYYY-MM-DD-effect-coverage-wave-3.md` and get sign-off
   before implementing. **Read handoff §6 first and decide your process before
   you write the plan** — wave 2's two most expensive mistakes were both locked
   in by the time its first task was dispatched.

Work on a branch off `main`. The owner reviews via PR rather than local merges.

## Deploying

`docs/claude/supabase.md` carries the runbook. Two things wave 2 learned the hard
way, both now in it:

- **Apply the seed first, then deploy `game-action`.**
- **Rebase or merge `main` before you deploy.** Wave 2 deployed from a branch
  that predated a fix on `main` and silently reverted it in production for three
  hours. A deploy ships your whole branch state, not just your diff.

## Finishing the wave — not optional

Wave 4 depends on you, and will know only what you write down. Before you call
wave 3 done: amend the spec where reality diverged, promote durable lessons into
`docs/claude/*` (effects → `card-effects.md`, engine → `architecture.md`, deploy
→ `supabase.md`, test traps → `testing.md`), update `KNOWN_GAPS` labels if your
work moves a card between waves, and **write wave 4's handoff and kickoff prompt
in the same shape as these two**.

Handoff §6 records where wave 2's five real findings actually came from. The one
process element it tells you not to cut is this step.
