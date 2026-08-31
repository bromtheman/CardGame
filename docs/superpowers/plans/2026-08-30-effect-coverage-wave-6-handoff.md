# Wave 6 — the balance pass's twelve cards

Written after wave 5 closed the effect-coverage spec, for whoever builds wave 6.

Waves 0–5 closed the 65 cards of
`docs/superpowers/specs/2026-08-27-effect-coverage-design.md`. Wave 6 is not
that spec: the **2026-08-30 balance pass** (PR #22) added eleven new cards,
retired Rhea and reworked nine more, and it was deliberately scoped to seed the
cards and leave their behaviour alone. It recorded all twelve of the resulting
gaps in `KNOWN_GAPS` under `balance 2026-08-30`, each with the mechanic it
needs named in a comment. **That map is the wave-6 backlog, and it is the
authority — not this document.**

Everything below was verified against the code at commit `0f25e83`. Where this
document and the code disagree, the code is right and this document should be
corrected. Wave 5 had to correct its predecessor twice, and then got something
wrong itself (see §7).

---

## 1. Where things stand

Run this yourself before touching anything.

```bash
npx vitest run                      # 780 passed / 33 files, 0 failed  ← NEVER pass --root
npx tsc -p tsconfig.json --noEmit   # exit 0
npm --prefix frontend run build     # exit 0
npm --prefix frontend run lint      # exit 0, 7 pre-existing warnings across 5 files
```

The 7 lint warnings are the same set waves 2–5 all inherited. Count them; do
not copy "7" from here.

| Map | Count | Contents |
|---|---:|---|
| `KNOWN_GAPS` | **12** | all `balance 2026-08-30` — your backlog |
| `PARTIAL` | 0 | empty, still asserted |
| `EXEMPT` | 1 | Falcon Squadron, permanently |

`expect(Object.keys(KNOWN_GAPS)).toHaveLength(12)` is what stops a thirteenth
being added quietly. **Delete an entry and decrement that literal in the same
commit that makes its card work** — closing a card without deleting its entry
fails the build, by design.

`supabase/seed/balancePass.test.ts` (new in the balance pass) pins every
printed cost, keyword and threshold that pass moved. Nothing else in the suite
reads those numbers, so if you change a cost, that is the file that will tell
you.

**Five of the twelve carry `meta: {}`** — Albacore, Tarpon, Chrysaor, Paladin,
Purifier. Wave 6 authors their meta as well as their behaviour, which means
`npm run seed:build` is **not optional** for those five (guard blind spot 4).
The other seven already name an effect.

---

## 2. The twelve, grouped by what they actually need

Read each card's `cardText` from the seed source before building it. The
summaries here are a map, not the territory — **card text is authoritative**
(spec decision 1), and every wave so far has found at least one place where a
summary drifted from the card.

### Group A — one-liners over primitives that already exist (4)

Nothing new in the engine. Do these first: they are a day's work between them
and they close a third of the backlog.

| Card | Key (already seeded) | Build |
|---|---|---|
| **WF Basher** | `onDeathEffect: basherOnDeath` | `grant({ draw: 1 })`. Check decision 2 first — a built-in must not carry both `SCRAPPY` and an `onDeathEffect`; Basher prints no keywords, so it is clear |
| **SS Nothung** | `onPlayEffect: nothungOnPlay` | `spawnVehicles({ cardName: 'Sacrilego', count: 1, zones: 'target' })`, `{ needsCatalog: true }` |
| **SS Balmung** | `onPlayEffect: balmungOnPlay` | mint a Hydra into hand from the catalog and zero its price. `{ needsCatalog: true }` |
| **WF Harbringer** | `onBattleEffect: harbringerBattle` | DWG Waters' clause 2, on a participant instead of a rider: at lock, offer a WF ship ≤100k, `summonHulls` + `joinBattle`. `{ needsCatalog: true }` |

Three rulings this group needs:

- **Nothung's spawned Sacrilego keeps its own battle trigger.** Spawning is not
  playing (§7.4) — that rule skips `onPlayEffect`, and nothing else. Sacrilego
  prints `onBattleEffect: sacrilegoBattle`, and a spawned hull carries its
  printed meta, so it *will* fire at resolve. That is almost certainly intended
  (it is why the card names Sacrilego rather than a vanilla hull), but say so
  out loud rather than discovering it in a battle report.
- **"Reduce its cost to zero" is a price, not a rewrite.** Use
  `costDelta: -hydra.materialCost` (§4.5), not a minted `materialCost: 0`.
  `costDelta` never reaches `effectiveMaterialCostOf`, so the free Hydra still
  does its printed base damage and still costs its printed repair — which is
  what "reduce its **cost**" says. Minting at zero would silently make it
  harmless as well as free. `loggerheadOnDeath` does mint at zero, and is not
  the precedent to copy here: its copy goes into a **deck**, where nothing but
  the price ever reads that number.
- **Harbringer is a participant, not a rider**, so it needs no `zoneEffects`
  entry and no rider dispatch — DP2's lock pass already reaches participants on
  both sides. "Whenever this ship is in fleet combat" reads to both offensive
  and defensive battles, and (per §7.3's Catshark ruling) to forced ones.

Two pools worth knowing before you build against them, both counted at
`0f25e83`: Harbringer's is exactly **two** cards — Buzzsaw (80k) and Earth
Raker (50k) — so an empty-pool path is unreachable today and a filter typo
would be invisible; pin the membership. Balmung's Hydra is an SS airship at
**230k**, so a free one is a 230k hull for nothing and its `costDelta` is
`-230000`.

### Group B — small extensions to existing machinery (4)

| Card | Needs | Precedent to extend |
|---|---|---|
| **WF Judgement** | a `costModifier` reading the **enemy's** hull types, plus a 1v1 activated battle | `CostModifierFn` already takes `(state, side, card)`, so it can scan the other side's zones. The activated half is Braveheart with a `vehicleType` filter — `enemyVehicleOptions` already takes one. **Seed `activateCpCost: 1`**: its text says "pay 1cp", and without that key it has no activated ability at all |
| **SS Victoria** | an activated ability paid in **materials** | `ACTIVATE_VEHICLE` charges `meta.activateCpCost` and refuses a card without it. Needs a sibling `activateMaterialCost`, charged the same way |
| **SS Chrysaor** | a `resourceSurge` that **raises** the price | `ResourceSurge` is `{ materialsOver, materialsAtLeast, extraSpawns }` and today only ever *suppresses* Half-Cost. Chrysaor prints no Half-Cost, so the existing shape does nothing to its price; it needs a delta |
| **SS Paladin** | a below-threshold surge that **grants** `halfCost` + `temporary` | The inverse condition (`materialsUnder`) and the inverse action. §4.6 says a surge is "pricing only — hulls keep their printed keywords"; Paladin needs a keyword on the **hull**, so it departs from that and the departure has to be recorded |

Two traps in this group:

- ⚠ **`BoardZone.tsx` gates the board's "use" button on `activateCpCost` being
  a number.** Give Victoria `activateMaterialCost` and nothing else and it will
  have a working ability with no way to press it — the silent-pair trap
  `card-effects.md` already warns about, in a new costume. Whatever you add,
  add it to that gate too.
- ⚠ **Both play handlers read the surge *before* `pay()`**
  (`const surged = halfCostSuppressed(...)`), because paying moves the
  materials that the condition reads. Any new surge field has to be read at the
  same point, or Chrysaor's own cost will flip its own condition off.

### Group C — genuinely new mechanics (4)

These are the wave. Budget accordingly, and consider shipping Groups A and B
first so the backlog is visibly moving.

**DWG Albacore + DWG Tarpon** — *"While this vehicle is alive, you may not play
any other aircraft into this zone."* One rule, two cards, both `meta: {}`.

A placement restriction sourced from a **hull on the board**. `legalZonesFor`
already hosts the shape: `screenBlocks` reads the *enemy's* `AIR_SCREEN` and
refuses your planes and airships. Wave 5's `riderBlocks` is the other half of
the precedent — a rule read off `data`, not off an effect name, so the next
card wanting it needs no engine edit. Do the same here with a seeded data key
(`aircraftLock`), add it to `DATA_EFFECT_KEYS` so G2 closes the card with no
registry name at all, and pin its **value** with a seed-backed assertion
(blind spot 4 — presence is checked, value is not).

Two rulings before you write a line:

- **Whose aircraft?** The text says "**you** may not play", which reads as the
  owner restricting themselves — a drawback on a Fragile hull, not a weapon.
  That is the opposite of `AIR_SCREEN`, which restricts the enemy, and the two
  will sit side by side in the same function. Decide, and write the reason
  down.
- **"Any OTHER aircraft"** — the hull does not block itself, but a *second*
  Albacore into the same zone is exactly what it blocks. Note that
  `additionalSpawns` copies and summons bypass placement legality entirely
  (§7.4), so the rule reaches plays and nothing else.

**WF Purifier** — *"This ship can only be played into a zone in which you have
lost a fleet battle the previous turn. This vehicle does no damage to the enemy
base."* `meta: {}`; two clauses, two mechanisms.

- The deploy prerequisite needs **new state**: per-zone, per-side, "you lost a
  fleet battle here, on which turn". `DECIDE_BATTLE_REPORT` already computes
  `outcome.wonBy` for both sides, so the recording point exists; the question
  is where it lives and how it is defaulted (`normalizeState` **and**
  `buildInitialGame` — both halves, always). Then `legalZonesFor` reads it.
  ⚠ **"The previous turn" needs a ruling**, and the turn counter is in half
  steps: the previous half-turn is the *opponent's*, and a battle you lost on
  your own last turn is a full 1.0 back. Pick one, and pick it against the
  fiction ("your wreckage is still there") rather than against whichever is
  easier to compute.
- "Does no damage to the enemy base" is a `baseStrikersIn` exclusion. That
  filter already drops subs, `INOFFENSIVE` hulls and freshly-deployed ones.
  `INOFFENSIVE` is too strong to reuse — it also means "cannot attack a fleet",
  which Purifier can. Another seeded data key, another value to pin.

**SS Blockade** — *"Choose a zone, whenever the opponent plays a vehicle into
that zone while you have at least one vehicle there, a fleet battle immediately
begins in that zone. If you lose with no surviving vehicles, the blockade goes
away, otherwise it remains."* The biggest card in the backlog, and **the only
one that needs a new dispatch point.**

The balance pass already made one decision for you and it is a good one: its
`ON_BATTLE_DEFEAT` key was dropped, because an ability is `spendCard`'d on
resolution and never enters `zone.cards`, so **no battle trigger can ever reach
one**. Its clauses ride its `playOnZoneEffect` name through `state.zoneEffects`
— the DWG Waters shape, one registry name serving every occasion, told apart by
the payload. Wave 5's four riders are four more worked examples.

What is new — call it **DP7**: a zone rider that fires when the **opponent
deploys into the zone**. Every existing rider dispatch hangs off a battle
(`dispatchBattleLock`), a bombardment (`dispatchZoneActivation`,
`dispatchZoneInterception`) or the turn end (`turnEndRiders`); none fires on a
play. `PLAY_CARD_TO_ZONE` is the seam, and **`PLAY_CARD_TARGETING_CARD_IN_HAND`
is the second one** — it deploys vehicles too (`deployVehicle` is shared), and
a dispatch added to only one of them is a card that works until someone plays
Excalibur.

Five things to settle before building it:

1. **Who is the aggressor?** The blockader sprang the trap, but the deployer is
   the active player. `battle.aggressor` decides `isDefender` for every DP2
   trigger in that battle, so this is not cosmetic.
2. **Which hulls fight?** "A fleet battle begins in that zone" — everything on
   both sides, or only the hull just played? The text says a *fleet* battle.
3. **`declareForcedBattle` refuses while `state.activeBattle` is non-null**, and
   it validates that every listed id is on the board on its own side. The hull
   that triggered this is on the board by then — `deployVehicle` runs before
   effects — but check the ordering rather than assuming it.
4. **The removal condition needs the battle's outcome**, which is not known
   until `DECIDE_BATTLE_REPORT`. That is exactly what `ActiveBattle.continuation`
   is for (§4.3, departure 3); Trebuchet and DWG Waters' clause 3 are the two
   worked examples. "Lose with no surviving vehicles" is `!survived`-shaped, but
   read `battle.won`/`survived` off the context you are handed rather than
   re-deriving from a roster you stashed at declare time — that exact mistake
   cost wave 4 a fix round.
5. **This is the first battle declared for the player who is not acting.** The
   freeze rules should hold (`applyAction` checks `pendingEffect` first, then
   `battleFrozen`), and `battleFreeze.test.ts` pins the whole sweep — but that
   suite asserts its coverage over `knownActionTypes()`, so if you add an
   action type it fails until you decide how it behaves under both freezes.

---

## 3. What wave 6 does NOT need

Worth stating, because two of these look like work and are not:

- **No new trigger key.** Blockade rides `playOnZoneEffect` (already in G3's
  `ability` row); everything else uses keys the engine already dispatches. So
  `REACHABLE_TRIGGERS` needs no row — the trap that bit waves 2, 3 and 4 does
  not bite this one. Verify that claim before relying on it.
- **No new catalog-probe source.** All four existing sources still cover these
  cards. But ⚠ **any rider dispatched out of `state.zoneEffects` needs
  `{ needsCatalog: true }` even if it reads no catalog** — `fireRider` mints the
  rider's payload card from `ctx.catalog` by `cardName`. Blockade needs the
  flag. Wave 5's own plan got this wrong and the implementation caught it;
  `factionEffects.test.ts` asserts the flag at runtime, which is the only way to
  test one.

---

## 4. Traps, still true

Every one of these bit a previous wave. The full list lives in
`docs/claude/card-effects.md` and `testing.md`; these are the ones this backlog
is most likely to walk into.

1. **`npm run seed:build` after every commit that touches a card's `meta`** —
   five of your twelve start with empty meta. `seedDataSync.test.ts` catches a
   stale SQL, but only if you run the suite.
2. **`npm run functions:sync` in the same commit as every `shared/` change**, and
   a new file also needs a side-effect import in `shared/engine/index.ts` **and**
   a `supabase/functions/shared-manifest.json` entry.
3. **A data key's VALUE is never checked, only its presence.** You are adding at
   least three (`aircraftLock`, Purifier's two). Each needs a seed-backed
   assertion — `battleDeclare.test.ts`'s `defensiveOmission` case is the worked
   example.
4. **`{ needsCatalog: true }` is invisible to unit tests.** `makeCtx` hands every
   test a catalog. Assert `CATALOG_EFFECTS` membership at runtime.
5. **After `git checkout --` on a `shared/` file, re-run `functions:sync`** —
   `core.autocrlf` makes the drift test fail on a tree `git diff` calls clean.
   Bites mutation testing hardest.
6. **A new `PublicGameState` field needs both halves**: a `normalizeState`
   default *and* an initial value in `buildInitialGame`. Purifier's battle-loss
   record is one; anything Blockade stores is another.
7. **Never use a real seeded effect name as an "unimplemented" test stand-in** —
   use a `t_` prefix. Wave 5 cleared the last two offenders; do not add more.
8. **Deploys are automatic on merge to `main`.** For an out-of-band deploy use
   `npm run functions:deploy -- game-action`, never the MCP tool, and verify by
   **content** rather than file count.

---

## 5. Verification this wave should not skip

`scripts/smoke-wave5.mjs` is a **reusable harness**, and wave 6 should reuse it
rather than write a third one. It takes a spec — `{ p1Faction, p1Required,
p2Faction, p2Required }` — signs in both QA accounts, builds two legal decks,
starts a game and drives the real deployed `game-action`. Point it at your own
cards and it does the staging.

Three things it already knows that a fresh harness would have to relearn:

- **`ATTACK_ENEMY_FLEET` does not always lock the battle.** A Stealthy or
  omissible defender raises the response window instead, and the lock — with it
  DP2's whole dispatch — happens on `RESPOND_TO_ATTACK`. Wave 5's harness passed
  and then failed on identical code because one deal handed out a Corsair and
  the next an Abactor. `lockIfPending` is the fix.
- **Staging spans turns.** Income is *set* to `floor(turnNumber) × 75k` at each
  turn start, so two hulls cannot be deployed on one turn's budget.
- **`read_console_messages` returns a cumulative buffer** that survives
  navigation and `console.clear()`. Confirm a frontend fix in a **fresh tab**,
  or pre-fix errors will read as a fix that did not work.

Blockade in particular deserves a live pass: a battle declared for the
non-acting player, out of a play handler, is a shape nothing in production has
done before.

---

## 6. Suggested order

1. **Group A** (Basher, Nothung, Balmung, Harbringer) — four cards, no engine
   work, `KNOWN_GAPS` 12 → 8.
2. **Group B** (Judgement, Victoria, Chrysaor, Paladin) — small, contained
   extensions; 8 → 4. Judgement is nearly Group A once `activateCpCost: 1` is
   seeded.
3. **Albacore + Tarpon** — one rule, two cards, one ruling; 4 → 2.
4. **Purifier** — new per-zone state; 2 → 1.
5. **Blockade** — DP7; 1 → 0.

Each step leaves the build green and the backlog visibly smaller, and the two
hardest cards are the ones with the most machinery already proven underneath
them by the time you reach them.

---

## 7. The thing wave 5 got wrong, because it is the thing to avoid

Wave 5's close-out reported these twelve cards as "seven built-in cards the repo
has never seen", called it the guard's widest blind spot, and speculated that
something predating the seed pipeline had inserted them. All of that was wrong.
They were in a branch, under review, seeded on purpose, with every gap already
listed in `KNOWN_GAPS` and annotated with the mechanic it needed.

The mistake was not carelessness about the code — it was searching **one
branch** and drawing a conclusion about the repository. `git log -S` found
nothing because the commit was not an ancestor of the branch it ran on.

So: **a difference between your checkout and production is a question, not a
finding.** One command answers it before it becomes a paragraph:

```bash
git fetch --all && git log --all --oneline -S'<the name you cannot explain>'
```

Wave 5 also left a genuine, narrower version of that observation standing, and
it is still open: nothing compares the generated `seed_data.sql` to the live
`cards` table. If wave 6 wants a cheap win beyond its twelve cards, that is the
guard's sixth blind spot and a test could close it.
