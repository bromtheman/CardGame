# 2026-09-21 Lightning Hoods faction redesign — design

Replaces the Lightning Hoods roster from scratch: **24 vehicles, 4 abilities
and a new hero power**, every vehicle a real craft from the owner's FtDArmament
report (`C:\Users\JFinn\FtDArmament\reports\LH.cards.md`, 45 craft), built
around one new mechanic — **Charge**, a per-hull timer — and one supporting
one — **Stun**, the EMP. Designed card by card with the owner on 2026-09-21;
every ruling below was taken in that conversation and is binding on the wave
that implements it.

The [2026-08-24 design spec](2026-08-24-ftd-card-game-design.md) stays binding
for everything this document does not name; the
[2026-09-02 balance pass](2026-09-02-balance-pass-design.md) and
[2026-09-16 changes](2026-09-16-balance-pass-changes.md) supply the
precedents cited here (retirement, data keys, the per-faction wave shape).
Read [docs/claude/card-effects.md](../../claude/card-effects.md) before
touching an effect and [docs/claude/architecture.md](../../claude/architecture.md)
before touching a stamp.

## 1. Decisions

| Decision | Choice |
|---|---|
| Scope | The whole LH faction is redesigned. Nothing in the current `LH-Built-in.js` survives on its merits: the `[TG]` robotics-pool draws predate TG being a faction, and Sapphire/Orbit/Coulomb are not craft in the report. Ten old names are reused (their rows update in place), eight are retired, and the four `[TG]` pool cards retire with them (§7). |
| Charge shape | **Per hull**, not a per-player pool. A hull prints ⚡N, fills one pip per turn, and the pips are visible on the board and die with the hull. Chosen over the pool because the threat sits where an FtD battle can answer it, speed (Mobile) then means something, nothing banks charge the opponent can never drain, and it reuses the activation / targeting / deploy-requirement paths the engine already has. |
| Two verbs | **Discharge N** spends pips from one hull (a hull's own activated ability, or an ability card spending from a friendly hull). **Drain N Charge** — printed "Requires N Charge" until the [2026-09-22 amendment](2026-09-22-lh-drain-charge-design.md) — is a play precondition on the board total *and* a cost: playing the card spends N pips from any mix of friendly LH hulls, split as the player chooses. The opponent can still break it by killing charged hulls. Flagship prices are discounted below FtD cost in exchange. |
| Stun | Yes, as the second pillar: a timed disable (§3.4), on exactly three cards, always paid for in charge or a 200k body. Fragile/Inoffensive grants were rejected — TG owns them, and a permanent disable for a charge cost is either useless or oppressive. |
| Third keyword | **Decoy** (Watt only). Accepted because every timer in the roster is otherwise a 50k Martyr Attack away from never firing (§3.6). |
| Speed | **Swift** keyword ("may attack the enemy base the turn it is played") on Dynamo and Rectifier, plus **Afterburner** for everyone else; Mobile on ten hulls. |
| Principle: timers don't move | Penumbra, Superradiance, Impedance, Eclipse, Umbra have no Mobile, whatever their speed. Walls and raiders (Angstrom, Candela, Terawatt, Quadrupole, Megawatt, Dynamo, Watt, Dipole, Byte, Ampere) do. A Mobile timer charges in the empty lane and jumps; a static one can be raced. |
| Principle: no death triggers on chaff | FtD's AI shoots the biggest hull first, and a lost battle wipes the lane, so "when this dies" on a picket almost never fires usefully. Volta's original death trigger was rewritten to fire on play. |
| Hero power | **Surge** replaces Flyby: 1 CP, once — every friendly LH vehicle gains 1 charge. |
| Pricing | FtD cost rounded to 10k (down, as the old data did). Discounts only on the gated hulls: R2 none (its gate buys Swift), R3 12–18 %, R4 31 %, R5 43 %. Those are the gates as first printed; on 2026-09-22 draining made the gate a cost and every gate dropped by 1, prices unchanged ([amendment](2026-09-22-lh-drain-charge-design.md) §6). Conduit alone is priced above its hull (70k for 54k) because its text is the card. |
| Delivery | One branch, one PR, data and effects together, so no LH card ever ships ahead of its effect (2026-09-02 spec §1). The wave is the size of the SS wave of the balance pass plus TG's keyword work. |

## 2. Faction identity

From the report, and what each trait became:

- **Energy weapons** — lasers fed by cavities that pumps recharge, plasma "charge
  chambers", particle cannons whose charge grows with tube length → **Charge**.
- **EMP, "the Hoods' favourite"** — warheads that stun electronics rather than
  sink → **Stun**, scarce and paid for.
- **Speed** — 27 of 45 craft in the top speed quintile, jet skimmers at 100 m/s+,
  Rectifier the fastest craft in the campaign at 337 kn → **Mobile**, **Swift**,
  **Afterburner**.
- **Toughness from heavy armour, not shields** → Scrappy on the tanks (Chrysoprase,
  Conduit, Watt, Terawatt, Candela) and nowhere else; DWG stays the Scrappy faction.
- **Weak to submarines** (lasers stop at the water) → three **Sub Screens**
  (Hydrovolt, Cathode, Candela) and one hull that can hunt a sub (Cathode).
- **Missile-proof point-defence** on Angstrom → the roster's **Air Screen**, on a
  Mobile wall.

Play pattern, against the other five: DWG is tempo and theft, SS value and
fortress, WF ambush and sacrifice, TG swarm economy, OW airship attrition. LH is
**threats that mature** — the faction the opponent has to race — with the only
timed disable in the game.

## 3. New rules

### 3.1 Charge

1. A vehicle card may print **⚡N** (`meta.chargeMax`). Its hull enters play at
   0 charge — played, spawned, or captured (Boarding Party, Mutiny).
2. At the start of **its owner's** turn, every hull below its max gains
   `meta.chargeRate` (default 1). Planes never charge: the Temporary cull runs
   first. Airships and submarines do.
3. Charge is public — pips on the hull in the lane — and dies with the hull.
   **Moving keeps it** (Mobile, Rapid Redeployment, Monsoon-style moves).
   Repairs keep it. A hull returned to hand (Salvage) is a new hull.
4. Charge never exceeds the printed max; every source that adds charge (tick,
   relay, Volta, Terawatt, Overcharge, Surge) clamps at the max and discards the
   excess. Prompts that pick a recipient list only hulls with room.
5. **Relay** (`meta.chargeRelay: 1`, Conduit): after the tick, every *other*
   friendly LH hull in the relay's lane gains 1. **Does not stack** — the bonus
   is 1 per lane whatever the number of relays, the derived-not-stored,
   `max`-not-`sum` shape of Tiger Shark's slot denial (2026-09-02 R-1).
6. Turn-start order (the incoming side): cull Temporary → set income → upkeep →
   **charge tick (rate) → relays** → draw → scheduled items. Both charge steps
   sit after upkeep and before the draw so a Byte's discharge-draw and the
   turn draw never interleave with a partial tick.

### 3.2 Discharge

- **On a hull** — `Discharge N: …` is an activated ability: the existing
  `ACTIVATE_VEHICLE` route (`onActivate` + `activateCpCost: 0`, once per hull
  per turn via `activatedOnTurn`) with a new `meta.dischargeCost: N`. The
  **engine** checks `charge >= N` and spends N before the effect runs; effects
  never re-implement the spend. A discharge never spends the lane's activation,
  so *discharge → then activate the lane* is the ordinary sequence. It is always
  the player's choice — a full hull is a threat-in-being, never auto-fired.
- **On an ability card** — `Discharge N from a friendly LH vehicle: …` plays
  through `PLAY_CARD_TARGETING_CARD_ON_FIELD` with a **friendly** target
  (Havoc Factory's shape) carrying `meta.dischargeFrom: N`. The engine validates
  the target is a friendly LH hull with `charge >= N` and spends N before the
  effect runs; the effect then makes its second pick through `choice`, scoped
  to that hull's lane. The card is greyed in hand unless a legal pair exists.
  Pips are spent on play; a declined second prompt does not refund them.

### 3.3 Drain N Charge (first printed "Requires N Charge")

> **Amended 2026-09-22.** [2026-09-22-lh-drain-charge-design.md](2026-09-22-lh-drain-charge-design.md)
> replaces this section. As first written the gate was checked and never
> spent; it is now also a cost, and every gate dropped by 1.

`meta.requiresCharge: N` (the key keeps its name) is printed **"Drain N
Charge"**. It is a play precondition, checked alongside cost: the **sum of
`charge` over the player's LH hulls in every lane** must be ≥ N. "LH"
everywhere in this document means `faction === 'LH'`; player-made cards are
NEUTRAL and never count. Playing the card then **spends N pips** from any mix
of the player's LH hulls, split as the player chooses (PracticeAI pays a
suggested split). Paying is not an activation. Read and paid at play time
only — a hull already down stays down if its batteries die later. Umbra's pips
count while it is Stealthy. Spawning is not playing (spec §7.4): spawns ignore
it. The hand UI must state the reason ("Drain 3 Charge — you have 2") exactly
as it states "not enough materials".

### 3.4 Stun

> **Stunned** — until the end of its owner's next turn the vehicle cannot attack
> (base or fleet), cannot move, and does not Block, Screen or withdraw as
> Stealthy. It still defends if attacked.

- Stamp `stunnedUntilTurn` on the hull = turn number at application **+ 1.0**;
  stunned while `turnNumber < stunnedUntilTurn`. Every LH stun happens on LH's
  own turn, so the effect is always exactly one full enemy turn, clearing when
  LH's next turn begins. Re-stunning an already stunned hull rewrites the stamp.
- Reads (one predicate, `isStunned(entry, turnNumber)`): base-attack
  eligibility (`baseStrikersIn`); the fleet-attack roster (a stunned hull is
  excluded from the attacking side like Inoffensive — if every hull in a lane
  is stunned, no fleet attack can be declared there); the Blocker check in
  `ATTACK_ENEMY_BASE`; Air/Sub Screen in `legalZonesFor`; the Stealthy
  withdrawal list at declaration; `moveEntry` (which `MOVE_VEHICLE`, Rapid
  Redeployment and Monsoon share).
- A stunned lane can still be **reinforced**: playing is never blocked by stun,
  and switched-off Screens help the reinforcing side's fliers and subs in. The
  answer to a zone stun is to commit fresh hulls, which are not stunned and
  may fleet-attack.
- Sources, and only these: Ampere (on play), Penumbra (Discharge 3, every
  enemy in the lane), EMP Salvo (ability). Decoy applies in an LH mirror only —
  no other faction carries it.

### 3.5 Swift (keyword)

*May attack the enemy base the turn it is played.* One extra clause in
`baseStrikersIn` (`playedOnTurn < turn || swift`). Everything else about a base
attack holds: one activation per lane, Blockers stop it, subs and Inoffensive
never qualify. Damage reads `effectiveMaterialCostOf` — Rectifier's is the
Half-Cost figure, 350, never 700. Afterburner grants the same for one hull for
one turn through an engine-written `swiftOnTurn` stamp.

### 3.6 Decoy (keyword)

*Enemy effects that could target this must target it instead of another vehicle
in this zone.* "Could target" means the Decoy satisfies the effect's own filter:
Sub Strike targets submarines, Watt is not one, so Sub Strike in Watt's lane
still hits the sub — Decoy **redirects, it never blanks**. Lane-scoped: picks in
other lanes are free. Enemy effects only. Fleet battles and base attacks are
untouched. Two Decoys in a lane: either is legal. Two chokepoints implement it —
the field-target validator (ability cards) and `enemyVehicleOptions` (every
targeted on-play choice). Like every keyword, its rule lives in the glossary
and the badge — Watt prints no card text, so G2 has nothing to inspect.

### 3.7 Surfacing — keyword revocation

Umbra and Cathode *lose Stealthy for the rest of the game* when they discharge;
Extended Sortie removes Temporary from a plane. All three are the first
permanent **removal** of a printed keyword from a hull. It is recorded in
`meta.revokedKeywords` — the mirror of the engine-written `grantedKeywords` —
and `discardSnapshotOf` **restores** the revoked keywords when the hull leaves
play, so a Salvaged-and-replayed card is Stealthy (or Temporary) again. The
Stealthy withdrawal list and the Temporary cull read the hull's keywords, so
both follow with no further change. Surfacing happens the moment the discharge
is declared, not when its battle resolves.

### 3.8 Beams — effect damage to a base

Umbra (150k), Superradiance (300k) and Impedance (400k) deal **effect damage**:
materials through `BASE_DAMAGE_DIVISOR`, applied directly, **ignoring Blocker**
(SS Bull Shark's precedent, verified in `bullSharkVictory`), to the enemy base
in the discharging hull's lane. Umbra's is the one exception to "submarines
cannot damage bases". A destroyed base takes nothing and logs nothing (Bull
Shark's inline code would re-announce the fall; the LH beams get the clean rule
through one shared primitive, `dealBaseDamage`). A beam never spends the lane
activation, so *beam → then bombard* is the ordinary fire turn.

### 3.9 Forced 1v1s (Eclipse, Cathode)

Through `declareForcedBattle` like Trebuchet and Duel. A forced battle **does
not spend the lane activation** — the old Eclipse's "no fleet battle here
afterwards" was the cost of a free ability, and the charge is the cost now. The
target must be non-Stealthy at declaration; a Stealthy hull Ampere stunned this
turn qualifies.

### 3.10 Placement keys

- `deployRequiresLhVehicle: true` (Luxon) — legal lanes are those where the
  player controls an LH vehicle of any type, including another Luxon. TG
  Alarmed's `deployRequiresAiVehicle` shape.
- `ignoresAirScreen: true` (Caspian) — the Air Screen clause of `legalZonesFor`
  skips the card. Spawns already ignore screens.

Both, plus `chargeRelay`, `chargeRate` and `requiresCharge`, go in
`DATA_EFFECT_KEYS`: for each, the card's whole text is the rule and the card
names no effect, so G2 and `noteUnimplemented` would otherwise call it silent.
Each key's **value** is pinned by a seed-backed assertion (§9), because G2 tests
presence, never value.

## 4. Rulings

Taken card by card on 2026-09-21; binding.

- **R-1 Byte draws on discharge, not on play.** The faction's cantrip is slower
  than Earth Raker/Rook and stronger over time; a Byte that lives is a card a
  turn. Standard empty-deck rule applies. **Overturned 2026-09-22**
  ([draw amendment](2026-09-22-lh-draw-design.md)): Byte gains 1 charge when
  played, so its draw can fire the turn it lands, and Faraday and Data Burst
  join the roster.
- **R-2 Chrysoprase and Watt have no Blocker.** A 40k or 90k Blocker would stall
  every turn-1 bombardment; Kilowatt at 180k is the cheapest wall, in line with
  Iron Maiden (150k) and Paddlegun (180k).
- **R-3 Volta's recipient is chosen by the player** (an on-play prompt, Hysteria's
  shape). No candidate with room → nothing, log line, no refund. Fragile stays as
  printed flavour.
