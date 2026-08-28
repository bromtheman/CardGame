# FTD Card Game — Effect Coverage Wave 4

You're picking up work on the FTD Card Game, a turn-based companion app for the
game From The Depths. Repo: https://github.com/bromtheman/CardGame

**You are doing wave 4: battle triggers (DP2) and defender selection.**

## Read these first, in this order

1. `CLAUDE.md` — the project's hard rules.
2. **`docs/superpowers/plans/2026-08-28-effect-coverage-wave-4-handoff.md`** —
   your primary briefing. It is the accumulated knowledge of waves 0-3: what
   exists, what wave 4 owns, the coverage guard's five blind spots plus eight
   more traps that will bite you, what wave 3 did not verify, and how to run
   this wave without burning context. Read all of it.
3. `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — **binding**.
   Game rules come from it, not from guesswork. §4.3's DP2 row, §4.4 (battle
   summons — already built, but the vocabulary is yours to use) and §8's
   wave-4 table are yours. §4.2 describes the choice slot every DP4 card in
   your wave will suspend into.
4. `docs/claude/architecture.md`, `card-effects.md`, `supabase.md` and
   `testing.md` — read the ones matching the work in front of you. All four
   were updated at the close of wave 3.

The handoff's §7 ("Before you start") is a checklist. Do it before writing code.

## Verify the state before trusting any of it

```bash
npx vitest run
```

Expect **514 passing, 29 files**. Never pass `--root` — it silently runs 0
tests. If your numbers disagree with the handoff's, believe your own run and
say so.

`KNOWN_GAPS` in `supabase/seed/effectCoverage.test.ts` is the authority on
what is left: 13 entries, 8 labelled `wave 4`. The map is **shrink-only** — an
assertion fails if a listed card has silently started working, so you delete
each entry in the same commit that closes its card. `PARTIAL` carries two more
entries also labelled wave 4 (Plunderer, DWG Waters) — different map, same
rule: delete the entry when the card's remaining clauses are done.

**Regenerate `supabase/seed/seed_data.sql` (`npm run seed:build`) before every
commit that touches a card's `meta`, and grep the output for your effect
names.** It is a tracked, generated file that nothing in the suite compares
against its source — wave 3 nearly shipped nine dead cards to production over
exactly this gap. See the handoff §1 and §4.1 (blind spot 4).

## The shape of wave 4

Eight cards — Catshark, Dryad, The Onyx Throne, Sacrilego, Iron Cordon,
Terawatt, Buzzsaw, Veles — plus two cards that are already partly built and
need their remaining clauses finished: **Plunderer** (clause 2: draw from the
enemy deck after a victorious fleet battle or base damage) and **DWG Waters**
(clauses 2-3: a defensive battle summon offer, and forcing an attacker to beat
DWG Waters first).

One new dispatch point: **DP2**, the battle triggers —
`onBattleEffect` (fires at battle **lock** and at **resolve**, carrying
`{ phase, zoneId, isDefender, survived, won }`) and `onBattleVictory` /
`onBattleDefeat` (resolve-only sugar, dispatched per side outcome). Unlike
every dispatch point before it, these three keys are named on **zero** seeded
cards today — you are building the dispatch and authoring the seed data
together, not wiring up something already half-present.

Two things in your wave are not straightforward DP2 cards and deserve extra
brainstorming time: **Buzzsaw/Veles's defender-omission rule** (closer to the
existing Stealthy opt-out in `RESPOND_TO_ATTACK` than to anything DP4-shaped,
but not a direct copy — see handoff §3) and **Terawatt's "join a friendly
vehicle forced to fight alone"** (needs a hook into `declareForcedBattle` or
into each of its seven existing wave-3 callers — a real design fork, see
handoff §3).

**Read handoff §2.6-2.7 before you design any choice.** Wave 3 built a
load-bearing rule (stash continuation state in `data`, never trust
`RESOLVE_PENDING_EFFECT`'s own `targetInstanceId`/`zoneId`) and discovered
that per-card targeting UI is usually unnecessary — the existing choice
dialog already renders whatever `enemyVehicleOptions` or a similar factory
hands it. Both will save you time on Iron Cordon and Sacrilego specifically.

## How to proceed

This wave adds a new dispatch point and reads/writes `ActiveBattle` — so it
needs design agreement before code:

1. **Brainstorm the design with the owner.** In particular: where exactly
   `onBattleEffect` fires relative to `DECIDE_BATTLE_REPORT`'s existing death
   triggers, how Terawatt's hook attaches to seven already-shipped call sites,
   and what shape Buzzsaw/Veles's conditional opt-out takes next to the
   existing unconditional Stealthy one.
2. Amend the spec wherever your design departs from §4.3's DP2 row, and get
   sign-off — wave 3 amended §4.3 four times this way (see its "four
   departures" subsection) and that precedent is what makes this handoff
   possible to write accurately. Follow it rather than leaving the spec
   describing something you didn't build.
3. Write an implementation plan to
   `docs/superpowers/plans/YYYY-MM-DD-effect-coverage-wave-4.md` and get
   sign-off before implementing. **Read handoff §6 first and decide your
   process before you write the plan** — which tasks get dedicated review,
   whether the plan inlines code, how you'll demand mutation-tested teeth
   checks. Wave 3's calibration (expand review to anything touching
   `pendingEffect`/`ActiveBattle`, keep the plan free of inlined bodies, keep
   reports terse) is the starting point, not a fixed answer.

Work on a branch off `main`. The owner reviews via PR rather than local merges.

## Deploying

`docs/claude/supabase.md` carries the runbook. Three things wave 2 and wave 3
both learned the hard way, all now in it:

- **Check for live games already holding a name you're about to register**,
  before deploying — a game's `meta` is frozen, but the name-to-implementation
  mapping is shared code, so an in-flight game can start running your new
  effect the instant you deploy.
- **Apply the seed first, then deploy `game-action`.**
- **Rebase or merge `main` before you deploy.** A deploy ships your whole
  branch state, not just your diff.

Smoke-test with a wave-3 card that mints without suspending (Flying Squirrel
Attack) and one that suspends and then mints (Air Strafe against a player
design) before you trust that anything works in production — see handoff §5:
wave 3's own live deploy and smoke test had not run as of this writing, and
its final whole-branch review hadn't either. Both are open items you inherit,
not settled ground.

## Finishing the wave — not optional

Wave 5 depends on you, and will know only what you write down. Before you call
wave 4 done: amend the spec where reality diverged, promote durable lessons
into `docs/claude/*` (effects → `card-effects.md`, engine → `architecture.md`,
deploy → `supabase.md`, test traps → `testing.md`), update `KNOWN_GAPS`/
`PARTIAL` if your work closes or moves a card, regenerate
`supabase/seed/seed_data.sql` and commit it with the docs, and **write wave
5's handoff and kickoff prompt in the same shape as these two**.

Handoff §6 records where wave 3's real findings actually came from, measured
honestly, including which reviews returned nothing. The one process element
it tells you not to cut is this step.
