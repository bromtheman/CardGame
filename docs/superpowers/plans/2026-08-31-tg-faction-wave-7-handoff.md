# Wave 7 — the TG faction

Written after wave 6 emptied `KNOWN_GAPS`, for whoever builds wave 7.

Waves 0–5 closed the 65 cards of
`docs/superpowers/specs/2026-08-27-effect-coverage-design.md`. Wave 6 closed the
twelve the 2026-08-30 balance pass left behind. **Wave 7 is not a backlog — it
is a faction.** Twenty-six new cards arrive in one file (`TG-built-in.js`,
supplied by the owner), for a faction that today exists as a string in an enum
and four borrowed cards in someone else's pool.

Everything below was verified against the code at commit `874d87c`. Where this
document and the code disagree, **the code is right and this document should be
corrected**. Wave 5 had to correct its predecessor twice and then got something
wrong itself; wave 6 found a place where its own handoff had drifted. Assume
this one has too.

---

## 0. Why this wave is shaped differently

Every wave so far wired effects onto cards that were **already seeded**. The
guard suite reflects that: G1/G2/G3 iterate seeded cards, `KNOWN_GAPS` tracks
cards whose rows exist but whose behaviour does not, and `npm run seed:build` is
a step you remember because you edited a `meta` block.

Wave 7 inverts it. There are no rows yet. Three things follow:

1. **Nothing fails until you seed.** You can register every effect in this
   document and the suite stays green and silent, because no card names any of
   them. G4 is the only guard that looks from that end, and it starts failing
   the moment you register ahead of seeding — which is the intended behaviour,
   not a fault in your work.
2. **Names freeze at first seed.** `transform.ts` derives each row's uuid from
   `card:TG:<name>`. Renaming a card afterwards mints a new id, orphans every
   deck holding the old one, and leaves the stale row in the database
   (`supabase/seed/source/README.md`). The three corrections in §2.4 have to
   land **before** the first seed, not after.
3. **Three of the "cards" are not cards.** `DECK_FACTIONS`, `UPKEEP_REQUIRED`
   and the LH pool collision are the wave. Get them wrong and 26 correct card
   implementations are unreachable, inert, or quietly break another faction.

---

## 1. Where things stand

Run this yourself before touching anything. A fresh worktree has **no
`node_modules` and no env file** — see `CLAUDE.md`, and install in **both** the
repo root and `frontend/`.

```bash
npx vitest run                      # NEVER pass --root — it silently runs 0 tests
npx tsc -p tsconfig.json --noEmit   # exit 0
npm --prefix frontend run build     # exit 0
npm --prefix frontend run lint      # exit 0, pre-existing warnings
```

Wave 6's close-out recorded **932 passed / 33 files**. That number was **not
re-verified when this document was written** — the authoring worktree had no
`node_modules`, and this wave writes no code. **Believe your own run and say so
if it disagrees.** Count the lint warnings rather than copying a number out of a
document.

| Map | Count | Contents |
|---|---:|---|
| `KNOWN_GAPS` | **0** | empty since wave 6; `toHaveLength(0)` is asserted |
| `PARTIAL` | 0 | empty, still asserted |
| `EXEMPT` | 1 | SS Falcon Squadron, permanently |
| `DELIBERATE_ORPHANS` | 3 | pinned to exactly `purifierEffect`, `rheaOnPlay`, `victoriaOnDeath` |

**All four assertions bite this wave.** Adding a card to `KNOWN_GAPS` means
incrementing a literal that currently reads `0`, visibly. Adding an orphan means
editing a list pinned to exactly three names. Both are deliberate acts needing a
written justification, which is the point — and §3's Duel and §3's Factories are
the two cards that may need them.

---

## 2. The faction plumbing — before any card

### 2.1 `DECK_FACTIONS` — the one line that makes the faction real

`shared/gameSettings.ts:53` reads `['DWG', 'GT', 'LH', 'OW', 'SS', 'WF']`.
`FACTIONS.TG` already exists; **`DECK_FACTIONS` is what `validateDeck` reads**,
so without `'TG'` in that array the 26 rows are seeded, visible in the catalog,
and undraftable.

- `shared/gameSettings.test.ts:11` pins the array **exactly** — update it in the
  same commit.
- `frontend/src/pages/DecksPage.tsx` maps over `DECK_FACTIONS`, so the deck
  builder picks TG up with no frontend change.
- `npm run functions:sync` — `gameSettings.ts` ships to all three functions.

⚠ **One consequence to decide, not to discover.** Once TG is a deck faction, the
four `[TG] …` cards in `LH-Built-in.js` (§2.3) become **draftable in a TG deck**
— so the builder lists both `Fear` (800k) and `[TG] Fear` (600k).
`summonOnly: true` on those four is the lever if that is unwanted; note it also
removes them from `drawFromPool`'s catalog pools, which is the opposite of what
§2.3 needs. Decide deliberately.

### 2.2 `UPKEEP_REQUIRED` — a new keyword *and* a new engine rule

Ten of the 26 carry it. **The word "upkeep" appears in zero files in this repo
today** — `KEYWORDS.UPKEEP_REQUIRED` in the supplied source evaluates to
`undefined`, and seeding as-is writes `keywords: [null, "robotic"]` into jsonb on
all ten. Silent: no error, no log line, no failing guard.

The owner's definition:

```ts
UPKEEP_REQUIRED: 'upkeepRequired', // at turn start, reduce your resources this
                                   // turn by 15% of this card's cost
```

**Seam:** `endTurn` in `shared/engine/gameEngine.ts`, immediately after

```ts
game.state.resources[side].materials = Math.floor(game.turnNumber) * materialsPerTurnOf(game.settings)
```

Income is **set**, not accumulated, so upkeep is a deduction from that turn's
fresh figure and can never carry forward as debt. Put `UPKEEP_RATE = 0.15` in
`gameSettings.ts` (repo rule: constants live there — `DOUBLE_UP_MAX_COST`,
`JUDGEMENT_DISCOUNT` and friends are the pattern).

