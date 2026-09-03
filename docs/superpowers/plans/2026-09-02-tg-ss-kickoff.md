# 2026-09-02 balance pass — kickoff for TG then SS

Hand this to the agent finishing the pass. It covers **both remaining waves** and
the order to run them in. The author of this document verified every claim in
"State of `main`" against the repo — you can trust those numbers without
re-deriving them, but re-run the baseline once before you start.

---

## Your task, in order

Run **TG first, then SS.** Sequentially, not in parallel.

| # | Wave | Plan | Tasks | Shape |
|---|---|---|---|---|
| 1 | TG | `docs/superpowers/plans/2026-09-02-wave-4-tg.md` | 10 | 21 cards, 8 effects |
| 2 | SS | `docs/superpowers/plans/2026-09-02-wave-5-ss.md` | 26 | 26 cards, 17 effects, **2 new engine mechanics** |

Binding authority is the spec: `docs/superpowers/specs/2026-09-02-balance-pass-design.md`.
Read it before the plans. Where a plan and the spec disagree, the spec wins; where
**this kickoff** and either disagree, this kickoff wins — it is newer than both and
its claims were checked against the merged code.

Use **superpowers:subagent-driven-development** for each wave. Each gets its own
branch off `main` and its own PR.

**Why sequential:** the two waves are independent in code, but every branch
regenerates `supabase/seed/seed_data.sql`, so parallel branches conflict there on
every rebase. Running them back to back avoids resolving that unattended. SS is
also by far the largest piece of the pass and the only one touching engine
internals — it deserves a clean tree.

---

## ⛔ Do not merge. Open PRs and stop.

**Merging to `main` auto-deploys to production** via the Supabase GitHub
integration. The human is away. Your job ends at a green PR with a description;
the merge decision is theirs.

Two PRs, `balance/wave-4-tg` → `main` and `balance/wave-5-ss` → `main`. SS
branches off `main` **as it stands when you start it** — do not wait for TG's PR to
merge, and do not branch SS off TG. If SS then conflicts with TG's unmerged work in
`seed_data.sql`, say so in SS's PR description and leave it; the human resolves
merge order.

