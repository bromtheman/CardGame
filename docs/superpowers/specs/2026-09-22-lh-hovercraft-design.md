# 2026-09-22 LH: Hovercraft and the Watt's Luxon — design

Amends the [2026-09-21 LH faction redesign](2026-09-21-lh-faction-redesign-design.md),
after the same day's [Drain N Charge](2026-09-22-lh-drain-charge-design.md) and
[card draw](2026-09-22-lh-draw-design.md) amendments. Decisions taken with the
owner on 2026-09-22; where this document and an earlier one disagree, this one
wins. Overturns **R-8** (Umbra surfaces) and amends **R-5** (hover craft),
**R-6** (Decoy on the Watt) and **R-13** (Hydrovolt).

## 1. Why

The owner, after playing the faction live:

- Ampere is a power-play card; give it a charge-up effect.
- Umbra should not become visible when it fires.
- Byte is too weak. Move its draw to the Watt, take the Watt's Decoy away, and
  have the Watt spawn a permanent Luxon that carries the Decoy instead.
- The Watt spawns in the water in FtD and dies — it hovers above the water. It
  needs a new ship class that spawns about 20 m up. Today the battle file puts
  every ship at 0 m and every plane or airship at 160 m, with nothing between.
- Replace Hydrovolt with the Anode blueprint.

## 2. Decisions