✅ **The surrounding ordering is already favourable.** The Temporary cull runs
*before* the income line, so a Temporary hull has despawned and pays nothing. No
TG card carries both keywords, but the ordering is free and it is the honest one.

**Five rulings — and four are currently unobservable, which is exactly why they
must be written down.**

- **U-1 — which cost?** `effectiveMaterialCostOf` (Half-Cost floor) or printed
  `materialCost`? The repo convention: pool and threshold filters read printed
  cost ("base cost" in card text); damage, repairs and in-battle resources read
  `effectiveMaterialCostOf`. Upkeep is a recurring charge, so
  `effectiveMaterialCostOf` is the closer sibling — but **never**
  `effectiveCostInGame`, which is play-time-only (costModifier, costDelta,
  surge) and must not reach a running cost.
  ⚠ **No TG card carries both `UPKEEP_REQUIRED` and `HALF_COST`**, so the two
  candidates agree on every card that exists and no test you write against real
  data can tell them apart. Pick one, write the reason down, and pin it with a
  fixture that *does* carry both.
- **U-2 — rounding.** `Math.ceil`, matching `repairCostOf` (the other
  player-facing charge). ⚠ All ten cards' 15% is exact to the hundred, so this is
  unobservable too.
- **U-3 — clamp or debt?** Recommend `Math.max(0, …)`, matching
  `zone.baseHp[enemy]`. Since income is set each turn a negative can never carry,
  so clamping only affects the current turn's spending power — but
  `canAffordInGame` compares `materials >= cost`, so a negative would behave
  "correctly" and silently. That is the argument for choosing rather than
  defaulting.
- **U-4 — whose hulls?** Every `UPKEEP_REQUIRED` hull the paying side
  **controls**, across all zones. A captured hull is fed by its controller
  (`ownerSideOf` decides whose *deck* it returns to, not who pays for it). Battle
  summons never touch `zone.cards` and never pay. **Spawned hulls do** — Fear's
  three Horrors sit in `zone.cards` carrying printed keywords.
- **U-5 — a hull deployed this turn** pays nothing until its owner's next turn
  start. That falls out of the seam; state it anyway.

**The log line:** one summary line per turn, not one per hull — the §4.4
precedent is `"N summoned vehicle(s) evaporated"`, deliberately not six lines for
six Martyrs. Board hulls are public so naming them would leak nothing, but a
total reads better.

**Frontend:** add a `KEYWORD_INFO` entry and an icon in
`frontend/src/lib/keywords.ts`. Without one, `attributesOf` renders *"No
description for this modifier yet."* on ten cards — it degrades gracefully, which
is precisely why it would ship unnoticed.

The ten, and what they cost per turn at 15%:

| Card | Cost | Upkeep/turn |
|---|---:|---:|
| Horror | 70k | 10,500 |
| Nostalgia | 90k | 13,500 |
| Alarmed | 230k | 34,500 |
| Anguish | 260k | 39,000 |
| Obsession | 330k | 49,500 |
| Amusement | 330k | 49,500 |
| Joy | 390k | 58,500 |
| Euphoria | 580k | 87,000 |
| Hysteria | 730k | 109,500 |
| Fear | 800k | 120,000 |

⚠ **Say this out loud before it ships, rather than finding it in a game.**
Default income is `floor(turnNumber) × 75k`, so turn 2 is 150k. **Fear alone
costs 120k/turn, and the three Horrors it spawns add 31.5k — 151.5k, more than a
full turn's income at turn 2.** That is two independently-correct decisions
meeting, not a bug in either, and it is not wave 7's to fix unilaterally.

### 2.3 The LH `[TG] Robotics` pool — a live cross-faction regression

**Decided by the owner: LH keeps its original four-card pool.**

⚠ **Read this section even if you are certain it does not apply to you.** The
natural assumption — *"the TG cards are a new faction in a new file; they do not
touch LH"* — is true about the diff and false about the behaviour, and that gap
is the single most likely way this wave ships a regression.

**The LH pool is a query, not a card list.** Three facts compose:

1. `shared/effects/lhEffects.ts:13` —
   `drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })`
2. `supabase/functions/game-action/index.ts:124` — the catalog is
   `.from('cards').select('*').eq('is_built_in', true)`: **the entire table**,
   with no faction scoping and no scoping to the decks in play.
3. The 26 new cards carry `faction: FACTIONS.TG` and `isBuiltIn: true`.

So the pool is whatever `where is_built_in = true and faction = 'TG'` returns.
Run that against production today and it returns exactly the four cards in
`LH-Built-in.js`:

```
[TG] Amusement · [TG] Fear · [TG] Hysteria · [TG] Obsession
```

The `[TG] ` name prefix is **cosmetic** — nothing reads it. Seeding TG therefore
takes that pool from **4 to 30**, and there is no edit to LH that causes it and
none you could withhold to prevent it. Putting the cards in the TG faction is not
what *avoids* this; it is what *causes* it. **Wave 7's diff can touch zero LH
files and LH still changes.**

Five LH cards read it — **Ampere** (200k), **Quadrupole** (540k), **Candela**
(800k), **Spectrum** (370k, 1cp/turn) and **Robotic Assemblers** (50k ability).
Today they draw from four vanilla ROBOTIC ships at 330k/400k/410k/600k, **mean
435k**; Candela pays 800k for one guaranteed body of about that value. After
seeding, the pool's mean falls to **~293k**, and its shape changes more than its
average:

- `drawFromPool` sets no `type` filter, so **Duel, Havoc Factory and Mirth
  Factory become drawable** — and both Factories need a friendly robotic vehicle
  to target, which an LH board often has none of.
- The floor collapses from 330k to Obelisk 40k / Horror 70k / Duel 0.
- `roboticAssemblersEffect`'s dialog goes from 4 buttons to 28, and
  `pendingEffect.options` is **public** — both players scroll it.
