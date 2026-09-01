import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  BLUEPRINT_OVERRIDES,
  BUILT_IN_BLUEPRINT_ROOT,
  BlueprintResolutionError,
  buildCustomBattle,
  resolveBlueprintPath,
  serializeCustomBattle,
} from './customBattle.ts'
import { FACTIONS } from './gameSettings.ts'

const marauder = { name: 'Marauder', faction: FACTIONS.DWG }
const bulwark = { name: 'Bulwark', faction: FACTIONS.OW }

describe('resolveBlueprintPath', () => {
  it('derives the path from faction and card name', () => {
    expect(resolveBlueprintPath(marauder)).toBe('Built In/Neter/DWG/Marauder')
  })

  it('prefers an explicit blueprintId for cards whose name differs from the file', () => {
    // FtD ships this one misspelled; the card is named correctly.
    expect(
      resolveBlueprintPath({ name: 'Buccaneer', faction: FACTIONS.DWG, blueprintId: 'DWG/Bucanneer' }),
    ).toBe('Built In/Neter/DWG/Bucanneer')
  })

  it('tolerates a leading slash in blueprintId', () => {
    expect(
      resolveBlueprintPath({ name: 'x', faction: FACTIONS.OW, blueprintId: '/OW/OnyxThrone' }),
    ).toBe('Built In/Neter/OW/OnyxThrone')
  })

  it('never emits a file extension or drive letter', () => {
    const path = resolveBlueprintPath(bulwark)
    expect(path.startsWith(BUILT_IN_BLUEPRINT_ROOT)).toBe(true)
    expect(path).not.toMatch(/\.blueprint$/)
    expect(path).not.toMatch(/^[A-Za-z]:/)
  })

  it('applies BLUEPRINT_OVERRIDES for cards the game names differently', () => {
    expect(resolveBlueprintPath({ name: 'Buccaneer', faction: 'DWG' })).toBe(
      'Built In/Neter/DWG/Bucanneer',
    )
    expect(resolveBlueprintPath({ name: 'Harbringer', faction: 'WF' })).toBe(
      'Built In/Neter/WF/Harbinger',
    )
  })

  it('follows an override into another faction folder', () => {
    // Both of these are seeded under one faction but shipped in GT/.
    expect(resolveBlueprintPath({ name: 'Obelisk', faction: 'TG' })).toBe('Built In/Neter/GT/Obelisk')
    expect(resolveBlueprintPath({ name: '[GT] Damacy', faction: 'OW' })).toBe(
      'Built In/Neter/GT/Damacy',
    )
  })

  it('lets an explicit blueprintId win over an override', () => {
    expect(
      resolveBlueprintPath({ name: 'Buccaneer', faction: 'DWG', blueprintId: 'DWG/Marauder' }),
    ).toBe('Built In/Neter/DWG/Marauder')
  })

  it('keys every override as "<faction>/<name>" with a faction-qualified target', () => {
    for (const [key, value] of Object.entries(BLUEPRINT_OVERRIDES)) {
      expect(key, `override key ${key}`).toMatch(/^[A-Z]+\/.+/)
      expect(value, `override value ${value}`).toMatch(/^[A-Z]+\/.+/)
      expect(value, `override value ${value}`).not.toMatch(/\.blueprint$/)
    }
  })

  it('throws for a faction with no blueprint folder and no explicit id', () => {
    expect(() => resolveBlueprintPath({ name: 'Whatever', faction: FACTIONS.NEUTRAL })).toThrow(
      BlueprintResolutionError,
    )
  })

  it('carries the offending card on the error', () => {
    // NEUTRAL is what create-card stamps on every player-made card, so this is
    // the path a custom card in a fleet takes. LaunchInFtdButton reads `.card`
    // to name the card rather than repeating this developer-facing message.
    const custom = { name: 'My Dreadnought', faction: FACTIONS.NEUTRAL }
    let thrown: unknown = null
    try {
      resolveBlueprintPath(custom)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BlueprintResolutionError)
    expect((thrown as BlueprintResolutionError).card.name).toBe('My Dreadnought')
  })
})

