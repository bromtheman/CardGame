# Effect coverage — wave 4 handoff

Written at the close of wave 3 for whoever picks up wave 4. Wave 3 built forced
battles, battle summons and a battle continuation — three cards you own
(Terawatt, The Onyx Throne, and indirectly Iron Cordon) sit directly on top of
that machinery, so §2 below is not background reading.

Everything below was verified against the code at the wave-3 tip. Where a
document and the code disagreed, this handoff (or the wave-3 doc pass that
produced it) corrected the document — three of `docs/claude/*`'s corrections
this round were disproving claims a prior handoff or doc had stated as fact.
Take that as a standing warning, not just history: verify what you read here
against the code too, and correct this doc if wave 4 finds it wrong.

**Binding authority:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`.
§4.3's DP2 row is your dispatch point, §4.4 is battle summons (already built —
read it for the vocabulary), §8's wave-4 table is your card list. Read §4.2
(all five departures) and §4.3 (all four) before touching a battle or a choice.

---

## 1. Where things stand

Run this yourself before you touch anything; do not trust the numbers below if
they disagree with your own run.

```bash
npx vitest run                      # 521 passed / 30 files, 0 failed  ← NEVER pass --root
npx tsc -p tsconfig.json --noEmit   # exit 0
npm --prefix frontend run build     # exit 0
npm --prefix frontend run lint      # exit 0, with 7 pre-existing warnings across 5 files
```

These are my own measured numbers, taken at the close of wave 3 — **after** its
final whole-branch review, the fix wave that followed it, the merge of PR #15
(`c426eb9`), and the live deploy. An earlier draft of this section said
514 / 29; that was written before the final review, whose fix wave added 7
tests and one new file (`supabase/seed/seedDataSync.test.ts`). If your own run
disagrees with 521 / 30, believe your run and say so. The 7 lint warnings
(`react(set-state-in-effect)` ×5, `react(only-export-components)` ×2, in
`auth.tsx`, `ConfirmDialog.tsx`, `CardDetailsModal.tsx`, `CreateCardPage.tsx`,
`HandBar.tsx`) are the same pre-existing set wave 3 inherited from wave 2 —
still unchanged, still not yours to chase. Count them yourself; do not repeat
"7" from this doc without counting.

### The coverage guard (`supabase/seed/effectCoverage.test.ts`)

| | Count | Contents |
|---|---:|---|
| `KNOWN_GAPS` | **13** | 8 wave 4, 5 wave 5 |
| `PARTIAL` | **2** | Plunderer, DWG Waters — both wave 4 |
| `EXEMPT` | 1 | Falcon Squadron, permanently |

Waves 1, 2 and 3 are fully closed; a test asserts no `wave 1`/`wave 2`/`wave 3`
label remains, and a second asserts `KNOWN_GAPS` has exactly 13 keys. **Both
the map entry and the `toHaveLength(13)` literal move in the same commit that
registers a name** — closing a card without deleting its entry fails the
build.

**`seed_data.sql` is a tracked, generated file — regenerate it before you
commit any card, every time.** `npm run seed:build` reads `source/*.js` and
writes `seed_data.sql`; nothing in the suite compares them, because
`loadSeedData()` reads `source/*.js` too. Wave 3 shipped nine cards across six
tasks and never regenerated the SQL until its own docs task caught it — see
blind spot 4 in §4 below. Grep the regenerated file for your effect names
before you commit, the same way wave 3's Task 12 did.

---

## 2. What wave 3 built that you are standing on

### 2.1 DP3 — `declareForcedBattle` (`shared/engine/battleDeclare.ts`)

```ts
declareForcedBattle(game: EngineGame, spec: {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  summons?: ZoneCardEntry[]
  continuation?: BattleContinuation | null
  cause: string            // card name, for the log line
  activatesZone?: boolean  // stamps lastActivatedTurn; Eclipse alone passes true
}): boolean
```

It refuses (returns `false`) on: no such zone, a battle already active, an
empty attacker or defender list, or an id that is neither an on-field entry on
its own side nor one of the listed `summons`. It skips the Stealthy opt-out
(the card *forces* the fight) and, unless you pass `activatesZone: true`,
neither reads nor writes `zone.lastActivatedTurn` — **a forced battle is not a
zone activation**, ruled in spec §4.3, and this is already handled correctly.
You do not need to re-litigate or re-fix this: `battleDeclare.ts` splits into
`setBattle` (the one literal that constructs `ActiveBattle` — a future field
is one edit), `lockBattle` (`setBattle` + the stamp + the "Fleet battle" log
line, used only by `ATTACK_ENEMY_FLEET`/`RESPOND_TO_ATTACK`), and
`declareForcedBattle` (`setBattle` + its own log line naming the cause). Seven
wave-3 effects already call it correctly — read any of them
(`shared/effects/ssEffects.ts`'s `BRAVEHEART` is the shortest) before you write
your own call.

Terawatt is the card in your wave that has to reckon with this function most
directly — see §3 below.

### 2.2 Battle summons — `ActiveBattle.summons: ZoneCardEntry[]`

Combatants that exist only for one battle: never pushed to `zone.cards`, and
evaporate on report approval regardless of ending HP — no repair eligibility,
no death record, nothing sent to `state.destroyed` (spec §4.4). `mintHull` /
`summonHulls` (`shared/effects/primitives.ts`) build them:

```ts
mintHull(game, ctx, snapshot, keywords?): ZoneCardEntry
summonHulls(game, ctx, cardName, count, keywords?): ZoneCardEntry[] | null
```

`summonHulls` looks `cardName` up in `ctx.catalog` and returns `null` if it
isn't there — so any effect calling it needs `{ needsCatalog: true }` on its
`registerEffect`, same as any other catalog read (§4.4 in the wave-3-era
traps below). `participantsOf` (`shared/engine/battleResolve.ts`, and its
mirror in `BattleOverlay.tsx`) already merges `summons` with on-field entries,
so reporting, the spawn sheet and approval treat both uniformly. **This is
built and correct — you are extending its customer list, not its mechanism.**

**A summon carries no side field.** Membership decides it: an id in
`attackerIds` belongs to the aggressor, one in `defenderIds` to the defender.
This was designed for you: **The Onyx Throne's defender-side Parapet works
unchanged** — no new field, no side-tagging mechanism to add, no change to
`participantsOf`. One caution, though: DP2 fires "at lock," which means an
`ActiveBattle` already exists by the time Onyx Throne's trigger runs (locked
by whatever declared the battle — an ordinary fleet attack, or another card's
`declareForcedBattle`). **Don't call `declareForcedBattle` from inside it** —
that function refuses outright when `game.state.activeBattle` is already
non-null (`shared/engine/battleDeclare.ts:71`), which it will be. Mutate the
existing battle directly instead: push the minted Parapet's `ZoneCardEntry`
onto `game.state.activeBattle.summons` and its `instanceId` onto
`.defenderIds` (since it's joining the defending side). That mutation is new
code DP2 needs regardless of Onyx Throne — `setBattle`/`lockBattle`/
`declareForcedBattle` only ever set these fields at construction today,
nothing yet appends to a battle already in progress.

### 2.3 `ActiveBattle.continuation` — where a battle wait lives

```ts
interface BattleContinuation {
  effect: string                    // registry name to re-enter when the battle resolves
  side: Side
  card: CardInstance
  data?: Record<string, unknown>    // effect-owned continuation state
}
```

Spec §4.2 originally predicted a `kind: 'battle'` value on `pendingEffect`
itself. Wave 3 found that cannot work — `pendingEffect !== null` freezes the
game to `PENDING_ACTIONS`, which admits neither `SUBMIT_BATTLE_REPORT` nor
`DECIDE_BATTLE_REPORT`, so a battle declared under that freeze could never be
reported — and built `ActiveBattle.continuation` instead. It cannot outlive
its battle, because `DECIDE_BATTLE_REPORT` already nulls `activeBattle`; the
continuation fires there, **after** death triggers, carrying the same
rollback escape as `pendingEffect` (an `effectFor` that returns `null` logs
and drops rather than stranding the game). If your card's effect wants to
"remember" something across a battle it declared — Trebuchet's repeat is the
only current example — this is where it goes, not `pendingEffect`. See
`docs/claude/architecture.md`'s freeze section ("A battle wait is not a
`pendingEffect`") for the fuller writeup, and `shared/effects/owEffects.ts`'s
`TREBUCHET` for the only worked example today.

### 2.4 DP6's hand direction, and `deployVehicle`

A vehicle carrying `playOnCardEffect` can now target a card in the player's
own hand: `PLAY_CARD_TARGETING_CARD_IN_HAND` gained an optional `zoneId`, and
the shared deploy body (placement, `additionalSpawns`, `resourceSurge`) was
extracted out of `PLAY_CARD_TO_ZONE` into `deployVehicle`
(`shared/engine/placement.ts`), which both handlers call. This closed
Excalibur, the only card that needed it — nothing in your wave uses this
path, but if a future card ever needs a vehicle to target a card in hand,
`deployVehicle` is already the shared body to call, not something to
re-extract.

The reverse direction — `playOnVehicleEffect` on a **vehicle** card, dispatched
from `PLAY_CARD_TARGETING_CARD_ON_FIELD` — was never built: Trebuchet's own
seed key turned out to belong under `onPlayEffect` instead (spec §4.3
departure 4, "When Played, you may choose..." is an on-play trigger with a
choice, not a targeted play), so no vehicle ended up needing it.
`REACHABLE_TRIGGERS`'s `vehicle` row therefore still does **not** list
`playOnVehicleEffect` — leave it that way unless one of your eight cards
genuinely needs it (none currently do; DP2 dispatches a different set of keys
entirely, see §3).

### 2.5 `enemyVehicleOptions` — the other new primitive

```ts
enemyVehicleOptions(
  game: EngineGame, actor: Side, zoneId: number | null,
  filter?: (e: ZoneCardEntry) => boolean,
): ChoiceOption[]
```

Builds public `ChoiceOption[]` from the acting side's enemy vehicles.
`zoneId: number` scopes to one zone (Braveheart, Eclipse, Trebuchet all use
this); `zoneId: null` scans the whole board (Orbit Flank's zone-agnostic mode
needed this and the signature was widened for it mid-wave-3). If any of your
cards offer a choice over enemy vehicles, this is very likely the function to
reach for before writing a bespoke filter loop.

### 2.6 The load-bearing rule for anything that suspends

**Stash everything a continuation needs in the choice's `data`; never trust
`resolution.targetInstanceId` / `.zoneId` off `RESOLVE_PENDING_EFFECT`.** Both
fields exist on the action, both are client-supplied and unvalidated, and
trusting them lets a stale or malicious client redirect the effect between its
two halves. `docs/claude/card-effects.md`'s "Suspending for a choice" section
now has the full rule and three worked examples (Air Strafe stashes because
the target isn't otherwise recoverable; Trebuchet stashes because its
continuation fires after `activeBattle` is already null; Braveheart needs no
stash at all because `payload.card` — the activating hull itself — is enough
to re-derive its zone). **Read it before Iron Cordon or Sacrilego's sacrifice
choice** — both are exactly this shape (a choice that picks a target and then
acts on it later).

### 2.7 A likely-needless worry: per-card targeting UI

The wave-3-era handoff you might find referenced in old commits predicted that
a "1v1 vs an enemy vehicle in the same zone" ability (Braveheart) would need
new frontend UI — a zone-pick-style mode for "choose a vehicle" analogous to
`moveMode`'s `pickZone` phase. **It didn't, and none of the four cards that
needed an enemy-vehicle pick (Braveheart, Eclipse, Trebuchet, Orbit Flank)
needed new UI at all.** All four route their pick through the *existing*
DP4/`choice` mechanism, which already has a generic frontend home
(`PendingChoiceDialog.tsx`) built in wave 2 for Kraken/Special
Foundries/Robotic Assemblers. `frontend/src/pages/game/GameBoardPage.tsx`'s
`ZONE_TARGETED_ACTIVATIONS` set still contains only `monsoonActivate` —
`braveheartActivate`/`eclipseEffect` never needed to join it, because
`ACTIVATE_VEHICLE { instanceId }` alone triggers the effect, and the effect
itself suspends into the ordinary choice dialog to ask "which enemy vehicle?"
**Check whether DP4's existing dialog already covers what looks like a
targeting problem before building new UI for it** — Iron Cordon's "sacrifice
choice" and Sacrilego's "raise a friendly ship's ending HP" choice both sound
like they might need something bespoke and very likely don't.

---

## 3. What wave 4 owns

| Card | Faction | Mechanism |
|---|---|---|
| Catshark | SS | `onBattleEffect` at lock → `grant({ materials: 30000 })` for this turn |
| Dryad | SS | `onBattleEffect` at lock, defensive only → board-spawn another Dryad into that zone |
| The Onyx Throne | OW | `onBattleEffect` at lock, defensive only → battle-summon a Parapet; plus DP1 clause 2 (`activateCpCost: 1` → draw a heavy GT airship) |
| Sacrilego | SS | `onBattleEffect` at resolve, survived → `grant({ cp: 1 })`; plus a sacrifice choice raising a friendly ship's ending HP by 15 |
| Iron Cordon | OW | `onBattleEffect` at resolve → DP4 choice to sacrifice itself and save a destroyed allied GT airship |
| Terawatt | LH | forced-battle hook → DP4 choice to join a friendly vehicle forced to fight alone |
| Buzzsaw | WF | defender-selection rule in `ATTACK_ENEMY_FLEET` / `RESPOND_TO_ATTACK` — omissible unless the attacking force contains a ship or tank |
| Veles | WF | same rule as Buzzsaw, verbatim card text |

Plus two `PARTIAL` entries, neither of which is one of the "65 cards" (both
already have a working partial implementation from an earlier wave):

- **Plunderer clause 2** — "survives a victorious fleet battle, or damages the
  enemy base → draw from the enemy deck." Needs a battle-resolve hook (DP2)
  and a base-attack hook. Its `costModifier` already works.
- **DWG Waters clauses 2-3** — clause 2: "whenever you fight a defensive
  battle in [the chosen] zone, you may choose one DWG vehicle with a cost
  <60k from the game to fight alongside your fleet" (a defensive-only
  `onBattleEffect` at lock, offering a battle summon that joins the already-
  locked battle — the same shape as The Onyx Throne above, including its
  "mutate the existing `activeBattle`, don't call `declareForcedBattle`"
  caution; not Dryad's shape, which board-spawns a permanent card into the
  zone rather than summoning a battle-only participant). Clause 3: "if the
  enemy attacks you directly in this zone, you can force them to beat this
  ship in battle first" (intercepting a fleet attack to force a preliminary
  battle — read this against Buzzsaw/Veles and the existing
  `RESPOND_TO_ATTACK` opt-out flow before assuming it needs
  `declareForcedBattle` as-is; it may need a new interception point instead).
  Its persistent zone claim (clause 1, `playOnZoneEffect`) already works.

### DP2 must be *defined*, not matched

**`onBattleEffect` / `onBattleVictory` / `onBattleDefeat` are dispatched
nowhere and named on zero seeded cards today** — not "seeded but undispatched"
as an older doc pass claimed (corrected this round, see
`docs/claude/architecture.md` and `docs/claude/card-effects.md`). You are
building the dispatch point **and** authoring the seed `meta` for all eight
cards above in the same pass; there is no existing wiring to discover. Spec
§4.3's DP2 row is the shape: `onBattleEffect` fires at **lock** and at
**resolve** with a `BattleContext` payload (`phase`, `zoneId`, `isDefender`,
`survived`, `won`); `onBattleVictory`/`onBattleDefeat` are resolve-only sugar
dispatched per side outcome. A side wins when the enemy has no surviving
participant and loses when it has none of its own; both false is a draw. Add
these three keys to `REACHABLE_TRIGGERS`'s `vehicle` row
(`supabase/seed/effectCoverage.test.ts`) **before** you seed the first card —
see trap 4.2 below, carried forward from wave 3's own handoff because it is
evergreen: G3 only bites the instant you close a card, and reads as "this card
is mis-wired" rather than "the table is out of date."

### Buzzsaw/Veles is not a DP4 choice — it is closer to the existing Stealthy opt-out

There is already a precedent for "some defenders may sit out of a battle":
`RESPOND_TO_ATTACK` (`shared/engine/battleDeclare.ts`, ~line 138) accepts
`optOutIds`, checked against `pending.stealthyIds` — but that opt-out is
**unconditional** for a Stealthy vehicle. Buzzsaw/Veles's is **conditional**
("unless the attacking enemy force contains a ship or tank"), which
`pending.stealthyIds` has no room for today. Read `ATTACK_ENEMY_FLEET` and
`RESPOND_TO_ATTACK` in full before designing this — the existing shape may
generalize (a second eligibility list alongside `stealthyIds`, evaluated
against `pending.attackerIds`' vehicle types) rather than needing a wholly new
mechanism, but it is not a direct copy of the Stealthy path either.

### Terawatt's hook point is shared, and shared awkwardly

"Join a friendly vehicle forced to fight alone" means Terawatt needs to know
when a friendly vehicle is about to be the **sole** defender (or attacker) in
a forced battle — i.e. it needs a say inside every wave-3 forced-battle
effect's call(s) to `declareForcedBattle` (Flying Squirrel Attack, Martyr
Attack, Air Strafe, Gang Up, Braveheart, Eclipse, Trebuchet — seven cards,
nine literal call sites between them today, since Air Strafe alone calls it
from two branches, each already shipped and each passing its own
`defenderIds` before Terawatt exists). Decide in your brainstorm whether that
means a check woven into `declareForcedBattle` itself (one seam, every caller
gets it free, including ones not yet written) or a check each caller has to
remember to run (nine seams today, more later) — this is a real design fork,
not a foregone conclusion, and it is exactly the kind of decision spec
amendments exist for. Whichever you choose, note it in the spec the way
wave 3 noted its own DP3/DP6 departures.

### The collision-aware teeth check — Terawatt owes this specifically

**A card whose effect branches on a value stashed in `data` needs a
collision-aware teeth check: mutate to a wrong-but-*valid* outcome, never to a
rejection.** Wave 3 lost a full fix round to this on Task 7 (Orbit Flank) — a
teeth-check mutation produced an outright 400, so the test died before it
reached the assertion it was meant to prove, and the review had to flag that
the code was right but the test proved nothing. Task 9 (Excalibur's
implementer) caught a second instance in itself before review, by noticing a
single-foe fixture made "defender destroyed" and "empty options"
indistinguishable, and fixed it by adding a second foe so the two outcomes
diverge observably. Terawatt is wave 4's card most likely to repeat this: it
branches on which forced battle it is joining, stashed in `data`, and a lazy
mutation there (e.g. flipping a boolean straight to a rejected action) will
pass a teeth check that proves nothing about the actual branch logic. Build
the fixture so a wrong branch produces a different **legal** outcome, not a
400, before you trust the test.

---

## 4. Traps — read this section twice

Everything here bit wave 3 or is verified to be waiting for wave 4. Traps
wave 3 closed are removed below, not carried forward — see §2 instead for the
machinery that replaced them.

### 4.1 The coverage guard's blind spots — five identified, three still open

1. **A card that has left `KNOWN_GAPS` is no longer checked at all.**
   Garrison's trigger-key correction could be reverted today with the suite
   green. Still open.
2. **G3 catches only a *type*-level mis-wiring**, never a same-type mix-up
   between two keys legitimately dispatchable for the same card type (an
   ability carrying `playOnVehicleEffect` where its text calls for
   `playOnCardEffect` — Garrison's actual bug). Still open; when a card's text
   names where its target lives, check the key by hand.
3. ~~A partly-built card passing G1/G2 despite incomplete text~~ — closed in
   wave 2 by the `PARTIAL` map.
4. ~~Nothing asserts `seed_data.sql` matches `source/*.js`~~ — **closed at the
   very end of wave 3**, by its final review. Found mid-wave (Task 7, not at
   any review): the whole guard — G1, G2, G3, the stale-entry assertion —
   reads `source/*.js` via `loadSeedData()`, so a stale generated SQL passed
   every check while the deploy applied old trigger keys. Wave 3 nearly
   shipped nine dead cards over it. `supabase/seed/seedDataSync.test.ts` now
   renders the seed and compares it to the committed file, so drift fails the
   suite. Note it normalises CRLF→LF on the committed read only — `git`'s
   `core.autocrlf=true` smudges that LF-only generated file on Windows, and
   without the normalisation the test would fail on every checkout regardless
   of real drift. Genuine content changes still fail, as they should.
   You still run `npm run seed:build` after editing a card's `meta`; the
   difference is that forgetting is now caught.
5. **A registered effect that no card names is invisible to G1/G2/G3.** Found
   in wave 3 (Task 10, controller verification — not even a dedicated review
   dispatch): `excaliburOnPlay` sat registered-but-unreachable for a full
   wave, with a test that called `effectFor` directly and so proved nothing
   about whether any card could ever reach it. Still open. If you register an
   effect ahead of seeding the card that uses it — plausible for DP2, since
   you're building eight cards against one new dispatch point — grep the seed
   source for the name before you consider the task done, the same way wave 3
   verified all nine of its names were unique before implementing (§4.11's
   older habit, still correct, still yours).

### 4.1b Do NOT deploy `game-action` through the `deploy_edge_function` MCP tool

New in wave 3, and it cost the better part of an hour. `game-action`'s payload
is **23 files and ~161 KB**. Sending it through the MCP tool means a model
transcribing every byte into one tool call, and that call gets **silently
truncated** by response-length limits. Wave 3 attempted it twice; both attempts
became **5-file** payloads. A partial payload **deletes the files you omit**,
so either one would have stripped 18 runtime modules and failed the function at
boot for every player. Both were blocked by a permission classifier before they
landed — that was luck, not a safeguard.

Use the script wave 3 added instead. It derives the file list from the same
`shared-manifest.json` that `functions:sync` reads (so the two cannot disagree
about what a function needs) and POSTs the bytes straight from disk — nothing
passes through a model:

```bash
node scripts/deploy-function.mjs game-action --dry-run   # lists the payload, sends nothing
node scripts/deploy-function.mjs game-action             # deploys
```

It needs `SUPABASE_ACCESS_TOKEN` in the environment, which it reads from
`process.env` and never prints. On Windows that is
`$env:SUPABASE_ACCESS_TOKEN = "sbp_..."` — `export` is bash syntax and fails in
PowerShell. Call `node` directly rather than `npm run functions:deploy -- <fn>`;
PowerShell mangles the `--` separator. `verify_jwt` defaults to **false**, which
is correct for all three functions here.

The MCP tool is still fine for a small function you can genuinely send whole.

### 4.2 G3's `REACHABLE_TRIGGERS` needs its row *before* a card can leave `KNOWN_GAPS`

Unchanged shape from wave 3's own handoff, and it applies to you directly: G3
skips any card still in `KNOWN_GAPS`, so `REACHABLE_TRIGGERS`'s table only
bites the moment you close one, and it reads as "this card is mis-wired," not
"the table is out of date." Add `onBattleEffect`/`onBattleVictory`/
`onBattleDefeat` to the `vehicle` row **before** you seed Catshark or Dryad,
in the same change that builds DP2's dispatch. Wave 2 hit this with
`onActivate`/Spectrum, wave 3 hit it with `playOnCardEffect`/Excalibur; both
ordered the table row ahead of the first card that needed it.

### 4.3 The catalog probe is blind to a card that has been spent

`supabase/functions/game-action/index.ts` feeds its candidate list from three
sources: the card at `action.instanceId` in the caller's hand, every on-field
entry on both sides, and `state.pendingEffect.card`. The third exists because
an ability is `spendCard`'d into `state.destroyed` on play, so by the time
`RESOLVE_PENDING_EFFECT` arrives it is in neither hand nor field. **Check this
for The Onyx Throne's DP1 clause 2** (draws a heavy GT airship — needs
`needsCatalog: true`, and is a plain activation, so the existing "on-field
entry" source already covers it) **and for any DP2 effect that reads the
catalog while the triggering card is mid-battle** — a battle participant is
always on-field (source 2 covers it) unless your design ever fires an effect
for a card that has already left the board by the time it resolves, in which
case you need a fourth source, same as wave 2 needed the third.

### 4.4 `{ needsCatalog: true }` is invisible to unit tests

Any effect reading `ctx.catalog` — directly, via `catalogCard`, or through
`drawFromPool`/`summonHulls` — **must** register with
`{ needsCatalog: true }`. Unit tests cannot catch a missing flag; `makeCtx`
hand-builds the catalog. Green suite, dead card in production. The Onyx
Throne's heavy-airship draw and Dryad's board-spawn both read the catalog —
check both by hand.

### 4.5 A frontend test that transitively reaches `supabaseClient` throws at import

Unchanged. Fix with `vi.mock('./supabaseClient', () => ({ supabase: {} }))` in
the test file, never with `envDir` on the root vitest config. A suite that is
green only because your shell exports the Supabase env vars is not green —
verify with them provably unset.

### 4.6 `npx tsc -p tsconfig.json --noEmit` does not typecheck edge functions

Unchanged. `supabase/functions/**` and `**/*.test.ts` are both outside the
root tsconfig's `include`. Careful reading is the only gate on
`game-action`/`lobby-action` code and on every test file in this repo.

### 4.7 Seed pool arrays are not the authority on pool membership

Unchanged, and relevant to you: The Onyx Throne's DP1 clause 2 draws from the
GT heavy airship pool, the same one Spectrum/Special Foundries already filter
correctly (`faction + vehicleType + materialCost >= GT_HEAVY_AIRSHIP_MIN_COST`
— 14 airships, 8 heavy, 6 light, pinned by a guard test). Reuse that filter;
do not filter on the `GT_AIRSHIP`/`GT_HEAVY_AIRSHIP` source-file grouping
arrays, which lie about at least two cards' actual faction/type.

### 4.8 Real effect names used as "unimplemented" stand-ins in tests

`shared/engine/placement.test.ts` still uses **`ambushEffect`** and
**`sabotageEffect`** (wave 5's cards) as synthetic-looking-but-real stand-ins.
Not yours to fix, but if you touch that file, do not add a third. See
`docs/claude/testing.md` for the corrected explanation of *why* this matters
— it is a decoupling practice, not a silent-failure risk; the risk was
misstated until wave 3 corrected it, and the correction is worth reading in
full before you take the old framing at face value from anything older than
this handoff.

### 4.9 Still true, and every wave keeps re-learning it

- **Grep the seed source for a name before you register it.** Duplicate
  effect names silently cross-fire between unrelated cards.
- **Card text is authoritative** over any ported implementation that
  disagrees.
- **`state.log` is public. No line may name a card in a hidden hand or
  deck** — and `pendingEffect.options` is public too.
- **Every commit touching `shared/` includes `npm run functions:sync`
  output.** A new file also needs a side-effect import in
  `shared/engine/index.ts` **and** a `supabase/functions/shared-manifest.json`
  entry. The drift test generates one case per manifest entry.
- **Relative imports inside `shared/` carry the `.ts` extension.**
- Consumers import `shared/engine/index.ts`, never individual engine modules.

---

## 5. What wave 3 did NOT verify

Be clear-eyed about this — it is the same wall wave 2 hit, for the second wave
running, and it is not a formality.

1. **The in-game browser checks never ran.** `RequireAuth` redirects before
   `GameBoardPage`'s chunk loads, and the implementer would not enter the
   documented test-account credentials. Wave 3's battle-overlay summon
   rendering and Excalibur's hand-then-zone pick are verified only by a clean
   frontend build/typecheck (including the `MoveMode` union's new
   `'handTarget'` literal), manual tracing against `battleResolve.ts` and
   `placement.ts`, and a console-clean dev-server boot — **not** by anyone
   actually playing a card in a running game. **The engine paths underneath
   are all unit-tested; the UI wiring on top of them is not.** If your
   choice dialogs or the battle overlay misbehave for a real player, suspect
   the wiring first, not the engine underneath it.
2. **The live deploy DID run — the in-game smoke test did not.** Corrected
   after the fact: an earlier draft of this section said neither had. The
   seed was applied and `game-action` deployed to **v10**, verified by
   content — all 19 bundled modules byte-identical to merged `main`, every
   wave-3 symbol present, the stale `MartyrAttackEffect` gone, and a clean
   27ms boot. The boot was proved without credentials by POSTing to the
   function with no auth: a healthy `game-action` answers
   `401 {"errors":["Not signed in"]}`, its *own* error shape, which means
   every module resolved and its auth check ran. Keep that probe — it is the
   cheapest real proof a deploy worked.
   **What is still unrun is the in-game smoke test.** `docs/claude/supabase.md`
   names Flying Squirrel Attack (mints without suspending) and Air Strafe
   against a player design (suspends, then mints) as the wave-3 pair. The
   second matters most: it is the only exercise anywhere of the
   `state.pendingEffect.card` catalog-probe source, which has no unit test and
   which `tsc` does not read. A regression there shows up as a 400 on the
   *resolving* action, not on the play.
3. **Wave 3's final whole-branch review DID run**, and this section originally
   said it had not — it was written before it. It found one real bug that no
   per-task review could have seen, because the leak and its reachability
   lived in different tasks: `discardCard` stripped `meta.costDelta` only on
   the captured-card-going-home path, which was fine while Marauder (which
   stamps a *captured* card) was the only consumer. **Excalibur is the first
   effect to stamp a player's own card**, so a discounted hull that died
   carried its discount into `state.destroyed`, `reshuffleDiscard` returned it
   to the owner's deck, and the discount became permanent and re-stackable.
   Fixed by stripping `costDelta` unconditionally; spec §4.5 now records that
   "per-instance" means the delta dies with the instance. That review also ran
   44 mutations against production lines and killed all 44. Its other findings
   were triaged: two are rules questions left for the owner (§3 of PR #15),
   the rest carried as minors.

---

## 6. How to run this wave — what earned its keep in wave 3, and what did not

Wave 3 measured **20 commits**, a **~4,860-line diff** against `main`, of
which roughly **1,023 lines were hand-written production code** (`shared/` +
`frontend/src`, non-test), **~1,700 lines were tests**, **~1,250 lines were
docs/spec/seed-source prose** (the implementation plan itself is 1,050 of
those — **22% of the total diff**, down from wave 2's 45%, because this plan
named files/signatures/values and let implementers write the code rather than
inlining it), and **~880 lines were mechanical `functions:sync` output**. If
you want a comparable number for wave 4's own retrospective, measure it the
same way: `git diff main...HEAD --stat` split by path glob.

### Where wave 3's findings actually came from

| Finding | Found by |
|---|---|
| `testing.md`'s "silently stops testing" claim is mechanically false (§4.8 above) | Task 8's **implementer**, via mutation testing, independently confirmed by Task 8's **reviewer** reading `registry.ts` against `registry.test.ts` |
| `seed_data.sql` is generated+tracked but no task regenerated it — would have shipped stale trigger keys | Task 7's **implementer**, mid-task, before that task's own review ran |
| Blind spot 5 — a registered-but-unnamed effect is invisible to G1/G2/G3 | **Controller verification** on Task 10 — caught with no dedicated review dispatched at all |
| Owed-materials repair loop had no independent summon guard; a test asserted nothing behavioural | Task 3's **dedicated reviewer** |
| Surge-before-pay pinned at only one of two call sites, with no test on the new hand-direction path | Task 4's **dedicated reviewer** |
| A teeth-check mutation produced a generic 400 and never reached its real assertion (code was correct; the test wasn't proof) | Task 7's **dedicated reviewer** |
| A single-foe fixture made two outcomes indistinguishable | Task 9's **implementer**, self-caught before review even ran; independently re-derived by the **reviewer** |
| `lockBattle` was a third non-null `ActiveBattle` construction site the pre-flight scan missed | Task 1's **implementer** |

Of the eight tasks that got a dedicated review (1, 2, 3, 4, 6, 7, 8, 9 — the
plan expanded wave 2's original four-task list to add 6, 7 and 8 because they
all write `state.pendingEffect`, which *is* the freeze), **four came back
clean on the first pass with no fix round** (1, 2, 6, 9) and **four needed
one** (3, 4, 7, 8) — a much higher hit rate than wave 2's "twelve of
seventeen returned nothing." Read that as validation of the expansion, not as
"review everything": Task 8, one of the three tasks *added* by that
expansion, is exactly where the false "silently stops testing" claim was
caught — a task the original, narrower plan would not have reviewed at all.
Tasks 5, 10 and 11 skipped dedicated review entirely (card/UI work over
settled machinery) and were controller-verified instead; that cheaper
mechanism still caught a real guard blind spot on Task 10, costing nothing
extra to find it.

### Spend here

1. **Expand dedicated review to any task that writes `state.pendingEffect`,
   `ActiveBattle`, or another freeze-adjacent field** — not just the tasks a
   plan happens to name at first draft. Wave 3's best catch came from exactly
   this expansion.
2. **Tell every implementer the brief may be wrong, and ask for a mutation
   transcript on every test.** Both practices carried over unchanged from
   wave 2 and both paid again — the false-claim catch and the single-foe-fixture
   catch both came from an implementer actually reverting a line and watching
   red, not from reading the diff.
3. **The controller-verification step (no dedicated review dispatched) is
   worth doing even when you've ruled a task doesn't need a reviewer.** It
   caught a real blind spot on Task 10 for the cost of reading the diff once.
4. **The final whole-branch review is still the highest-leverage single
   spend** — wave 2's found its two worst bugs there, and wave 3's has not
   run yet as of this handoff (§5 above). Do not skip it because per-task
   review already caught things; it sees across tasks in a way no per-task
   review can.

### Save here

5. **Keep the plan free of inlined code bodies.** Wave 3's plan was 22% of
   its total diff, down from wave 2's 45%, by naming files/signatures/values
   and trusting implementers to write the code. Nothing about wave 3's
   quality suggests this cost anything.
6. **Batch mechanical, related card work**, as wave 3's Task 5 did (three
   cards, one dispatch, one review-skip ruling) — reserve a dedicated
   dispatch for work that needs its own judgment surface.
7. **Demand terse reports.** Wave 3's ledger entries are almost all one to
   three lines per finding, file:line plus a failure scenario. Keep asking
   for that shape; it is what made this handoff possible to write from the
   ledger alone, without re-reading full review transcripts.

### The one thing not to cut

Write wave 5's handoff. You are reading this sentence only because wave 2 (via
wave 3's handoff) and now wave 3 both did it. The two most useful things in
this document — that DP4's dialog already covers what looks like new UI, and
exactly which review expansion earned its keep — exist only because someone
wrote them down instead of trusting the next wave to rediscover them.

---

## 7. Before you start

1. Read spec §4.2 (all five departures), §4.3 (all four DP3/DP6 departures,
   even though they're not your dispatch points — they show how a departure
   gets recorded), §4.4, and §8's wave-4 table.
2. Read `docs/claude/architecture.md` (the destructure trap, both freezes, the
   `activeBattle`/`summons`/`continuation` shapes), `docs/claude/card-effects.md`
   (`choice`, the four suspension rules, `mintHull`/`summonHulls`/
   `enemyVehicleOptions`), `docs/claude/testing.md` (the corrected stand-in
   rule) and `docs/claude/supabase.md` (the probe and the deploy runbook). All
   four were updated at the close of wave 3 with everything above.
3. Run the four commands in §1 and record your own baseline. If it is not
   521 / 30 green, find out why before writing a line.
4. Add `onBattleEffect`/`onBattleVictory`/`onBattleDefeat` to
   `REACHABLE_TRIGGERS`'s `vehicle` row **before** any card work (§3, §4.2
   above) — the same ordering wave 2 and wave 3 both used for their own new
   dispatch points.
5. Read §6 and decide your process **before** you write the plan. Keep the
   review expansion that worked (freeze-adjacent tasks get dedicated review);
   keep the plan free of inlined code; keep asking implementers to prove
   their tests with a revert-and-watch-it-fail transcript.
6. Read §3's Terawatt and Buzzsaw/Veles sections again before brainstorming —
   both are genuine design forks, not cards with an obvious single answer,
   and both deserve a spec amendment recording whichever way you decide.