- Marking the two Swarms `summonOnly` moves the mean only to ~302k. It is not the
  fix.

**Build it as: a marker on the four, read by the LH filters.**

- Add `meta: { lhRoboticsPool: true }` to the four `[TG] …` cards in
  `supabase/seed/source/builtInCards/LH-Built-in.js`.
- Change `tgRobotics` (`lhEffects.ts:13`) **and** `roboticAssemblersEffect`'s own
  inline filter (`c.faction === 'TG'`, `lhEffects.ts:61`) to read the marker.
  **There are two filters, not one** — a fix applied only to `drawFromPool`
  leaves Robotic Assemblers offering all 28.
- `PoolFilter` has no marker field. Cleanest is an optional `metaFlag?: string`
  tested in `matches()` — small and contained. This is the same "the rule reads
  off seeded data, so the next card needs no engine edit" pattern as
  `blocksFaction`, `aircraftLock` and `defensiveOmission`.
- ✅ The four cards have `cardText: ''`, so **G2 never inspects them** and the
  marker needs no `DATA_EFFECT_KEYS` entry. Confirm that rather than assuming it.
- ⚠ Pin **both** the marker's value (blind spot 4 — presence is checked, value is
  not) **and the pool's membership at exactly four**. Wave 6's Harbringer note is
  the precedent: a two-card pool meant a filter typo would have been invisible.
- ⚠ This is a **behaviour-preserving change to five live cards.** It must land in
  the **same commit** as the TG seed, or there is a window in which the pool is
  30. `lhEffects.ts` is in the `game-action` manifest — `functions:sync`.

### 2.4 The seed file, and three corrections that must precede it

Drop the supplied file at
`supabase/seed/source/builtInCards/TG-built-in.js`. Its import (`from
"../gameSettings"`) matches its siblings, and `loadSeedData` picks up any
exported array in the directory — the card's own `faction` field is
authoritative, not the filename.

**Three corrections, all owner-confirmed, all before the first seed:**

1. `Extasy` → **`Ecstasy`**.
2. Havoc Swarm `materialCost: 1200000` → **`120000`** (its blueprint cost was
   already 120k).
3. `havocEffect` → **`havocFactoryEffect`**. Its sibling is already
   `mirthFactoryEffect`, and `havocEffect` is generic enough to be the
   Kraken/Paddlegun collision waiting to happen — hard rule 2: keys are unique
   registry ids, never reusable.

✅ **The blueprint-under-material figures are intentional buffs** — Anguish
(260k/202k), Curiosity (80k/46k), Obelisk (40k/32k), both Factories (…/0), Duel
(0/0). **Do not "fix" them.** `blueprintCost` is display-only for built-ins
(`frontend/src/components/CardDetailsModal.tsx:130`) and drives nothing
mechanical.

⚠ `npm run seed:build`, then grep the generated SQL for your names, before every
commit that touches a card's `meta` (blind spot 3). This wave adds 26 new rows
and edits four existing ones, so it is load-bearing throughout rather than a
formality at the end.

⚠ **Applying the seed to production is a manual `execute_sql` of
`supabase/seed/seed_data.sql`.** Merging to `main` deploys functions and
**never** reseeds card data (wave 6 close-out §6.1, which also records a
precedent for it being forgotten). For a whole new faction that is the difference
between 26 cards and none.

### 2.5 What the frontend needs

Only the `KEYWORD_INFO` entry from §2.2. Everything else is automatic:
`DecksPage` reads `DECK_FACTIONS`, and `imageUrl` needs no work at all — see §4.

---

## 3. The 26, grouped by what they actually need

**Read each card's `cardText` from the seed source before building it.** The
summaries here are a map, not the territory — card text is authoritative (spec
decision 1), and every wave so far has found at least one place where a summary
had drifted from the card.

Counts: 23 vehicles (8 airship, 8 ship, 4 plane, 3 sub) + 3 abilities. The
groups below partition all 26 — check the arithmetic against this table rather
than against the section headers, and if your count of the seed file disagrees,
believe the file:

| Group | Cards | Engine work |
|---|---:|---|
| A — vanilla, no card text | 10 | none |
| B — pure data key, no registry name | 2 | none |
| C — one-liners over existing primitives | 4 | none |
| D — small extensions | 2 | one `legalZonesFor` predicate, one options builder |
| E — genuinely new | 5 | a replacement effect, DP8, a per-hull rider, a cross-zone battle |
| E (cont.) — the two summon payloads | 2 | none; one `summonOnly` decision |
| Exempt — conduct text | 1 | none |
| **Total** | **26** | |

### Group A — vanilla: no text, nothing to build (10)

Obsession, Euphoria, Ecstasy, Optimism, Frustration, Joy, Amusement, Audacious,
Spite, Loathing.

All have `cardText: ''`, so **G2 never inspects them** and `meta: {}` is correct
and final. Their only wave-7 requirement is that §2.2 makes `UPKEEP_REQUIRED` a
real keyword, since four of them carry it.

Two notes, neither of which is work:

- **Frustration is an airship carrying `SUB_SCREEN`.** Every other Sub Screen in
  the game is a ship. `screenBlocks` does not care what type the screening hull
  is, so it works — it is just unusual enough to look like a data error to the
  next reader.
