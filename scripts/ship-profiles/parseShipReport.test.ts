import { describe, expect, it } from 'vitest'
import { parseShipReport, renderProfilesModule } from './parseShipReport'

// A faithful excerpt of FtDArmament's DWG.cards.md: the fleet table plus
// four ship sections chosen for their quirks — Corsair (plain), Flying
// Squirrel (a note paragraph between the card table and the ratings),
// Buccaneer (an italic aside BEFORE the card table, which is FtD's spelling
// and not ours) and Brigand (an Escort row). Weapons/defence tables are cut
// to a row each; the parser must skip them either way.
const REPORT = `# Deepwater Guard — player cards

Sixteen pirate craft, one card each.

## Fleet at a glance

| Craft | What it is | Cost | Strength (DWG rank) | Fire·Tough·Speed·Range·Cost | Ships·Air·Subs·Missiles | Verdict |
|---|---|---|---|---|---|---|
| Corsair | escort boat | 31 k | 415 (#69) | 1·1·2·2·1 | 2·3·1·2 | expendable anti-air picket |
| Flying Squirrel | flight of 3 missile planes | 85 k | 625 (#55) | 3·1·5·1·2 | 3·2·1·2 | pure glass cannon |
| Buccaneer | airship battleship | 297 k | 3,518 (#10) | 5·4·4·5·4 | 5·1·1·3 | flying brawler |
| Brigand | missile destroyer | 357 k | 5,849 (#3) | 5·3·2·5·4 | 4·4·2·4 | glass cannon |

Strength is the game's own overall power number (median campaign craft: 977). Ranks are among the 110 DWG designs.

---

## Corsair

### The card

| | |
|---|---|
| **Type** | Small escort boat that guards loot convoys. 53 m, 1,727 blocks. |
| **Cost** | 31,338 — cheaper than 6 in 7 campaign craft. |
| **Speed** | 21.3 m/s (41 kn) — average for a boat. |
| **Fights at** | 1,000 m — the typical distance. |
| **Sees** | One radar, one sonar, a camera, 10 missile warners. |
| **In one line** | **Expendable anti-air picket.** Radar missiles on turrets, nothing that can take a hit. |

### Ratings

| Rating | Score | Why |
|---|---|---|
| Firepower | ●○○○○ 1 | 18th percentile |
| Toughness | ●○○○○ 1 | 16th percentile — 16 M armoured health |
| Speed | ●●○○○ 2 | 31st percentile |
| Range | ●●○○○ 2 | 33rd percentile |
| Cost | ●○○○○ 1 | 14th percentile |
| vs Ships | ●●○○○ 2 | eight small radar missiles and one 174 mm gun |
| vs Aircraft | ●●●○○ 3 | radar-guided missiles on turrets; designers rate it 1.5× vs air |
| vs Submarines | ●○○○○ 1 | has a sonar, nothing to fire at what it finds |
| vs Missiles | ●●○○○ 2 | 10 warners and two flare launchers; no interceptors or guns |

### Weapons

| Weapon | Count | Hits | What it does |
|---|---|---|---|
| 174 mm cannon | 1 | ships, aircraft | Turret on an anti-air mount, 9 m barrel; shell design not stored. |

### Defences

| Layer | Blocks | What it does |
|---|---|---|
| Hull | wood, 1,727 blocks | 0.7 M block health. |

**Verdict: expendable.** Firepower 0.8× and toughness 0.9× the per-material median of craft its price — an ordinary cheap boat; anything serious kills it.

---

## Flying Squirrel

### The card

| | |
|---|---|
| **Type** | A flight of three small missile aircraft built from scrap, 296 blocks each (24 m long). |
| **Cost** | 84,882 for the flight (about 28 k each). |
| **Speed** | 95 m/s (185 kn) — very fast; flies at up to 200 m. |
| **Fights at** | 800 m — closer than almost anything; it must fly in. |
| **Sees** | Two all-round radars per aircraft, plus radio snoopers. |
| **In one line** | **Pure glass cannon.** Four missiles per plane, no armour; fires and dies. |

Firepower and toughness below are for one aircraft (the game rates each craft on its own); cost is for the flight.

### Ratings

| Rating | Score | Why |
|---|---|---|
| Firepower | ●●●○○ 3 | 55th percentile — for one plane |
| Toughness | ●○○○○ 1 | 2nd percentile — 2 M armoured health per plane |
| Speed | ●●●●● 5 | 82nd percentile |
| Range | ●○○○○ 1 | 2nd percentile |
| Cost | ●●○○○ 2 | 33rd percentile (the flight) |
| vs Ships | ●●●○○ 3 | 12 radar-guided missiles across the flight, 6 of them large; designers rate it 1.5× vs surface |
| vs Aircraft | ●●○○○ 2 | the same missiles can chase aircraft, but there are few and no guns |
| vs Submarines | ●○○○○ 1 | nothing reaches under water |
| vs Missiles | ●●○○○ 2 | a flare launcher per plane and speed |

### Weapons (per aircraft, ×3)

| Weapon | Count | Hits | What it does |
|---|---|---|---|
| Large radar-guided missiles | 2 | ships, aircraft | 7 blocks, 3 warheads, big thruster — the strike. |

### Defences

| Layer | Blocks | What it does |
|---|---|---|
| Hull | scrap, 296 blocks per plane | 87 k block health per plane. |

**Verdict: pure glass cannon.** Per plane, roughly 7× the firepower per material of craft its price and about a tenth of the toughness — the flimsiest craft on this list.

---

## Buccaneer

*In-game spelling "Bucanneer".*

### The card

| | |
|---|---|
| **Type** | Airship battleship — a flying fortress (up to 196 m altitude) with an onboard pub. 116 m long, 47 m wide, 14,172 blocks. |
| **Cost** | 296,659 — dearer than 2 in 3 campaign craft. |
| **Speed** | 82.7 m/s (161 kn) — fast; quicker than 9 in 10 ships. |
| **Fights at** | 1,500 m. |
| **Sees** | Four radars (two tracking), laser rangefinders, an infrared camera, eight rangefinders, 11 warners. No sonar. |
| **In one line** | **Flying brawler.** Eighteen CRAM guns rain shells on targets below; nothing to shoot at aircraft. Designers: 45 battle points. |

### Ratings

| Rating | Score | Why |
|---|---|---|
| Firepower | ●●●●● 5 | 81st percentile — 72 % of it CRAM |
| Toughness | ●●●●○ 4 | 71st percentile — 4th toughest pirate craft |
| Speed | ●●●●○ 4 | 76th percentile |
| Range | ●●●●● 5 | 87th percentile |
| Cost | ●●●●○ 4 | 70th percentile |
| vs Ships | ●●●●● 5 | 18 CRAM guns (4 quad + 4 twin-turret + 10 hull), most with hardener |
| vs Aircraft | ●○○○○ 1 | one downward-firing 50 mm gun; CRAM cannot track aircraft; no anti-air missiles |
| vs Submarines | ●○○○○ 1 | no sonar, nothing reaches under water |
| vs Missiles | ●●●○○ 3 | 6 interceptors, 11 warners, two radar decoys |

### Weapons

| Weapon | Count | Hits | What it does |
|---|---|---|---|
| 2,000 mm CRAM cannons, quad turret | 4 | ships | 15 m barrels, hardener + frag. |

### Defences

| Layer | Blocks | What it does |
|---|---|---|
| Reactive armour | 136 ERA | Second-thickest on this list. |

**Verdict: brawler.** Firepower 1.6× and toughness 1.2× the per-material median for its price, and fast for its size — but blind to submarines and defenceless against aircraft.

---

## Brigand

### The card

| | |
|---|---|
| **Type** | Missile destroyer — a pirate copy of a Steel Striders destroyer. 113 m, 7,305 blocks. |
| **Cost** | 356,550 — 4th most expensive pirate craft. |
| **Speed** | 26.6 m/s (52 kn) — average for a ship. |
| **Fights at** | 1,850 m — the longest reach on this list. |
| **Escort** | The **Gull** gyrocopter (350 blocks): 18 mm strafing gun, one heat-seeking and one radar-guided missile, flares. |
| **Sees** | Four tracking radars, four sonar sets, cameras with five trackers, 10 warners — full coverage. |
| **In one line** | **Glass cannon.** Sixty-six launchers and two flak cannons on a wooden hull; shields are its armour. |

### Ratings

| Rating | Score | Why |
|---|---|---|
| Firepower | ●●●●● 5 | 82nd percentile — 58 % missiles |
| Toughness | ●●●○○ 3 | 52nd percentile; 13th among craft of its price |
| Speed | ●●○○○ 2 | 37th percentile |
| Range | ●●●●● 5 | 95th percentile |
| Cost | ●●●●○ 4 | 74th percentile |
| vs Ships | ●●●●○ 4 | six heavy missiles, six 7-warhead torpedoes, 32 medium missiles; the guns have no armour-piercing round |
| vs Aircraft | ●●●●○ 4 | 36 radar-guided missiles plus two 200 mm flak cannons on anti-air mounts |
| vs Submarines | ●●○○○ 2 | six sonar torpedoes and four sonar sets; nothing else reaches under water |
| vs Missiles | ●●●●○ 4 | 14 interceptors, a flak close-in gun, chaff, 10 warners, 11 shields |

### Weapons

| Weapon | Count | Hits | What it does |
|---|---|---|---|
| Medium radar-guided missiles | 32 | aircraft, ships | Vertical launch, 3 warheads each — the main volley. |

### Defences

| Layer | Blocks | What it does |
|---|---|---|
| Energy shields | 11 projectors | The real armour. |

**Verdict: glass cannon.** Firepower 1.5× and toughness 0.38× the per-material median for its price.
`