- **R-4 Conduit has no pips of its own and does not stack** (§3.1.5). It is
  Inoffensive (it defends, never attacks or bombards) and Scrappy.
- **R-5 Dipole and every hover/thruster craft is an `airship`**; every FtD
  aircraft is a `plane`. Spawn-sheet altitude follows the type.
- **R-6 Decoy stands** (§3.6). Watt gains Mobile — the escort goes to the timer.
- **R-7 Luxon's spotter is any friendly LH vehicle** including a plane; the chain
  still needs a first hull.
- **R-8 Umbra keeps Stealthy and surfaces on discharge** (§3.7). The first shot is
  guaranteed short of targeted removal; every later one is on an attackable hull.
  "Rest of the game" means this hull instance.
- **R-9 Kilowatt is vanilla** — no Mobile (a 180k relocating wall would be the
  cheapest in the game), no Scrappy.
- **R-10 Ampere's stun is on play only.** A repeating `Discharge: stun` at ⚡1–2
  locks one enemy hull for the game for 200k. Target chosen on play; no enemy in
  the lane → the play resolves with no stun.
- **R-11 Eclipse keeps Stealthy permanently** (average stats, 220k); its 1v1 is
  a battle it is visible in and does not surface it.
- **R-12 Caspian keeps the sea-skimmer text** although enemy Air Screen today
  means SS Asphodel, Counter Intelligence, DWG Land Marauder and a mirror
  Angstrom. The 1v1-on-play alternative was rejected: the roster already has
  enough single-hull removal, and LH is a timer faction, not a removal one.