- **Amusement and Obsession** (and Group C's **Fear** and **Hysteria**) share a
  name with a `[TG] `-prefixed card in `LH-Built-in.js`. Different names →
  different uuids → no collision. But `catalogCard(ctx, name)` matches on the
  **bare** name, so anything looking up `'Fear'` finds the 800k TG ship and never
  the 600k borrowed one. Nothing today does. Check before you add something that
  does.

### Group B — pure data keys, no registry name at all (2)

| Card | Seed | Precedent |
|---|---|---|
| **Curiosity** | `meta: { additionalSpawns: 1 }` | Pilferer, Corsair, Abactor, Pontus |
| **Acceptance** | `meta: { resourceSurge: { materialsAtLeast: 150000, extraSpawns: 1 } }` | PredatorX / Orbit (§4.6) |

Both close under G2 through `DATA_EFFECT_KEYS`, exactly as Buzzsaw and Veles do
with no registry name. ⚠ Both need a **seed-backed assertion on the value**, not
just on the key (blind spot 4).

- **Curiosity** — "spawn a second curiosity into that zone too" is
  `additionalSpawns` verbatim. ✅ No infinite loop: `deployVehicle` is the only
  reader, and the copies it mints never pass through it, so the inherited
  `additionalSpawns` on a copy never fires again. Worth knowing before you go
  looking for a guard that is not there.
- **Acceptance** — the comparator is **"at least"**, so `materialsAtLeast`
  (Orbit's), not `materialsOver`. §4.6 keeps exactly one comparator per card so
  each card's own wording survives. No `grantKeywords`, so this is the
  **suppressing** arm of ruling B-9: `halfCostSuppressed` strips `HALF_COST` from
  the price.
  ⚠ **Ruling A-1:** *"loses halfcost keyword"* — suppression is **price-only**.
  The hull on the board keeps `HALF_COST` in `keywords`, which feeds
  `effectiveMaterialCostOf` and so its base damage and repair bill. PredatorX has
  this shape already, and wave 6's ruling B-7 is the same question answered for
  Paladin. So a surged Acceptance **pays 150k and still hits like a 75k hull.**
  Confirm that is intended; the alternative needs a keyword-stripping arm that
  does not exist.
  ✅ The surge is read **before** `pay()` at both play handlers. Acceptance's
  threshold equals its own printed cost — the exact case that ordering exists for
  (Chrysaor).

### Group C — one-liners over primitives that already exist (4)

Do these first. They are a day's work between them, and they prove the seed
pipeline end to end before anything hard depends on it.

| Card | Key to author | Build |
|---|---|---|
| **Jealousy** | `onDeathEffect: 'jealousyOnDeath'` | `grant({ draw: 1 })` — `basherOnDeath` verbatim |
| **Fear** | `onPlayEffect: 'fearOnPlay'` | `spawnVehicles({ cardName: 'Horror', count: 1, zones: 'all' })`, `{ needsCatalog: true }` — `sapphireScreenEffect`'s shape |
| **Obelisk** | `onBattleEffect: 'obeliskBattle'` | `summonHulls('Mirth Swarm', 1)` + `joinBattle` at lock, `{ needsCatalog: true }` — `harbringerBattle`'s shape |
| **Hysteria** | `onPlayEffect: 'hysteriaOnPlay'` | `choice` over `enemyVehicleOptions(game, actor, null)`, resolving to a grant of `INOFFENSIVE` |

Five things this group needs said out loud:

- **Jealousy** prints `BLOCKER` and nothing else, so decision 2 is clear — a
  built-in must never carry both `SCRAPPY` and an `onDeathEffect`, because a
  Scrappy hull auto-repairs in the 80–89.999% band with no prompt and the trigger
  becomes silently unreachable.
- **Fear's Horrors keep their own battle trigger.** Spawning is not playing
  (§7.4), and that rule skips `onPlayEffect` and **nothing else**. Horror's
  `onBattleEffect` is read off the entry's printed meta by DP2, so each spawned
  Horror fires its own copy rule. This is wave 6's Nothung/Sacrilego ruling again,
  and it is almost certainly intended — Fear names Horror rather than a vanilla
  hull for a reason. Say so rather than discovering it in a battle report. ⚠ And
  see §2.2: Fear plus its three Horrors is 151.5k of upkeep a turn.
- **Obelisk must guard `battle.phase === 'lock'`.** DP2 fires the same
  `onBattleEffect` key at resolve, and Harbringer is the worked example of the
  guard. "Participates in a fleet battle" reads to offensive **and** defensive
  battles, and — per §7.3's Catshark ruling — to forced ones. Obelisk is a
  participant, not a rider, so it needs no `zoneEffects` entry and no bystander
  flag; DP2's lock pass already reaches participants on both sides.
- **Obelisk's Mirth Swarm is a battle summon, not a board spawn** (§4.4):
  `summonHulls` + `joinBattle(side, id, entry)`, never `zone.cards`. It
  evaporates on report approval regardless of HP. Mirth Swarm already prints
  `TEMPORARY`, so the word in the card text is decorative and the grant is
  idempotent. ⚠ Obelisk is `STEALTHY`, so an `ATTACK_ENEMY_FLEET` naming it raises
  the response window instead of locking, and DP2's whole dispatch happens on
  `RESPOND_TO_ATTACK` — the exact trap `smoke-wave5.mjs` already knows about.
- **Hysteria is not a straight `grantKeywords` composition, and composing it will
  silently no-op.** `grantKeywords` reads `payload.targetInstanceId`, which is
  **not set** on a `RESOLVE_PENDING_EFFECT` re-entry. Write a small bespoke
  `resolve` that uses `findVehicle` on an id **stashed in `data` at first entry**
  — never `resolution.targetInstanceId`, which is client-supplied and
  unvalidated. Air Strafe (`ssEffects.ts`, `AIR_STRAFE`) is the worked example.
  Re-check the stashed id against the board on resolve
  (`enemyVehicleOptions(...).some(o => o.id === choiceId)`) in case the target
  left while the dialog sat open. And **"you may"** means empty options must not
  fail: `choice()` calls `resolve(payload, null)` when no enemy vehicle exists, so
  handle `choiceId === null`.

### Group D — small extensions to machinery that exists (2)

**TG Alarmed** — *"Can only play this into a zone in which you control a AI
vehicle. When this vehicle is played, sacrifice a target friendly AI vehicle in
this zone."* `meta: {}` — you author both halves.

- ⚠ **Ruling D-1 (blocking): what is "an AI vehicle"?** The engine has no AI
  concept. Three candidates, and **all three pass every test you would naturally
  write**: (a) the `ROBOTIC` keyword; (b) `isBuiltIn === true` — "AI-designed" as
  against a player blueprint, which is how the game's fiction reads; (c)
  `faction === 'TG'`. Recommend **(a)**: it is a printed, displayed keyword,
  Alarmed is itself `ROBOTIC`, and eight of the ten upkeep cards carry it. Write
  the reason down.
- **Clause 1** is Purifier's shape exactly: a seeded data key read by a new
  predicate in `legalZonesFor`, sitting beside `battleLossMissing`. It
  **narrows** the legal set rather than removing zones from it — the same
  distinction Purifier's own comment draws. Pin its value.
- **Clause 2** is a `choice` over the actor's own vehicles in the played zone,
  resolved with `sacrificeEntry(game, actor, instanceId, zoneId)`
  (`battleTriggers.ts`).
  - ⚠ **There is no `friendlyVehicleOptions`.** `enemyVehicleOptions` is the only
    builder in `primitives.ts`. Wave 7 authors the sibling. Own-board vehicles are
    already public, so surfacing them as `pendingEffect.options` leaks nothing.
  - ⚠ **Exclude Alarmed itself — this is the card's most likely bug.**
    `PLAY_CARD_TO_ZONE` places the hull **before** effects fire, so Alarmed is
    already in `zone.cards[actor]` when the effect runs. `placedInstanceIds` is on
    the payload for exactly this, and `zoneOccupants(p, 'own')` already honours
    it. Use that rather than a raw zone read.
  - ⚠ **A sacrifice does not fire `onDeathEffect`.** `sacrificeEntry` calls
    `discardCard` directly, never `fireDeathEffect` — that is the deliberate split
    behind wave 5's decision 28 ("destroy" fires, "remove from play" does not).
    **Ruling D-2:** does Alarmed's sacrifice fire death triggers? Recommend no,
    matching `sacrificeEntry`'s existing contract — but Jealousy is a TG card
    whose entire text is a death draw, so a TG player will notice within one game.
    Decide, don't inherit.
  - ✅ `sacrificeEntry` routes through `discardCard`, so a captured hull still goes
    home and a `summonOnly` one still never reaches a discard.

**TG Horror** — *"Whenever a horror survives a fleet battle, create anther copy
of it in this zone. Max one spawn per zone."* (`anther` is the card's own typo;
`cardText` is data, so reproduce or correct it deliberately rather than by
accident.)

- ⚠ **Ruling D-3: "a horror" or "this horror"?** DP2 dispatches per participant,
  so the natural build is per-hull. The sentence continues *"create another copy
  **of it**"*, which points back at the same hull. Recommend **this Horror**;
  reading it as "any Horror anywhere" would need Vengeful's new dispatch (Group E)
  and is a much bigger card than it looks.
- Resolve phase: `battle.phase === 'resolve' && battle.survived`.
- Prefer **copying the surviving entry** (which carries any granted keywords) over
  minting from the catalog — `clydesdaleEffect` and `loggerheadOnDeath` are the
  precedents, and both pass the source meta through **`copyMeta`**, which every
  new copy-minting effect must also do or a captured hull's copy goes home to a
  deck it never came from. Copying the entry also means **no `{ needsCatalog: true }`**
  and no `fireRider` trap, because this is a participant trigger and not a
  `zoneEffects` rider.
- ⚠ **Ruling D-4: "max one spawn per zone" — per what?** Per battle, per turn, or
  ever? Each `fire()` is an isolated effect invocation with no shared scratchpad,
  so any counter has to be read off the board. The cheapest reading that matches
  the text: refuse if a Horror in this zone already has
  `playedOnTurn === game.turnNumber`. That needs no new state. Say which reading
  you chose.
- ⚠ Horror is 70k, self-replicating, and `UPKEEP_REQUIRED` — and Fear puts three
  of them on the board for free. Spawned Horrors are ordinary board hulls, so they
  pay upkeep and die normally. This is the wave's balance hot spot; it is a design
  question, not a bug.

### Group E — genuinely new (5 cards, 4 mechanisms)

These are the wave. Ship Groups A–D first, so the seed pipeline and the plumbing
are proven underneath them.

#### TG Nostalgia — a replacement effect, which the engine has never had

*"Whenever this would be destroyed, put it back into your hand."*

`DECIDE_BATTLE_REPORT`'s resolution loop removes from `zone.cards`, calls
`discardCard`, pushes to `destroyedEntries` — and only **afterwards** runs
`fireDeathEffect`. **Nothing in the engine can say "instead of".**

Two routes:

- **(a) An `onDeathEffect` that undoes the discard.** Every piece already exists:
  `discardIndexOf` / `sameSnapshot` in `battleTriggers.ts` were written for
  `reviveEntry`, which puts a hull back on the **board**. Wave 7 writes a
  `returnToHand` sibling beside it — splice the snapshot out of
  `state.destroyed[owner]`, push it into `game.privates[actor].hand` with a fresh
  `instanceId`, and **resync `state.counts[actor]`** (checklist item 5: direct
  pushes must do it manually). **No engine surgery.**
  ⚠ The divergences are real and must be recorded: the death is still logged,
  still counts toward `destroyedCount`, and — the load-bearing one — **still
  counts as a loss for `battleOutcome`**, because `survivingIds` was computed
  before any trigger ran. So a lone Nostalgia losing a battle still hands the
  enemy the win and still writes `zone.lostBattleOnTurn`, which WF Purifier reads.
- **(b) A real pre-destruction hook** in that loop. Cleaner semantics; touches the
  single most load-bearing loop in the engine, on which a dozen cards already
  depend.

Recommend **(a)**, with the divergences written into §7.3 rather than left to be
found.

- ⚠ **Ruling E-1: which destructions?** *"Whenever this **would** be destroyed"*
  is broader than battle death — Alarmed's sacrifice and any future
  remove-from-play are others, and `sacrificeEntry` does **not** fire
  `fireDeathEffect`, so route (a) would not save a sacrificed Nostalgia. Recommend
  scoping it to battle death, and saying so.
- ✅ Nostalgia is not `SCRAPPY`, so decision 2 is satisfied — and that rule exists
  for exactly this shape. Its owner still *chooses* whether to pay the 80–90%
  repair; repairing means it survives and no trigger fires, which is correct.
- ⚠ Under route (a) it never reaches the discard, so it never reshuffles into the
  deck — it goes straight back to hand, indefinitely, for 13.5k of upkeep a turn.
  A balance note, not a defect.

#### TG Vengeful — a resolve-phase bystander (call it DP8)

*"Whenever you lose a vehicle to a fleet battle (any zone) this unit deals 40k
damage to the enemy base in this zone."*

**"Any zone" means a battle Vengeful is not in — and the existing bystander pass
does not cover it.** `BYSTANDER_EFFECTS` (Terawatt) is dispatched only at
**lock**, only on a **forced** battle, only for the **defending** side, and only
in the **battle's own zone**. Vengeful needs the **resolve** phase (a loss is not
known until then), **every** battle, from **any** zone. That is a new dispatch
point.