End PR descriptions with:
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`

End commit messages with:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## State of `main` — verified, not assumed

Wave 0 and the DWG/OW/WF waves are all merged (PRs #44, #46, #47, #48).

```bash
git checkout main; git pull
npx vitest run    # expect 1384 passing / 46 files
```

If that number differs, stop and find out why before writing code.

| Fact | Value |
|---|---|
| Suite baseline | **1384 passing / 46 files** |
| Seeded cards | **161** (TG adds 5 → 166; SS then adds 4 → 170) |
| `KNOWN_GAPS` | **empty**, and must stay empty (spec §1.1) |
| `DELIBERATE_ORPHANS` | **4 entries**; SS adds `victoriaActivate` → 5 |
| `poolEligible()` | exists, `shared/effects/primitives.ts` — use it for any new pool |
| `deployOrder` mechanic | exists: `deployOrderFor()` at `shared/engine/battleDeclare.ts:47`, key in `DATA_EFFECT_KEYS` at `registry.ts:144` |
| `tg.balance.test.ts`, `ss.balance.test.ts` | still 28-line placeholders — each wave replaces its own |

---

## Six process rules — both waves, non-negotiable

Earned the hard way in Wave 0. Each cost real time or shipped a real bug.

1. **An effect and the card that names it MUST land in the same commit.** Effect
   first → G4 fails (a registered name no seeded card mentions is what G4 hunts).
   Seed first → G1/G2 fail and would need a `KNOWN_GAPS` entry the spec forbids.
   Keep TDD ordering inside the task; **run the full `npx vitest run` before
   committing** — a targeted run will not show G4 going red.
2. **Grep the whole repo when you add an exclusion or a gated field, not just
   `shared/`.** Wave 0 scoped a refactor to `shared/` and missed that
   `lobby-action` builds its own `DeckCardInfo` map — the feature shipped
   unenforced server-side through seven task reviews. Also missed two copies in
   `scripts/`. Make behaviour-gating fields **required**, not optional.
3. **Paste command output verbatim; never retype it.** Two Wave 0 reports
   reconstructed a transcript and both invented the same non-existent path. An
   honestly truncated transcript beats a complete reconstructed one.
4. **`npx vitest run supabase/seed/balance` reports 6 files / 35 tests, not 5/5** —
   vitest filters by path substring and sweeps in `balancePass.test.ts`.
5. **Never hand a reviewer the literal string of a prior defect.** Wave 0's
   controller did, the reviewer "found" it where it wasn't, and a fix round was
   wasted. Name the *class* of defect.
6. **If a finding looks wrong, push back with evidence.** A Wave 0 finding was
   correctly withdrawn because an implementer disagreed and proved it. Never
   implement a change you believe is incorrect.

Because the human is away: **rule on ambiguity rather than stopping.** Record every
decision in your ledger as `Ruling: <what> — <why> — <cost if wrong>` and surface
the whole list in each PR description. Stop only for something destructive,
security-sensitive, an outward-facing action, or a plan defect with no non-guessing
path forward.

---

## Wave 1 — TG: what its plan predates

**(a) Anguish's `deployOrder` is already set. Do not re-add it.** WF's wave wrote
`deployOrder: 'first'` into `TG-built-in.js` and removed Anguish from the `EXEMPT`
map in `effectCoverage.test.ts`. Both are done. **TG still owns Anguish's costs** —
`materialCost` 260000 → 200000. The card's own comment says so. Change the cost,
leave the key and the EXEMPT removal alone.

**(b) `supabase/seed/tgFaction.test.ts` is your real guard, not `balancePass.test.ts`.**
`balancePass.test.ts` contains **no TG assertions at all**. `tgFaction.test.ts` is
343 lines pinning all 26 TG cards' costs/keywords/vehicleType, the 26-fresh/30-total
counts, the 8/8/4/3/3 vehicle-type split, and a ten-card upkeep table. Your wave
moves all of it. Your plan works through it task by task with the exact literals —
follow those, and re-derive rather than trust if any disagree with the file.

Expected end state per your plan: counts 26→31 fresh / 30→35 TG; type split ends
8/11/4/3/5; the upkeep table ends at **eight** entries (Horror, Nostalgia and
Alarmed lose `UPKEEP_REQUIRED`; Mania brings it) with recomputed values.

**(c) Mania is not vanilla for upkeep purposes.** Spec §6.4 lists it as a vanilla
card, and it is — no effect — but it carries `UPKEEP_REQUIRED`, so it joins the
upkeep table at 40,500/turn.

**(d) Two rulings your plan recorded — honour them.** `Repurpose`'s "its cost" is
`effectiveMaterialCostOf`, never `effectiveCostInGame` (the latter is play-time-only
and must not reach a deployed hull). `Repurpose`'s "destroy it" **does** fire the
death trigger, unlike WF's Sub Strike removal — and ordering matters, because
`nostalgiaOnDeath` pulls its snapshot back out of the discard.

**(e) Horror needs a second change your plan explains.** Dropping the
`battle.survived` gate is not enough: `horrorBattle` derives its zone from
`findVehicle(card.instanceId)` and returns early when the hull is gone, but the
destruction branch splices it out of `zone.cards` before the resolve dispatch runs.
It needs a fallback to `battle.zoneId` and to `payload.card`.

**(f) Three new TG vehicles need blueprint paths.** `resolveBlueprintPath` derives
`Built In/Neter/TG/<name>`; a mismatch ships a battle file with the vehicle silently
absent. `scripts/verify-blueprint-mapping.mjs` checks this and is **not** part of
`npx vitest run`. It needs the game install path, so if you cannot run it, say so
explicitly in the PR rather than implying it passed.

---

## Wave 2 — SS: what its plan predates

SS is the largest wave and owns both remaining engine mechanics. Its plan is 5,385
lines across 26 tasks and is detailed; these are the corrections on top.

**(a) The zone-cap read sites are 10 across 5 files, not 8.** Both the spec (§4.1)
and your plan say eight. The real reads are:

| File | Lines |
|---|---|
| `shared/engine/heroPowers.ts` | 108, 109 |
| `shared/engine/placement.ts` | 150, 361 |
| `frontend/src/pages/game/BoardZone.tsx` | 122, 175, 178, 185 |
| `frontend/src/pages/game/GameBoardPage.tsx` | 93 |
| `frontend/src/pages/game/laneLayout.ts` | 74 |

Plus 5 import statements. **All ten matter** — `BoardZone.tsx:178` and `:185` are
the tooltip and the `count/limit` label, and a board that says `3/8` while the
engine enforces 5 is lying to the player.

**(b) `slotDenial` must go in `DATA_EFFECT_KEYS`, and there is now an in-repo
precedent.** Tiger Shark has card text, names no effect and carries only that key,
so G2's `silent` check flags it. `deployOrder` (added by WF, `registry.ts:144`) is
the same case and is the pattern to copy.

**(c) `CostModifierFn` still cannot express Tyr — verified.** It is
`(state: PublicGameState, side: Side, card: CardInstance) => number` at
`registry.ts:34`, and `PublicGameState` carries no turn number. Widen the signature
and `effectiveCostInGame`; there are four call sites and all four hold a turn number
already.

**(d) The missing-stamp case is a live-game NaN bug, not a tidy default.** Hands
live in `game_players` rows, outside `PublicGameState` and so outside
`normalizeState`'s reach — every card in every in-flight hand has no
`handEnteredTurn` and never will. `turnNumber - undefined` is `NaN`, and
`Math.max(0, NaN)` is `NaN`, not 0. A NaN price makes Tyr unaffordable and writes
NaN into the payer's materials. Treat a missing stamp as "entered this turn"
explicitly, and pin it with a test built from a stamp-less hand.

**(e) `handEnteredTurn` lands on `ZoneCardEntry` too** (it extends `CardInstance`),
so it must be named in `discardSnapshotOf` at `gameEngine.ts`, whose own comment
says "Every per-entry stamp must be named here. TypeScript does NOT catch one you
forget." Left off, it rides into `state.destroyed` and back into a deck.

**(f) Ten hand-entry sites, and `loggerheadOnDeath` is not one of them.** It pushes
to the owner's **deck**; converting it would stamp a deck card. Derive the list by
grepping `hand.push` at implementation time rather than trusting any document.

**(g) Constants: delete `SACRILEGO_HP_BOOST` only.** It is still present and loses
its last reader when Sacrilego is reworked. **Do NOT touch
`HARBRINGER_GUEST_MAX_COST` or `PURIFIER_LOSS_WINDOW_TURNS`** — spec R-8 keeps both,
they have live readers, and deleting either is a compile error. `MARAUDER_DISCOUNT`
is already gone (DWG did it).

**(h) `DELIBERATE_ORPHANS` is already de-collided.** Wave 0 reformatted the
assertion to one name per line and dropped the hardcoded count from its title; OW
added `bulwarkOnPlay`. Your `victoriaActivate` insertion is clean. Do **not** add
`halberdOnDeath`, `dryadBattle` or `harbringerBattle` — those cards stay seeded and
still name their effects, so they are not orphans and adding them trips the map's
stale-entry assertion.

**(i) Your eight invalidated assertions in `balancePass.test.ts` are all still
there**, verified: `CARDS` rows for Chrysaor, Nothung, Balmung, Asphodel and
Argonaut, plus the `it(...)` blocks for Paladin's surge, Victoria's material price,
and the Double Up / Repairmen Ready text. Update all eight in place.

**(j) SS effects are tested in `shared/effects/factionEffects.test.ts`** — there is
no `ssEffects.test.ts`. `resoluteOnPlay` and `trondheimOnDeath` sit in that file's
`DRAW_ONE` array and must leave it in the same commit that reworks them.

**(k) There is no React component test infrastructure.** `vitest.config.ts`
collects `*.test.ts` and there are zero `.test.tsx`. The frontend half of the
zone-cap change is verifiable only by build, lint and the browser. Do not add a
component test framework.

---

## Standing rules from CLAUDE.md

- **Shell is PowerShell.** No `&&` chaining.
- `npx vitest run` — **never** pass `--root`; it silently runs 0 tests.
- Any `shared/` edit needs `npm run functions:sync` in the same commit.
- Any `supabase/seed/source/` edit needs `npm run seed:build` in the same commit.
- Relative imports inside `shared/` need the `.ts` extension.
- Consumers import `shared/engine/index.ts`, never individual engine modules.
- Effects are keyed by a **unique** registry id; never reuse another card's name.
  Cards sharing behaviour still get separate ids (spec R-6) — this binds TG's
  Agony/Spite pair and SS's Hydra (vs Kraken) and Paladin (vs Victoria's retired
  activate).
- `{ needsCatalog: true }` on any effect reading `ctx.catalog`. **Unit tests cannot
  catch a missing flag** — it is a production-only dead card. Verify against
  `CATALOG_EFFECTS` before closing each wave.
- **Keywords live in TWO files**: `shared/gameSettings.ts` and
  `supabase/seed/source/gameSettings.js`. Adding one to only the first writes
  `null` into jsonb with every guard green. Neither wave adds a keyword — say so
  explicitly. The drift guard is in `tgFaction.test.ts`.
- A card's `name` is immutable — the row uuid derives from it.
- Report the suite's **before→after** passing count, never "tests pass".
- Never type credentials into the sign-in form. For a signed-in browser, run
  `node scripts/qa-login.mjs` then `await window.__qaLogin()` in the page.

## When both are done

Post both PR links, each with: the before→after test counts, every `Ruling:` line
from that wave's ledger, the deferred minors, and anything you could not verify
(the blueprint mapping check, and SS's frontend rendering). Then stop.

The pass is complete when both merge. After SS lands, the spec's §7.3 close-out
asks for one last thing: confirm `KNOWN_GAPS` is still empty and list any spec
effect still unimplemented, rather than declaring the pass complete.