- **R-13 Hydrovolt is not Stealthy** — a wall must be fightable.
- **R-14 Drain is a vulnerability and a cost** (amended 2026-09-22; first
  ruled "Requires is a vulnerability, not a hurdle"). A hunted board cannot
  pay; an un-raced one pays, and must refill before its next Drain card. Gates
  are read and paid at play time only (§3.3).
- **R-15 Megawatt is vanilla with Mobile.** The "rapid strikes" second-bombard
  discharge was rejected: the backbone is the plain body that makes the timers
  safe to run.
- **R-16 Penumbra has no Mobile and no other use for its pips** — the only thing
  its charge is for is the salvo.
- **R-17 Angstrom has no Sub Screen; Candela has no Air Screen.** One screen per
  wall; a hull with both is SS's hero power on a 700-damage Mobile Blocker.
- **R-18 Cathode surfaces on discharge and duels ships *or submarines*** — the
  roster's one active anti-sub tool. Surfacing on declaration.
- **R-19 Superradiance is neither Mobile nor a Blocker nor Scrappy**: the
  offensive capital, static, paying full repairs to keep a 3-pip timer alive.
- **R-20 Terawatt keeps all three lines** (Drain 2 — first printed Requires 3;
  Generators — rate 2; transfer). The transfer is an activated ability, so Terawatt cannot both
  transfer and be an ability card's discharge host in one turn. Generators
  applies before Conduit's relay; everything caps at 4.