- **Seam:** `dispatchBattleResolve` in `battleTriggers.ts`, called from
  `DECIDE_BATTLE_REPORT` once `outcome` is computed. Add a second pass over
  non-participant hulls whose `onBattleEffect` is registered with a **new opt-in
  flag** (`resolveBystander: true`), mirroring `BYSTANDER_EFFECTS` and
  `DEPLOY_WATCHER_EFFECTS` exactly. **The opt-in is load-bearing, not
  bookkeeping** — for precisely the reason DP7's is: `dwgWatersEffect`'s router
  falls through to its claim branch on any context it does not recognise, so a
  broadcast would make it attempt a claim with no target zone on every battle in
  the game.
- ⚠ **The context's `zoneId` is the battle's, and Vengeful needs its own.** The
  damage lands on *"the enemy base in **this** zone"* — Vengeful's. Locate the
  hull with `findVehicle(card.instanceId)`, the way Braveheart re-derives its own
  zone from `payload.card` rather than stashing it.
- ⚠ **Ruling E-2: "lose a vehicle" is per vehicle, not per battle.** Two casualties
  on your side — 80k, or 40k? The literal reading is per casualty, and
  `casualties` is on the context (`casualties.filter(c => c.side === actor)`).
  Also settle whether a Vengeful destroyed **in that same battle** triggers on its
  own death.