describe('parseShipReport', () => {
  const profiles = parseShipReport(REPORT, 'DWG')

  it('keys every ship section as FACTION:Name, in report order', () => {
    expect(Object.keys(profiles)).toEqual(['DWG:Corsair', 'DWG:Flying Squirrel', 'DWG:Buccaneer', 'DWG:Brigand'])
  })

  it('reads the card table, the fleet-table role and strength, and the verdict', () => {
    expect(profiles['DWG:Corsair']).toEqual({
      role: 'escort boat',
      strength: 415,
      rank: 69,
      type: 'Small escort boat that guards loot convoys. 53 m, 1,727 blocks.',
      speed: '21.3 m/s (41 kn) — average for a boat.',
      fightsAt: '1,000 m — the typical distance.',
      sees: 'One radar, one sonar, a camera, 10 missile warners.',
      summary: 'Expendable anti-air picket. Radar missiles on turrets, nothing that can take a hit.',
      scores: {
        firepower: { score: 1, why: '18th percentile' },
        toughness: { score: 1, why: '16th percentile — 16 M armoured health' },
        speed: { score: 2, why: '31st percentile' },
        range: { score: 2, why: '33rd percentile' },
        cost: { score: 1, why: '14th percentile' },
      },
      matchups: {
        ships: { score: 2, why: 'eight small radar missiles and one 174 mm gun' },
        aircraft: { score: 3, why: 'radar-guided missiles on turrets; designers rate it 1.5× vs air' },
        submarines: { score: 1, why: 'has a sonar, nothing to fire at what it finds' },
        missiles: { score: 2, why: '10 warners and two flare launchers; no interceptors or guns' },
      },
      verdict: 'expendable',
      verdictDetail: 'Firepower 0.8× and toughness 0.9× the per-material median of craft its price — an ordinary cheap boat; anything serious kills it.',
    })
  })

  it('leaves the FtD material cost out — it contradicts the printed card cost', () => {
    for (const p of Object.values(profiles)) expect(p).not.toHaveProperty('cost')
    expect(JSON.stringify(profiles['DWG:Corsair'])).not.toContain('31,338')
  })

  it('keeps a note paragraph between the card table and the ratings', () => {
    expect(profiles['DWG:Flying Squirrel'].note).toBe(
      'Firepower and toughness below are for one aircraft (the game rates each craft on its own); cost is for the flight.',
    )
    expect(profiles['DWG:Corsair'].note).toBeUndefined()
  })

  it('ignores an aside before the card table, and unbolds the escort row', () => {
    expect(profiles['DWG:Buccaneer'].note).toBeUndefined()
    expect(JSON.stringify(profiles['DWG:Buccaneer'])).not.toContain('Bucanneer')
    expect(profiles['DWG:Brigand'].escort).toBe(
      'The Gull gyrocopter (350 blocks): 18 mm strafing gun, one heat-seeking and one radar-guided missile, flares.',
    )
    expect(profiles['DWG:Corsair'].escort).toBeUndefined()
  })

  it('takes a multi-word verdict label and unbolds the summary', () => {
    expect(profiles['DWG:Flying Squirrel'].verdict).toBe('pure glass cannon')
    expect(profiles['DWG:Flying Squirrel'].summary).toBe('Pure glass cannon. Four missiles per plane, no armour; fires and dies.')
    expect(profiles['DWG:Brigand'].strength).toBe(5849)
    expect(profiles['DWG:Brigand'].rank).toBe(3)
  })

  it('reads a tied rank ("#44=", craft the game scores 0) as the rank plus a tie flag', () => {
    // WF.cards.md: four craft share rank 44 because FtD gives drills and rams no strength.
    const tied = REPORT.replace('| Corsair | escort boat | 31 k | 415 (#69) |', '| Corsair | escort boat | 31 k | 0 (#44=) |')
    const corsair = parseShipReport(tied, 'DWG')['DWG:Corsair']
    expect(corsair.strength).toBe(0)
    expect(corsair.rank).toBe(44)
    expect(corsair.rankTied).toBe(true)
    // An untied rank carries no flag at all, so the generated JSON stays as it was.
    expect(profiles['DWG:Brigand']).not.toHaveProperty('rankTied')
  })

  it('fails when the fleet table and a ship section disagree on a score', () => {
    const tampered = REPORT.replace('| Corsair | escort boat | 31 k | 415 (#69) | 1·1·2·2·1 |', '| Corsair | escort boat | 31 k | 415 (#69) | 1·1·3·2·1 |')
    expect(() => parseShipReport(tampered, 'DWG')).toThrow(/Corsair.*speed/)
  })

  it('fails when a ship section lacks a rating or the verdict', () => {
    const missing = REPORT.replace('| vs Missiles | ●●○○○ 2 | 10 warners and two flare launchers; no interceptors or guns |\n', '')
    expect(() => parseShipReport(missing, 'DWG')).toThrow(/Corsair.*missiles/)
    const noVerdict = REPORT.replace('**Verdict: expendable.** Firepower 0.8×', 'Firepower 0.8×')
    expect(() => parseShipReport(noVerdict, 'DWG')).toThrow(/Corsair.*verdict/)
  })

  it('fails when a fleet-table craft has no section, or a section no fleet-table row', () => {
    const orphanRow = REPORT.replace(/## Brigand[\s\S]*$/, '')
    expect(() => parseShipReport(orphanRow, 'DWG')).toThrow(/Brigand/)
    const orphanSection = REPORT.replace('| Brigand | missile destroyer | 357 k | 5,849 (#3) | 5·3·2·5·4 | 4·4·2·4 | glass cannon |\n', '')
    expect(() => parseShipReport(orphanSection, 'DWG')).toThrow(/Brigand/)
  })
})

describe('renderProfilesModule', () => {
  it('emits a generated, typed TS module that names its source', () => {
    const src = renderProfilesModule('DWG', 'DWG.cards.md', parseShipReport(REPORT, 'DWG'))
    expect(src.startsWith('// GENERATED by scripts/import-ship-profiles.ts from DWG.cards.md')).toBe(true)
    expect(src).toContain("import type { ShipProfile } from '../shipProfiles.ts'")
    expect(src).toContain('export const DWG_SHIP_PROFILES: Record<string, ShipProfile> = {')
    expect(src).toContain('"DWG:Corsair"')
    expect(src.endsWith('\n')).toBe(true)
  })
})