- **R-21 Candela is the deal**: 700k for a 1,021k hull, no text beyond the gate,
  fights at its FtD weight in battles.
- **R-22 Rectifier prints Fragile** — moot while Temporary, live once Extended
  Sortie makes it permanent (TG Audacious prints the same set for Spawn
  Audacious). Swift damage is 350 (§3.5).
- **R-23 Impedance has no on-play damage.** Terawatt's bank is the honest way to
  fire it on the turn it lands. It stays in the roster: the ladder wants a top
  rung and the faction wants its dream card.
- **R-24 EMP Salvo, Afterburner and Extended Sortie are tethered to the
  discharging hull's lane** — the setup is always visible where the effect lands.
- **R-25 Overcharge costs 1 CP and no materials.** LH has no CP generation, so
  every Overcharge is a hero power not used. A fresh hull is a legal target.
- **R-26 Afterburner's charged hull and its beneficiary may be the same hull**
  (Overcharge a fresh hull to 2, then Afterburner from itself).
- **R-27 Extended Sortie keeps the plane a plane** — Half-Cost figures for damage
  and repairs, the six-flier deck count, plane spawn altitude. Same-turn by
  construction: an un-Sortied plane evaporates at the next turn start.
- **R-28 Surge is usable with nothing to charge** — it spends the CP, does
  nothing and logs it; no hero power is gated on usefulness and this one will
  not be the first.