- ⚠ **Ruling E-3, the sharpest in the wave: Vengeful is a submarine.**
  `baseStrikersIn` excludes subs, and the Submarine glossary entry says outright
  that a sub *"can never damage an enemy base"*. This is card-driven damage rather
  than a bombardment, so it bypasses that roster mechanically — but it directly
  contradicts the vehicle type's printed rule, which players read. Decide, and
  write the reason down.
- ⚠ **Ruling E-4:** does an enemy `BLOCKER` in Vengeful's zone stop it?
  `ATTACK_ENEMY_BASE` refuses over a Blocker; this is not that handler.
- 40k converts through `BASE_DAMAGE_DIVISOR` → **40 HP** of a default 1000.
  `ONGOING_ATTRITION_DAMAGE_PER_VEHICLE` is the precedent for this exact wording;
  give Vengeful its own constant rather than reusing it.
- It must **not** stamp `lastActivatedTurn` (a card-forced consequence is not a
  zone activation) and it **must** call `checkVictory` if the base reaches 0.

#### TG Duel — a cross-zone battle, which `ActiveBattle` cannot express

*"Target a friendly and enemy vehicle. They can be in different zones. they
1v1."* `meta: { onPlayEffect: 'duelEffect' }` — ✅ `PLAY_ABILITY_CARD` accepts
that, because the card carries no `playOn*` target key and all targeting happens
inside the choice chain.

Two independent gaps:

1. **Two targets.** The action vocabulary carries one `targetInstanceId`. The
   route is a **two-hop `choice` chain** — Orbit Flank's shape, which works
   because `RESOLVE_PENDING_EFFECT` nulls `pendingEffect` before re-entering.
   ⚠ Orbit Flank writes its second `pendingEffect` **by hand**, bypassing
   `choice()`'s one-slot check; `card-effects.md` says explicitly to route a new
   suspension through `choice()` instead. Do that.
2. **The cross-zone battle, which is the real problem.** `declareForcedBattle`
   takes one `zoneId` and validates every id against `zone.cards[side]` **for that
   zone**. Four sites assume a battle happens in exactly one zone:

   | Site | What breaks |
   |---|---|
   | `declareForcedBattle`'s `onField` check | refuses the declaration outright |
   | `participantsOf` (`battleResolve.ts`) | misses the away hull, falls through to the summon map, **silently drops it from the report** |
   | the destruction branch's `zone.cards[side].filter(...)` | removes from the wrong zone — a destroyed hull **stays on the board** |
   | `lockRoster` (`battleTriggers.ts`) | the away hull's DP2 triggers never fire |

   Plus `lostBattleOnTurn`, which writes the battle's zone for both sides.

⚠ **The tempting shortcut is wrong, and it is worth writing down so nobody spends
a day on it:** bringing the enemy hull in via `battle.summons` looks like it fits
— but a summon **evaporates on report approval regardless of HP** (§4.4): no
death, no discard, no `destroyedEntries`. That makes the enemy hull unkillable,
which defeats the entire card.

`findVehicle` already does board-wide lookup, so the honest build is bounded —
each of those four sites needs to find a hull by id rather than by zone — but it
is the largest single item in the wave and it touches the loop everything else
depends on.

**Recommendation: decide this one before you plan the wave, not during it.**
Either budget Duel as the wave's biggest task, or ship the other 25 and put Duel
in `KNOWN_GAPS` labelled `wave 7`, incrementing the `toHaveLength(0)` literal
visibly. That map exists for exactly this, and a 25-of-26 wave with one honest
entry beats a wave that stalls on its hardest card.