describe('buildCustomBattle', () => {
  it('rejects a battle with fewer than two teams', () => {
    expect(() => buildCustomBattle([{ name: 'Team 1', cards: [marauder] }])).toThrow(/at least 2 teams/)
  })

  it('writes both _fileName and FileName, kept in sync', () => {
    const file = buildCustomBattle([
      { name: 'Team 1', cards: [marauder], isPlayerTeam: true },
      { name: 'Team 2', cards: [bulwark] },
    ])
    const bp = file.Teams[0]!.Blueprints[0]!
    expect(bp._fileName).toBe('Built In/Neter/DWG/Marauder')
    expect(bp.FileName).toBe(bp._fileName)
    expect(bp.IsInFtd).toBe(true)
  })

  it('marks exactly the requested team as the player team', () => {
    const file = buildCustomBattle([
      { name: 'Team 1', cards: [marauder], isPlayerTeam: true },
      { name: 'Team 2', cards: [bulwark] },
    ])
    expect(file.Teams.map((t) => t.IsPlayerTeam)).toEqual([true, false])
  })

  it('carries every vehicle onto its own side', () => {
    const file = buildCustomBattle([
      { name: 'Attackers', cards: [marauder, { name: 'Kraken', faction: FACTIONS.DWG }] },
      { name: 'Defenders', cards: [bulwark] },
    ])
    expect(file.Teams[0]!.Blueprints).toHaveLength(2)
    expect(file.Teams[1]!.Blueprints).toHaveLength(1)
    expect(file.Teams[0]!.Name).toBe('Attackers')
  })

  it('applies spawn distance and material overrides', () => {
    const file = buildCustomBattle(
      [{ name: 'a', cards: [marauder] }, { name: 'b', cards: [bulwark] }],
      { spawnDistanceBetweenTeams: 2500, materialsPerTeam: 100000 },
    )
    expect(file.SpawnDistanceBetweenTeams).toBe(2500)
    expect(file.MaterialsPerTeam).toBe(100000)
  })

  it('reproduces the Newtonsoft $type discriminators the game requires', () => {
    const rules = buildCustomBattle([
      { name: 'a', cards: [marauder] },
      { name: 'b', cards: [bulwark] },
    ]).Rules as Record<string, { $type?: string }>

    expect(rules.TimeLimit!.$type).toBe(
      'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+TimeLimitRule, Ftd',
    )
    // The game serialises this key misspelled; matching it is required, not optional.
    expect(rules.MaxAlittude).toBeDefined()
    expect(rules.MaxAltitude).toBeUndefined()
  })

  it('serialises to compact JSON with no trailing newline', () => {
    const text = serializeCustomBattle(
      buildCustomBattle([
        { name: 'a', cards: [marauder] },
        { name: 'b', cards: [bulwark] },
      ]),
    )
    expect(text.endsWith('\n')).toBe(false)
    expect(text).not.toContain('\n  ')
    expect(JSON.parse(text).Teams).toHaveLength(2)
  })
})

// A battle saved by FtD 4.2.x itself, kept as the source of truth for the schema.
// If a game update changes the format, these fail and tell you exactly where —
// far better than a battle file that loads with vehicles silently missing.
const gameSaved = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/game-saved.customBattle', import.meta.url)), 'utf8'),
) as Record<string, unknown>

const keysOf = (o: unknown): string[] => Object.keys(o as object).sort()

describe('parity with a file saved by the game', () => {
  const generated = buildCustomBattle([
    { name: 'Team 1', cards: [marauder] },
    { name: 'Team 2', cards: [bulwark] },
  ])

  it('has the same top-level keys', () => {
    expect(keysOf(generated)).toEqual(keysOf(gameSaved))
  })

  it('has the same team and blueprint keys', () => {
    const theirTeam = (gameSaved.Teams as Record<string, unknown>[])[0]!
    expect(keysOf(generated.Teams[0]!)).toEqual(keysOf(theirTeam))
    expect(keysOf(generated.Teams[0]!.Blueprints[0]!)).toEqual(
      keysOf((theirTeam.Blueprints as unknown[])[0]),
    )
  })

  it('emits a byte-identical Rules block', () => {
    expect(generated.Rules).toEqual(gameSaved.Rules)
  })

  it('addresses blueprints exactly as the game does', () => {
    const theirs = (gameSaved.Teams as { Blueprints: { FileName: string }[] }[])
    expect(generated.Teams[0]!.Blueprints[0]!.FileName).toBe(theirs[0]!.Blueprints[0]!.FileName)
    expect(generated.Teams[1]!.Blueprints[0]!.FileName).toBe(theirs[1]!.Blueprints[0]!.FileName)
  })
})