## 5. The roster

Costs are printed card costs; the FtD figure is the report's material cost.
Byte's text, Faraday and Data Burst are as amended by the
[2026-09-22 draw amendment](2026-09-22-lh-draw-design.md).
Drain figures are as amended on 2026-09-22 (every gate one lower than first
printed; [amendment](2026-09-22-lh-drain-charge-design.md) §6).
Every vehicle is a report craft, so `shipProfiles.test.ts`'s demand for a
profile per non-retired LH vehicle is met by importing the report (§8).

### 5.1 Pickets and batteries

| Card | Type · cost (FtD) | ⚡ | Keywords | Text |
|---|---|---|---|---|
| Byte | ship · 40k (43k) | 1 | Mobile | When played, this gains 1 charge. Discharge 1: draw a card. |
| Chrysoprase | ship · 40k (40k) | 2 | Scrappy | — |
| Volta | ship · 40k (37k) | 1 | Fragile | When played, a friendly LH vehicle in this zone gains 1 charge. |
| Conduit | ship · 70k (54k) | — | Inoffensive, Scrappy | Relay: at the start of your turn, other friendly LH vehicles in this zone gain 1 additional charge. This does not stack. |
| Dipole | airship · 70k (65k) | 2 | Mobile | — |
| Watt | ship · 90k (91k) | 1 | Scrappy, Mobile, Decoy | — |
| Luxon | plane · 60k (59k) | — | Half-Cost, Temporary | Blind on its own: can only be played into a zone where you control an LH vehicle. |

### 5.2 Raiders

| Card | Type · cost (FtD) | ⚡ | Keywords | Text |
|---|---|---|---|---|
| Faraday | airship · 140k (142k) | 2 | Mobile | When played, draw a card. |
| Umbra | sub · 150k (148k) | 2 | Stealthy | Discharge 2: deal 150k damage to the enemy base in this zone, then this surfaces — it loses Stealthy for the rest of the game. |
| Kilowatt | ship · 180k (181k) | 2 | Blocker | — |
| Ampere | ship · 200k (207k) | 2 | Mobile | When played, stun target enemy vehicle in this zone. |
| Eclipse | ship · 220k (216k) | 2 | Stealthy | Discharge 2: this vehicle fights a 1v1 against target non-Stealthy enemy vehicle in this zone. |
| Caspian | plane · 230k (230k) | — | Half-Cost, Temporary | Sea-skimmer: may be played into a zone with enemy Air Screen. |
| Hydrovolt | sub · 260k (258k) | 2 | Blocker, Sub Screen | — |
| Dynamo | airship · 350k (346k) | 1 | Mobile, Swift | Drain 1 Charge. |
| Megawatt | ship · 360k (362k) | 2 | Mobile | — |
| Penumbra | ship · 370k (375k) | 3 | — | Discharge 3: stun every enemy vehicle in this zone. |

### 5.3 Capitals