Two smaller rulings if you do build it: **who is the aggressor** (the Duel player
— it decides `isDefender` for every DP2 trigger in that battle), and whether the
duel **activates either zone** (recommend no: a forced battle is not a zone
activation, and Eclipse alone passes `activatesZone`).

#### TG Havoc Factory + Mirth Factory — a rider on a *hull*, not a zone

*"Target friendly robotic vehicle. Whenever that vehicle is engaged in a fleet
combat, spawn a Havoc/Mirth swarm to fight along side it."* Both carry
`playOnVehicleEffect`, so they arrive through
`PLAY_CARD_TARGETING_CARD_ON_FIELD`.

⚠ **That handler checks only `findVehicle(targetInstanceId)` — not ownership.**
The effect itself must validate own-side **and** `ROBOTIC`, or either Factory can
be played onto an enemy hull.

`state.zoneEffects` is per-**zone**. This is per-**hull**, which is new.

**Recommended build — no new dispatch, no new state:** the target is a live
`ZoneCardEntry` with its own `meta`, and DP2's lock pass reads
`effectName(entry, ON_BATTLE_EFFECT)` straight off it. So **stamp the trigger
onto the target**:

```
entry.meta = { ...entry.meta, onBattleEffect: 'havocFactoryBattle' }
```

The registered `havocFactoryBattle` then does Obelisk's job. Three consequences,
and the second is a real bug if missed:

