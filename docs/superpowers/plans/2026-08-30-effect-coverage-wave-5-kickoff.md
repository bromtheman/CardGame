# FTD Card Game — Effect Coverage Wave 5

You're picking up work on the FTD Card Game, a turn-based companion app for the
game From The Depths. Repo: https://github.com/bromtheman/CardGame

**You are doing wave 5: the rest-of-turn riders (DP5) — and it is the last
wave.** After it, all 65 cards named in the spec are built.

## Read these first, in this order

1. `CLAUDE.md` — the project's hard rules.
2. **`docs/superpowers/plans/2026-08-30-effect-coverage-wave-5-handoff.md`** —
   your primary briefing. It is the accumulated knowledge of waves 0–4: what
   exists, what wave 5 owns, the machinery wave 4 finished that two of your
   cards sit directly on, eight traps, and what wave 4 did not verify. Read all
   of it.
3. `docs/superpowers/specs/2026-08-27-effect-coverage-design.md` — **binding**.
   Game rules come from it, not from guesswork. §4.3's DP5 row is your dispatch
   point, §8's wave-5 table is your card list, and §4.2 departure 4 is the
   alert-card decision that has now been narrowed twice to reach only your
   cards. Read §4.3's eleven recorded departures (four for DP3/DP6, seven for
   DP2) before touching a battle or a rider — they show how a departure gets
   recorded, which is a thing you will be doing.
4. `docs/claude/architecture.md`, `card-effects.md`, `supabase.md` and
   `testing.md` — read the ones matching the work in front of you. All four
   were updated at the close of wave 4.

The handoff's §7 ("Before you start") is a checklist. Do it before writing code.

## Verify the state before trusting any of it

```bash
npx vitest run
```

Expect **655 passing, 32 files**. Never pass `--root` — it silently runs 0
tests. If your numbers disagree with the handoff's, believe your own run and
say so.

`KNOWN_GAPS` in `supabase/seed/effectCoverage.test.ts` is down to **5 entries,
all wave 5** — your whole card list. `PARTIAL` is **empty**: wave 4 closed both
of its entries. Both maps are asserted over, and the wave assertion loops waves
1–4 across both, so a reopened entry fails the build.

**Regenerate `supabase/seed/seed_data.sql` (`npm run seed:build`) after every
commit that touches a card's `meta`.** It is a tracked, generated file;
`seedDataSync.test.ts` fails on drift.

## The shape of wave 5

Five cards — Ambush, Ongoing Attrition, Sub Killer, Recurring Threat, Sabotage
— plus one decision the spec has deferred to you twice.

**Recurring Threat is very nearly already built.** It is a permanent
`zoneEffect` offering a battle summon in defensive battles in its zone —
structurally identical to DWG Waters' clause 2, which wave 4 shipped. Read
`dwgWatersEffect` in `shared/effects/dwgEffects.ts` end to end before writing a
line: the one-registry-name-many-occasions shape, the `zoneEffects` rider
dispatch, and `joinBattle` are all there. The genuinely new part is storing
*which* destroyed vehicle the marker remembers, and `ZoneEffect` carries no
field for it — which makes it a `PublicGameState` change, with everything that
implies.

**DP5 itself is a real design fork, and it is your first job.** Spec §4.3's DP5
row predicts the riders extend `state.scheduled[]`, which already carries
`side` and `dueTurn` and is already processed in `endTurn`. Sabotage fits that
exactly. Ambush and Ongoing Attrition may not — both are *zone* riders that
change how a battle resolves, and `state.zoneEffects` may be their real home,
with `scheduled` carrying only the "unused at turn end → draw" tail. Decide,
and amend the spec either way. Ambush also writes `ActiveBattle.distanceM` /
`distanceModifiedBy`, which today only Tactical Positioning touches — read
`heroPowers.ts` before assuming that field is free.

**The second deferred decision is the alert card** (decision 3). Waves 2, 3 and
4 each narrowed it, and it now reaches *only* your riders: a forced battle
raises the `BattleOverlay`, a choice writes public `pendingEffect`, but a rider
planted on the opponent's next battle announces itself nowhere. Build it or
narrow it out of existence — but decide, and record it.

**Read handoff §2.6 and §4.3 before you design any choice or read
`state.destroyed`.** Wave 4 changed `choice()` so a second offer in one action
is dropped rather than overwriting, which means an unconditional clause must
come *before* the choice that may not fire. And `state.destroyed` is a live
reservoir, not a log — a death trigger's draw can empty it out from under you.
Both cost wave 4 a fix round.

## How to proceed

1. **Brainstorm the design with the owner**, in particular the two deferred
   decisions above, and how Recurring Threat stores its remembered vehicle.
2. Amend the spec wherever your design departs from §4.3's DP5 row, and get
   sign-off. Wave 4 amended §4.3 seven times and §7.3 six times; that precedent
   is what makes these handoffs possible to write accurately.
3. Write an implementation plan to
   `docs/superpowers/plans/YYYY-MM-DD-effect-coverage-wave-5.md` and get
   sign-off before implementing. **Read handoff §6 first and decide your
   process before you write the plan.** Wave 4's calibration: dedicated review
   for every task touching a freeze-adjacent field (four for four returned
   real findings), no inlined code in the plan (15% of the diff, down from
   22%), and treat a *surviving* mutation as a finding in its own right.

Work on a branch off `main`. The owner reviews via PR rather than local merges.

## Deploying

`docs/claude/supabase.md` carries the runbook, and every rule in it was learned
the hard way:

- **Deploy with `node scripts/deploy-function.mjs game-action`, NOT the
  `deploy_edge_function` MCP tool** — its 23-file, ~161 KB payload gets
  silently truncated, and a partial payload deletes every file it omits.
- **Apply the seed first, then deploy `game-action`.**
- **Rebase or merge `main` before you deploy** — a deploy ships your whole
  branch state, not just your diff.
- **Check for live games already holding a name you're about to register.**
- **Verify by content, not file count**: type-only imports are erased in
  transpilation, so a good deploy legitimately reads back with fewer modules.

`game-action`'s catalog probe now has **four** sources. If you invent a
dispatch point that fires an effect for a card in neither hand nor field, it
needs a fifth — that has now happened twice, and both times the symptom was a
card that silently did nothing in production while every test stayed green.

## Finishing the wave — not optional

You are the last wave, so there is no wave 6 handoff to write. There is
something else the spec is owed instead: **a final accounting.** Before you
call wave 5 done — amend the spec where reality diverged, promote durable
lessons into `docs/claude/*`, empty `KNOWN_GAPS`, regenerate
`supabase/seed/seed_data.sql`, and then write a close-out that answers, card by
card against §8's tables: which of the 65 are built, which of the spec's
rulings reality contradicted, and what remains unbuilt or unverified.

Handoff §6 records where wave 4's real findings actually came from, measured
honestly. The one process element it tells you not to cut is this step.