| Card | Type · cost (FtD) | ⚡ | Keywords | Text |
|---|---|---|---|---|
| Angstrom | ship · 540k (546k) | 2 | Blocker, Air Screen, Mobile | — |
| Quadrupole | airship · 560k (685k) | 2 | Blocker, Mobile | Drain 2 Charge. |
| Cathode | sub · 600k (726k) | 2 | Stealthy, Sub Screen | Drain 2 Charge. Discharge 2: this vehicle fights a 1v1 against target enemy ship or submarine in this zone, then this surfaces — it loses Stealthy for the rest of the game. |
| Superradiance | ship · 620k (626k) | 3 | — | Discharge 3: deal 300k damage to the enemy base in this zone. |
| Terawatt | ship · 640k (725k) | 4 | Blocker, Scrappy, Mobile | Drain 2 Charge. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge. |
| Candela | ship · 700k (1,021k) | 2 | Blocker, Sub Screen, Scrappy, Mobile | Drain 3 Charge. |
| Rectifier | plane · 700k (735k) | — | Half-Cost, Temporary, Fragile, Swift | — |
| Impedance | ship · 750k (1,327k) | 2 | Blocker | Drain 4 Charge. Discharge 2: deal 400k damage to the enemy base in this zone. |

### 5.4 Abilities

| Card | Cost | Text |
|---|---|---|
| EMP Salvo | 60k | Discharge 2 from a friendly LH vehicle: stun target enemy vehicle in that zone. |
| Overcharge | 0k + 1 CP | Target friendly LH vehicle gains 2 charge. |
| Afterburner | 50k | Discharge 2 from a friendly LH vehicle: a friendly LH vehicle played this turn in that zone may attack the base this turn. |
| Extended Sortie | 100k | Discharge 2 from a friendly LH vehicle: a friendly LH plane in that zone loses Temporary. |
| Data Burst | 50k | Discharge 2 from a friendly LH vehicle: draw 2 cards. |

### 5.5 Shape checks

- Stun sources 3; beams 3 (150/300/400); 1v1 hulls 2; Swift 2 + Afterburner;
  Blockers 7; Sub Screens 3, Air Screen 1; fliers 7 with Faraday (2026-09-22) against the 6-copy limit;
  subs 3; timers static, walls and raiders Mobile.
- Curve: 40k pickets on turn 1; Conduit/Dipole 70k; Watt 90k turn 2; Umbra turn
  2; Kilowatt/Ampere/Eclipse turn 3; Hydrovolt turn 4; Dynamo/Megawatt/Penumbra
  turn 5; Angstrom turn 8; Quadrupole/Cathode turn 8; Superradiance/Terawatt
  turn 9; Candela/Impedance turn 10; Rectifier (350k to play) turn 5.
- Charge timeline, un-raced: Chrysoprase (t1) + Watt + Volta (t2) + Kilowatt (t3)
  is 5 pips on turn 4 from 350k of hulls; Dynamo's gate opens turn 5; on an
  un-raced board every Drain capital is gated by materials, not pips, but each
  one drains the board it lands on (2026-09-22), so two in a row pay twice. A raced board — pickets
  fleet-attacked on turns 2–4 — has none, and its capitals sit in hand. That is
  the interaction the mechanic exists to create.
- A legal sample deck: 2 Chrysoprase, 2 Byte, Volta, Conduit, 2 Watt, Dipole,
  Luxon, Umbra, 2 Kilowatt, Ampere, Eclipse, Penumbra, Megawatt, Angstrom, EMP
  Salvo, Overcharge — twenty cards, two fliers, one sub.

## 6. Hero power

> **Surge** — LH · 1 CP · once per game
> Every friendly LH vehicle gains 1 charge.

Capped per hull; planes and Conduit gain nothing; usable on your own turn
outside battles like every faction power (R-28). A **new** power: engine key
`surge` in `FACTION_POWERS` (LH) and `HERO_POWER_LABELS`, a new `hero_powers`
row (`hero:LH:Surge`), and the Flyby row removed by its own migration SQL — the
seed only upserts. `flyby`'s implementation and its `FACTION_POWERS` entry stay for in-flight
games; with its row gone the UI never offers it.

## 7. Retirements and data migration

- **Reused names, rows update in place** (`card:LH:<name>` ids are derived from
  the name): Ampere, Umbra, Conduit, Quadrupole, Terawatt, Angstrom, Candela,
  Hydrovolt, Rectifier, Eclipse. Existing decks holding them get the new card;
  in-flight games keep their dealt snapshots.
- **Retired** (`retired: true`, rows stay seeded — 2026-09-02 §2.1): Coulomb,
  Thunderbird, Sapphire, Sapphire Screen, Spectrum, Orbit, Orbit Flank, Robotic
  Assemblers, and the four `[TG]` pool cards ([TG] Amusement, [TG] Fear,
  [TG] Hysteria, [TG] Obsession) whose only reader was the pool draw.