- ⚠ **Collision.** A target already carrying `onBattleEffect` — Obelisk does — is
  **overwritten**. Recommend refusing the play (`return false` → 400 *"check its
  target"*), which is honest and cheap. Stacking would need a combined name,
  which is the Kraken/Paddlegun problem in a new costume.
- ⚠ **The stamp rides into the deck.** `discardSnapshotOf` strips `instanceId`,
  the three turn stamps, `costDelta` and `ownerSide` — and **nothing else**. Its
  own comment says *"Every per-entry stamp must be named here. TypeScript does NOT
  catch one you forget."* A stamped `onBattleEffect` therefore survives into
  `state.destroyed` and, via `reshuffleDiscard`, back into the deck: a Factory'd
  hull that dies **returns permanently upgraded**. Either name the key in that
  strip list or store the grant somewhere else. `copyMeta` inherits it too, so
  Horror's copies and `additionalSpawns` extras would carry it.
- ⚠ **It trips G4.** `havocFactoryBattle` is written at **runtime**, so no seeded
  card ever names it — precisely the orphan G4 exists to catch. It needs a
  `DELIBERATE_ORPHANS` entry with a written justification, and that map is
  currently pinned to exactly three names by its own test. **This is a new
  category of orphan** — not "a card's meta was cleared" but "no card ever names
  it, by design" — so say that in the entry rather than reusing the balance pass's
  wording.

✅ G3 needs no new row: `onBattleEffect` is already in `REACHABLE_TRIGGERS`'
`vehicle` list. Verify that rather than trusting it — the missing-row trap bit
waves 2, 3 and 4.

#### The two Swarms — `summonOnly`?

Havoc Swarm (120k after the correction) and Mirth Swarm (200k), both planes, both
`[ROBOTIC, TEMPORARY, HALF_COST]`, both vanilla.

Recommend **`summonOnly: true`** on both, matching Flying Squirrel (DWG), Parapet
(OW) and Martyr (WF). That excludes them from decks (`validateDeck`), from
`drawFromPool`'s catalog pools, and from `discardCard` — so a destroyed Swarm can
never leak into a deck through `reshuffleDiscard`. ✅ `catalogCard` and
`summonHulls` still find them, which is how Martyr and PredatorX already work.

⚠ It is a design call, not a technical one: at 120k/200k with `HALF_COST` they are
perfectly playable cards. Left draftable, they also count against
`FLIER_COPY_LIMIT` (6) in a TG deck, which already holds 12 fliers among its 23
vehicles.

### Exempt (1)

**TG Anguish** — *"Whenever this vehicle fights in a fleet battle, it must deploy
first before the opponent."* Player-conduct guidance for the From The Depths
spawn sheet; the engine has no deployment-order concept and there is nothing to
fire. Add to `EXEMPT` with a reason, alongside SS Falcon Squadron (*"Robotic-shaped
conduct text: players apply it when reporting results"*) — the same judgement,
for the same reason.

---

## 4. What wave 7 does NOT need

Worth stating, because three of these look like work and are not:

- **No new trigger key, and so no `REACHABLE_TRIGGERS` row.** Every card here uses
  a key the engine already dispatches for its type. That is the trap that bit
  waves 2, 3 and 4 — **verify the claim before relying on it.**
- **No hero power.** SS, WF and GT are all deck factions with none, and spec §10
  has them out of scope throughout.
- **No card art, and no asset upload.** `imageUrl` is a bare filename for *every*
  built-in card in the game, and `frontend/src/lib/cards.ts:24` uses the value
  only when it starts `http` or `blob:` — everything else falls back. So
  `jealousy.png` behaves exactly like every existing built-in. Nothing to do.
- **No Fragile audit for TG's airships.** The glossary says airships are always
  Fragile, but no built-in airship in *any* faction prints it and nothing enforces
  it for built-ins (`customCards.ts:19` is custom-cards-only). TG's eight airships
  match every other faction's. Pre-existing; not this wave's to reopen.
- **No new catalog-probe source** — the existing four still cover these cards.
  ⚠ But `{ needsCatalog: true }` is still mandatory on every effect that reads
  `ctx.catalog` (Fear, Obelisk, and both Factories' battle halves), and **unit
  tests cannot catch a missing flag** because `makeCtx` hands every test a
  catalog. Assert `CATALOG_EFFECTS` membership at runtime, the way
  `factionEffects.test.ts` already does for five effects.

---

## 5. Traps, still true

Every one of these bit a previous wave. The full lists live in
`docs/claude/card-effects.md` and `docs/claude/testing.md`; these are the ones
this wave is most likely to walk into.

1. **`npm run seed:build` after every commit touching a card's `meta`** — this
   wave authors meta for 26 new cards and edits four existing ones.
   `seedDataSync.test.ts` catches a stale SQL, but only if you run the suite.
2. **`npm run functions:sync` in the same commit as every `shared/` change.** A
   new effects module also needs a side-effect import in `shared/engine/index.ts`
   **and** a `supabase/functions/shared-manifest.json` entry under `game-action`.
   A new faction file (`tgEffects.ts`) needs both.
3. **A data key's VALUE is never checked, only its presence.** This wave adds at
   least three (`lhRoboticsPool`, Alarmed's prerequisite, plus the two Group B
   values). Each needs a seed-backed assertion — `battleDeclare.test.ts`'s
   `defensiveOmission` case is the worked example.
4. **After `git checkout --` on a `shared/` file, re-run `functions:sync`** —
   `core.autocrlf` makes the drift test fail on a tree `git diff` calls clean.
   Bites mutation testing hardest.
5. **Never use a real seeded effect name as an "unimplemented" test stand-in** —
   use a `t_` prefix. G4 skips those by that rule.
6. **A new `PublicGameState` field needs both halves** — a `normalizeState`
   default *and* an initial value in `buildInitialGame`. Nothing here obviously
   needs one; Duel and Nostalgia are the two that might.
7. **Deploys are automatic on merge to `main`; the seed is not.** For an
   out-of-band deploy use `npm run functions:deploy -- game-action`, never the MCP
   tool, and verify by **content** rather than file count.
8. **A difference between your checkout and production is a question, not a
   finding.** `git fetch --all && git log --all -S'<name>'` answers it before it
   becomes a paragraph. Wave 5 skipped that and mis-reported twelve deliberate
   cards as orphans nobody owned.

---

## 6. Suggested order

Each step leaves the build green and the faction visibly more real.

1. **Plumbing** — `DECK_FACTIONS`, `UPKEEP_REQUIRED` (keyword + `endTurn` rule +
   glossary), the LH pool narrowing, the three seed corrections, then seed the
   file with every card's meta empty. **Stop here and run the suite:** 26 rows
   exist, ten cards have a working keyword, LH is provably unchanged, and the
   whole faction is draftable.
2. **Groups A and B** — vanilla plus the two data keys. Curiosity and Acceptance
   prove the seed→guard loop end to end with no registry name at all.
3. **Group C** — Jealousy, Fear, Obelisk, Hysteria. Four one-liners; the first
   registry names in `tgEffects.ts`.
4. **Group D** — Alarmed and Horror. Two extensions, four rulings between them.
5. **Group E** — Nostalgia, then Vengeful (DP8), then the two Factories. Leave
   **Duel** to last, having decided at step 0 whether it is in this wave at all.
6. **The late re-read.** Read all 26 card texts again, against the built
   implementations. That single pass is what caught Ongoing Attrition firing on
   forced battles in wave 5, and nothing else would have.
7. **Mutation testing.** `scripts/mutation-harness.mjs` is in the repo with both
   of wave 6's bugs fixed. Scope it at **all** of `shared/` — a file-scoped run
   reports false survivors — and treat a survivor as a finding. ⚠ Before trusting
   a green run, prove the harness can fail for the right reason: wave 6 got a
   perfect 62/62 that was entirely false, with 16 real gaps hidden behind a drift
   test.

---

## 7. The rulings, collected

Settle these **before** writing code, and record each in the spec's §7.3 the way
waves 3–6 did. Ordered by how much they cost to get wrong.

| # | Ruling | Recommendation |
|---|---|---|
| **D-1** | What is "an AI vehicle" (Alarmed)? | the `ROBOTIC` keyword — but all three candidates pass every natural test |
| **E-3** | Vengeful is a sub, and subs "can never damage an enemy base" | decide against the fiction, not against what compiles |
| **U-1** | Upkeep reads printed cost or `effectiveMaterialCostOf`? | `effectiveMaterialCostOf`; unobservable today, so pin it with a fixture carrying both keywords |
| **E-1** | Which destructions does Nostalgia replace? | battle death only; a sacrifice fires no death effect |
| **E-2** | Vengeful: per vehicle lost, or per battle? | per vehicle — and say whether a Vengeful lost in that battle triggers |
| **D-3** | Horror: "a horror" or "this horror"? | this one — *"another copy **of it**"* |
| **D-4** | Horror's "max one spawn per zone" — per battle, turn, or ever? | per turn, read off `playedOnTurn`; needs no new state |
| **A-1** | Acceptance "loses halfcost" — price only, or the hull too? | price only, matching PredatorX and ruling B-7 |
| **D-2** | Does Alarmed's sacrifice fire `onDeathEffect`? | no, matching `sacrificeEntry` — but Jealousy makes it visible |
| **U-2/3** | Upkeep rounding, and the zero clamp | `Math.ceil`; `Math.max(0, …)` |
| **E-4** | Does a Blocker stop Vengeful's damage? | — |
| — | Are the two Swarms `summonOnly`? | yes, matching Martyr and Parapet |
| — | Is Duel in this wave, or in `KNOWN_GAPS`? | decide before planning, not during |

---

## 8. The thing most worth not repeating

Wave 5's lesson was to re-read the primary source after building against it.
Wave 6's was that a green result you cannot account for deserves the same
suspicion as a red one.

Wave 7's risk is a third shape, and it is structural rather than procedural:
**this wave's worst failures are all silent.** A missing `DECK_FACTIONS` entry
seeds 26 undraftable cards. An undefined `UPKEEP_REQUIRED` writes `null` into ten
keyword arrays. The LH pool widens from 4 to 30 with **no diff at all** — not one
line of `lhEffects.ts` changes, and five cards in another faction start behaving
differently. A Factory's stamp rides into a deck through a strip list TypeScript
will not check for you.

None of those produces a red test, a 4xx, or a log line. So for this wave in
particular: **after each step, ask what would still look fine if you had got it
wrong** — and then go check that specific thing.