| Decision | Choice |
|---|---|
| Ampere | **Enters fully charged**: "When played, this gains 2 charge and stuns target enemy vehicle in this zone." Chosen over a repeating Discharge-2 stun and over a Terawatt-style charge transfer. R-10 stands: the stun is still on play only. |
| Umbra | **Stays Stealthy after firing.** R-8 overturned. |
| Byte | **Retired.** Its draw moves to the Watt. |
| Watt | Takes Byte's draw, loses Decoy, spawns a permanent Luxon that carries the Decoy, and becomes a Hovercraft. **Price stays 90k.** |
| The Watt's Luxon | **A token**: gone when it dies, never in a discard. It needs a free slot in the lane. |
| Hovercraft | A new vehicle type that **counts as a ship for every rule** and spawns 20 m above the water in FtD. On the Watt and Terawatt (Terawatt added at the owner's request after implementation, 2026-09-22), and since 2026-09-23 on Eclipse and WF's Veles (§10). Chosen over a spawn-height flag on a plain ship and over a type with its own rules. |
| Anode | A new card at **Hydrovolt's 260k** (FtD cost 364k — a 100k discount, chosen over 360k), with Hydrovolt's role. Hydrovolt retires. |
| Merge order | The migration that admits `hover` is **applied to production before the merge** (§5). |
| Testing | TDD for every new effect and rule; no self-play probe. The owner tests live. |

## 3. The cards

| Card | Type · cost (FtD) | ⚡ | Keywords | Text | Registry id |
|---|---|---|---|---|---|
| Ampere (changed) | ship · 200k (207k) | 2 | Mobile | When played, this gains 2 charge and stuns target enemy vehicle in this zone. | `ampereChargedStun` (new) |
| Umbra (changed) | sub · 150k (148k) | 2 | Stealthy | Discharge 2: deal 150k damage to the enemy base in this zone. | `umbraBeam` (new) |
| Watt (changed) | hover · 90k (91k) | 1 | Scrappy, Mobile | When played, this gains 1 charge and a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card. | `wattOnPlay`, `wattDraw` (new) |
| Terawatt (changed) | hover · 640k (725k) | 4 | Blocker, Scrappy, Mobile | unchanged | — |
| Anode (new) | sub · 260k (364k) | 2 | Blocker, Sub Screen | — | — |
| Byte | retired | | | | `byteChargeOnPlay`, `byteDraw` stay registered |
| Hydrovolt | retired | | | | — |

**Ampere**
- The charge lands whether or not there is an enemy to stun. With no enemy in
  the lane the play resolves with 2 charge and no stun (R-10's no-target rule).
- Its pips are ordinary pips: they can pay an EMP Salvo, a Data Burst or a Drain
  capital the same turn. Constant `AMPERE_PLAY_CHARGE`.

**Umbra**
- `umbraBeam` is `beam(UMBRA_SALVO_DAMAGE, false)`; the beam helper keeps its
  surfacing flag for the old id.
- Consequence, accepted: only targeted removal answers it now. It deals effect
  damage past Blockers every other turn, or every turn beside a Conduit.

**Watt**
- On play, in order: it gains 1 charge (constant `WATT_PLAY_CHARGE`), then a
  Luxon spawns in its lane.
- The Luxon is the catalog's Luxon (60k plane, Half-Cost), placed by `spawnInto`.
  Spawning is not playing (2026-08-24 spec §7.4): no payment, no placement check
  (Luxon's "blind" rule governs playing it from hand), no on-play. Then
  `grantKeywordsTo(DECOY)` and `revokeKeywordsFrom(TEMPORARY)` — Extended
  Sortie's path, so the turn-start Temporary cull skips it.
- **Token.** The spawned instance is stamped `meta.summonOnly = true`, which
  `discardCard` already refuses. A dead Watt Luxon is gone; it does not
  reshuffle into the deck as an extra card, as Paladin's spawned copies do.
- **Lane full** (`zoneCapFor`, 8 per side): the Watt still lands and charges;
  no Luxon spawns, and the log says so. This is the room rule a card's printed
  extra copies already follow.
- **Luxon missing from the catalog**: the play fails — a data bug, not an empty
  pool (`spawnVehicles`' contract).
- "Discharge 1: draw a card" uses the existing activation path (redesign §3.2);
  `wattDraw` is `grant({ draw: 1 })` under its own id.
- Decoy on the Luxon: enemy effects that could target it must target it
  instead (§3.6); it redirects, never blanks. The Watt itself no longer has
  Decoy (**R-6 amended**).
- Snapshots dealt before the deploy keep the old Watt (ship, Decoy, no text).

**Anode**
- The report's torpedo submarine with a particle pod (363,765), priced at 260k.
  Not Stealthy, for R-13's reason: a wall must be fightable.
- Its ship profile is imported from the report. Its blueprint resolves by name
  (`Built In/Neter/LH/Anode` is in the install).

**Retirements and ids**
- Byte and Hydrovolt get `retired: true`; their rows stay seeded
  (2026-09-02 §2.1). Decks holding them are refused at lobby time until edited;
  games already dealt keep their snapshots.
- `ampereStun` and `umbraSalvo` lose their last carrier and join
  `DELIBERATE_ORPHANS`; both stay registered for games already dealt. Byte's
  two ids are still named by its retired row. **No new card reuses an old id.**

## 4. Hovercraft

A new vehicle type, `hover`, shown as **Hovercraft**.

**A ship in every rule.** One helper, `isShipClass(vehicleType)` (ship or hover),
in a new leaf module `shared/vehicleClass.ts` that imports only `gameSettings`,
replaces every "is this a ship?" test:

- placement (`BIOMES_BY_TYPE`: water and beach);
- the pool filter's ship match (`matches` in `primitives.ts`) and `isAiShip`;
- DWG: Double Up, the boarding-party hero power (engine, `BoardZone`,
  `HeroPowerBar`);
- SS: Braveheart's duel pick and the AI-ship filter;
- WF: Harbringer's pool;
- the fleet-battle omission check (`battleDeclare`) and Change Order's pool;
- Cathode's "ship or submarine" duel;
- the bot's move menu.

The checklist is a grep for `VEHICLE_TYPES.SHIP` and `'ship'` across `shared/`
and `frontend/src`: every hit becomes `isShipClass` or is recorded as
deliberately ship-only. Printed card text keeps saying "ship"; the glossary says
a hovercraft is one. The AI battle simulator already files an unknown type with
ships (its fallback branch); a test pins that. The new module goes into
`shared-manifest.json` for each function that bundles an importer.

**Battle file.** `HOVER_SPAWN_ALTITUDE_M = 20` sits in `shared/customBattle.ts`
beside `AIRCRAFT_SPAWN_ALTITUDE_M`, and `spawnAltitudeOf` returns it for `hover`.
The battle overlay's altitude guidance adds hovercraft, derived from the
constant and never restated (the 80 → 160 lesson in that file).

**UI.** `VEHICLE_TYPE_INFO.hover`: label "Hovercraft"; a new icon,
`hovercraftSVG.svg`, drawn in the ship icon's style (the spare `ship2SVG` is
already the board's ghost-ship marker); description "Counts as a ship for every
rule, and deploys to water and beach zones. In FtD it spawns 20 m above the
water, where it hovers." — the altitude derived from the constant. A built-in
card's art is its type icon, so the Watt shows the new icon.

**Bot.** The rules primer's placement line adds that hovercraft count as ships.

**Custom cards.** The create-card page lists every type, so players can make
custom hovercraft, priced and keyworded like ships (`computeMaterialCost` and
`autoKeywords` unchanged). `create-card` validates against `VEHICLE_TYPES`, so it
accepts `hover` once redeployed.

**Data.** `VEHICLE_TYPES.HOVER = 'hover'` in both `shared/gameSettings.ts` and
the seed source's `gameSettings.js`. The Watt and Terawatt are `hover` (Terawatt at the owner's request, 2026-09-22),
and so are Eclipse and WF's Veles since 2026-09-23 (§10); moving another
skimmer later is a change to its row's type.

**R-5 amended.** "Every hover/thruster craft is an airship" still holds for craft
that fly (Dipole, Dynamo, Faraday, Quadrupole). A skimmer that FtD classes as a
ship but that hovers is a Hovercraft.

## 5. Database and merge order

- A migration replaces the `cards.vehicle_type` check with one that also admits
  `hover`. The constraint's live name is read before the migration is written.
- **The race.** At merge the Supabase integration migrates while
  `seed-apply.yml` upserts in parallel. A hover Watt upserted first fails its
  whole 40-statement batch, leaving that batch stale until the job is re-run.
- **The fix.** The migration is applied to production before the merge through
  the Supabase MCP `apply_migration`, and the file is committed under the version
  it records (`list_migrations`), so the merge finds it already applied
  (docs/claude/supabase.md, "a migration filename's timestamp IS its identity").
  It only widens a list, so nothing live can notice. A test reads the migration
  file and pins its list to `VEHICLE_TYPES`, as `battleReport.test.ts` does for
  its migration.
- **The deploy window.** The function deploy and the seed land seconds apart
  (CLAUDE.md). If the seed lands first, the old engine sees a hover Watt with no
  legal zone until the new engine arrives.

## 6. PracticeAI

- **Deck** (`BOT_DECKS.LH`): Byte ×2 → Watt ×2, Hydrovolt → Anode. Still 20
  cards, fliers 3 of 6 — a spawned Luxon is not a deck card.
- **Strategy notes** (`factionNotes.ts`):
  - the Watt takes Byte's draw line;
  - Ampere's line says to spend its pips the turn it lands;
  - Umbra's "then loses Stealthy" goes;
  - Anode replaces Hydrovolt in the Blocker list and the Sub Screen line.

  The notes test pins every card the notes name to the deck.
- **Rules primer:** the hovercraft clause (§4).
- **No evaluator change.** `EVALUATOR.charge` 0.04 already makes the bot
  discharge a one-pip hull for a card.

## 7. Tests

TDD: each fails before its implementation (docs/claude/card-effects.md).

- **Ampere:** gains 2 charge and stuns the chosen enemy; with no enemy, gains 2
  and stuns nothing; an `ampereStun` snapshot still only stuns.
- **Umbra:** `umbraBeam` deals 150k and leaves Stealthy; `umbraSalvo` still
  surfaces.
- **Watt:**
  - on play, gains 1 charge and spawns a Luxon in its lane with Decoy and
    without Temporary;
  - the Luxon survives its owner's next turn start;
  - a dead Luxon reaches no discard;
  - a full lane gets no Luxon and a log line;
  - discharging 1 draws a card.
- **Hovercraft:**
  - placement on water and beach, not land;
  - `isShipClass`;
  - representative ship-only rules accept a hover: Cathode's duel target,
    Double Up, the boarding party;
  - the battle file spawns a hover at `HOVER_SPAWN_ALTITUDE_M`;
  - the battle simulator files a hover with ships.
- **Seed-backed:**
  - Byte and Hydrovolt are retired;
  - Anode's numbers and keywords;
  - the Watt is `hover` without Decoy;
  - Ampere, Umbra and the Watt name the new ids;
  - the migration's list matches `VEHICLE_TYPES`.
- The suite's passing count is reported before → after.

## 8. Delivery

One branch (`claude/card-balance-adjustments-eb0108`), one PR, data and effects
together so no card ships ahead of its effect (2026-09-02 spec §1).

- **Gates before the PR:**
  - `npx vitest run`;
  - root `tsc`;
  - the frontend build and lint;
  - `functions:check`;
  - `functions:sync`, committed;
  - the blueprint verifier (Anode resolves);
  - `profiles:import` (LH profiles: Anode in, Byte and Hydrovolt out);
  - a secrets audit.
- **Before merge:** the migration is applied to production (§5).
- **After merge:**
  - the `seed-apply.yml` run is green and `seed:verify` reports drift 0;
  - game-action, lobby-action and create-card are redeployed, with versions read
    back by content (`wattOnPlay`, `umbraBeam`, `ampereChargedStun`,
    `isShipClass`, `HOVER_SPAWN_ALTITUDE_M`);
  - the Netlify `PhysicalCard-*.js` chunk carries `LH:Anode`.

## 9. Still open

- **Owner, in FtD:** check that the Watt and Terawatt hover at 20 m instead of dying, and
  the two §10 craft too; Kilowatt and Angstrom start at the surface again (§10).
  Other skimmers (Ampere, Volta, Chrysoprase, Megawatt …) move to Hovercraft if
  they are seen dying the same way, and only if they can catch themselves from
  20 m. A hull with no lift sinks from there, as the Kilowatt did (§10).
- **Balance, live:**
  - only targeted removal answers Umbra now;
  - the Watt is the faction's strongest 90k card;
  - Anode is 100k under its FtD cost;
  - LH's combined draw is unassessed: this amendment's repeating Watt draw
    (Discharge 1) lands on top of main's round-two draw (PR #86: Feedback Loop,
    and Kilowatt and Megawatt drawing when played), and a Watt discharging in a
    Feedback Loop lane draws two.
- **Saved decks** holding Byte or Hydrovolt need editing, the owner's included.

## 10. 2026-09-23: two more hovercraft

At the owner's request, two more ships became Hovercraft. Each change is to its
row's `vehicleType` only. Costs, keywords, texts and effects stay the same. No
code or migration is needed, since `hover` has been admitted since §5.

| Card | Was | Now |
|---|---|---|
| WF Veles | ship | hover |
| LH Eclipse | ship | hover |

**Only the spawn height changes.** A Hovercraft is a ship in every rule (§4),
so both play exactly as before and now spawn at `HOVER_SPAWN_ALTITUDE_M`.
A built-in card's art is its type icon, so they show the hovercraft icon.

**Anode stays a submarine.** It was on the owner's first list by mistake
(owner, 2026-09-23).

**Kilowatt and Angstrom are ships again.** Both shipped as Hovercraft in this
section's first version (PR #97). The same day, the owner asked for each to be
a normal ship that starts at the surface (0 m) instead of 20 m up. Kilowatt
changed in PR #101 and Angstrom after it. Only their rows' `vehicleType` went
back to `ship`, so they play exactly as before and show the ship icon again.

- **Kilowatt could not take the 20 m spawn.** Its blueprint has no lift: two
  horizontal stern jets and no propellers, pumps or foils. It dropped into the
  sea, sank, and was scuttled by its own FtD rules. At 0 m the same battle
  played normally.
- **Angstrom survives the 20 m spawn**, because it catches itself. The owner
  still prefers it starting at the surface.

**Delivery.** This is a seed-data change only, and `seed-apply.yml` applies it
on merge. Games already dealt keep their snapshots.