- **Old registry ids.** Six lose their last live carrier and join
  `DELIBERATE_ORPHANS`: `ampereOnPlay`, `conduitEffect`, `quadrupoleOnPlay`,
  `terawattJoin`, `candelaOnPlay`, `eclipseEffect`. Six are still named by
  retired rows and simply stay implemented: `coulombEffect`, `sapphireEffect`,
  `spectrumEffect`, `sapphireScreenEffect`, `orbitFlankEffect`,
  `roboticAssemblersEffect`. **No new card reuses an old id** (the Kraken/
  Paddlegun rule): a frozen snapshot naming `eclipseEffect` must keep the old
  behaviour.
- **Hero power:** Surge row added, Flyby row deleted (§6).
- `DECK_FACTIONS` and `decks_faction_check` already list LH — no faction
  migration.

## 8. Engine design

**Stamps** (per hull; every one named in `discardSnapshotOf`, the trap
architecture.md records): `charge` (number, top level beside `playedOnTurn`),
`stunnedUntilTurn` (number | undefined), `swiftOnTurn` (number | undefined),
`meta.revokedKeywords` (string[], engine-written like `grantedKeywords`, and
*restored* on discard rather than shed). `mintHull` resets all four.

**Card data keys** (seeded, in `meta`): `chargeMax`, `chargeRate`,
`chargeRelay`, `dischargeCost`, `dischargeFrom`, `requiresCharge`,
`deployRequiresLhVehicle`, `ignoresAirScreen`. `DATA_EFFECT_KEYS` gains the
five named in §3.10 (`chargeRelay`, `chargeRate`, `requiresCharge`,
`deployRequiresLhVehicle`, `ignoresAirScreen`); `chargeMax`, `dischargeCost`
and `dischargeFrom` always sit beside an effect name and need no entry.

**Keywords:** `SWIFT: 'swift'`, `DECOY: 'decoy'` in **both** keyword maps
(`shared/gameSettings.ts` and `supabase/seed/source/gameSettings.js` — the
wave-7 trap; `tgFaction.test.ts`'s drift guard fails otherwise) and in the
frontend's keyword glossary/icons. Stun is a **state**, not a keyword: it never
appears in `keywords`, only as the stamp and a badge.

**One helper each:** `addCharge(entry, n)` (clamp), `spendCharge(entry, n)`,
`isStunned(entry, turn)`, `stunHull(entry, turn)`, `revokeKeywordsFrom(entry,
keywords)`, `boardChargeOf(state, side)` (and, since 2026-09-22, the Drain
split helpers `chargePayersOf`, `suggestedChargeSplit`, `chargeSplitError`,
`chargeSplitIsForced`), `dealBaseDamage(game, actor, zone,
materials, cardName)`.

**Chokepoints touched:** `endTurn` (tick + relay), `activate.ts`
(`dischargeCost` gate and spend), `placement.ts` (`requiresCharge` gate and,
since 2026-09-22, its drain,
`deployRequiresLhVehicle`, `ignoresAirScreen`, stunned Screens, the friendly
`dischargeFrom` validation), `baseAttack.ts` (Swift, `swiftOnTurn`, stunned
strikers, stunned Blockers), `battleDeclare.ts` (stunned attackers, stunned
Stealthy), `heroPowers.ts`/`moveEntry` (stunned movers; Surge),
`enemyVehicleOptions` + the field-target validator (Decoy), `gameEngine.ts`
(`discardSnapshotOf`, `revokeKeywordsFrom`).

**Registry ids, all new:** `byteDraw`, `voltaJumpStart`, `ampereStun`,
`eclipseDuel`, `umbraSalvo`, `penumbraPulse`, `cathodeDuel`,
`superradianceBeam`, `terawattTransfer`, `impedanceBeam`, `empSalvoEffect`,
`overchargeEffect`, `afterburnerEffect`, `extendedSortieEffect`; hero power
`surge`. Registered in `lhEffects.ts` (already imported by `engine/index.ts`
and listed in `shared-manifest.json`).

**Constants** in `shared/gameSettings.ts`, one each (two equal figures never
share one — the `VENGEFUL_BASE_DAMAGE` rule): `CHARGE_TICK = 1`,
`CONDUIT_RELAY_CHARGE = 1`, `VOLTA_JUMP_START_CHARGE = 1`,
`TERAWATT_TRANSFER_CHARGE = 2`, `OVERCHARGE_CHARGE = 2`, `SURGE_CHARGE = 1`,
`STUN_DURATION_TURNS = 1`, `UMBRA_SALVO_DAMAGE = 150_000`,
`SUPERRADIANCE_BEAM_DAMAGE = 300_000`, `IMPEDANCE_BEAM_DAMAGE = 400_000`.
Discharge costs, maxes, rates and gates are card data, pinned in the balance
test.

**Frontend:** pips on the hull in `BoardZone` (⚡ current/max) and a ⚡N stat on
`PhysicalCard` and `CardDetailsModal`; a stun badge; the activation button
labelled "Discharge N"; hand tooltips for Drain and Discharge-from, and the
Drain split dialog (2026-09-22); Swift and
Decoy icons and glossary entries. The spawn sheet and `customBattle.ts` are
untouched.

**PracticeAI:** an LH deck in `botDecks.ts`; an LH entry in the primer's
faction notes; the evaluator (`evaluator.ts`) must value pips (a fraction of the
discharge payoff, more as the fuse shortens) and stun, or the scored flow will
never fire a timer and never protect one. Legality is free — the menu asks the
engine — judgement is not.

**Ship profiles:** `npm run profiles:import -- <reports>\LH.cards.md`, spread
into `SHIP_PROFILES`, add `shipProfiles/LH.ts` to both functions in
`shared-manifest.json`, `functions:sync`; the strict test then demands a profile
for every non-retired LH vehicle — all 24 are report craft.

## 9. Testing and verification

- **TDD per effect** (card-effects.md): failing engine test first, then the
  implementation, then the full suite with the before → after count.
- **`supabase/seed/balance/lh.balance.test.ts`** pins every printed cost, ⚡N,
  discharge cost, rate, relay, gate and beam figure, and asserts the retired
  set and the reused-name set — the seed-backed *value* assertions §3.10
  requires.
- **Coverage guards** G1–G4: every new id implemented and reachable; the six
  orphans listed; `KNOWN_GAPS` stays empty (the wave lands data and effects
  together).
- **Rule tests**, each pinned: tick order and caps; relay non-stacking; Drain
  read and paid at play only and across lanes; stun's six reads and its +1.0 expiry from
  both sides' turns; Swift on a plane reads 350; Decoy redirects and never
  blanks (Sub Strike case); revocation restored on discard and absent on a
  replayed card; beams ignore Blocker and no-op on a fallen base; forced 1v1s
  leave the lane activation unspent; the discarded-stamp round trip through
  `reshuffleDiscard`.
- **Drift:** `functionSharedSync.test.ts` after `functions:sync`;
  `seedDataSync.test.ts` after `seed:build`; both keyword maps agree.
- **Profiles and primer:** `shipProfiles.test.ts` (+lookup, +order) and
  `rulesPrimer.test.ts` (roster) move with the faction.
- **Typecheck and functions:** `npx tsc -p tsconfig.json --noEmit`,
  `npm --prefix frontend run build`, `npm run functions:check`.
- **Browser:** an LH deck against PracticeAI — pips render and tick, the
  discharge button appears and spends, a stun badges and expires, a Drain
  card explains itself in hand, Surge charges the board, a Swift plane
  bombards on arrival, the spawn sheet lists the right blueprints. Signed in via
  `scripts/qa-login.mjs`, never by typing credentials.
- **Post-merge:** the `seed-apply.yml` run is green, `npm run seed:verify`
  reports drift 0, both function versions incremented and read back with
  `shipProfiles/LH.ts` and the new ids **by content**, the Netlify
  `PhysicalCard-*.js` chunk carries `LH:Byte`.

## 10. Delivery shape

One branch, one PR. Order of work inside it: foundation (stamps, helpers,
tick, activation gate, keywords, `discardSnapshotOf`) → rule tests → cards by
tier (each: test, effect, seed row) → abilities → Surge → profiles → bot deck,
faction note, evaluator → frontend → migration SQL (Flyby row) → `seed:build`,
`functions:sync` → the verification list above. Deploy by merge; the seed job
applies the data beside the function deploy (CLAUDE.md, "Seed data does NOT
deploy with the code").

## 11. Out of scope and bench

Not in this wave: Bull Shark migrating to `dealBaseDamage` (a cleanup, not a
behaviour change); a keyword-removal UI beyond the hull's badge; any
non-LH card gaining Decoy or Swift; balance tuning by eval — the numbers above
are first-print values to be revisited after play, the way every balance pass
has been.

Bench — report craft not in the roster, swappable one-for-one later:
Isochronous (the fastest ship; a second Mobile Blocker), Thyristor (flying
brawler; the roster's only CP source if it returns), Tesla + Monopole Squadron
(a drone carrier summoning its squadron into every battle — Obelisk's shape; cut
for roster size, not quality), Jupiter, Exadyne, Exajoule, Gigawatt, Faraday,
Cherenkov, Gamma Squad, Fuse, Spectrum, Thunderbird, Static Squadron,
Ascension Prototype, Anode, Axion, Solaris, Tempest, Thunderbolt.
