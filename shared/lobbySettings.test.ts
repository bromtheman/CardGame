import { describe, expect, it } from 'vitest'
import {
  MATERIALS_PER_TURN, MAX_MATERIALS_PER_TURN, MIN_MATERIALS_PER_TURN,
} from './gameSettings.ts'
import {
  DEFAULT_LOBBY_SETTINGS, materialsPerTurnOf, validateLobbySettings,
} from './lobbySettings.ts'

describe('DEFAULT_LOBBY_SETTINGS', () => {
  it('is 3 water zones at 1000 HP', () => {
    expect(DEFAULT_LOBBY_SETTINGS.zones).toEqual([
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
    ])
  })
  it('offers the default income so the lobby form opens on it', () => {
    expect(DEFAULT_LOBBY_SETTINGS.materialsPerTurn).toBe(MATERIALS_PER_TURN)
  })
})

describe('materialsPerTurnOf', () => {
  it('uses the lobby override when the host set one', () => {
    expect(materialsPerTurnOf({ materialsPerTurn: 120_000 })).toBe(120_000)
  })
  it('falls back to the default for games saved before the setting existed', () => {
    expect(materialsPerTurnOf({})).toBe(MATERIALS_PER_TURN)
    expect(materialsPerTurnOf(undefined)).toBe(MATERIALS_PER_TURN)
  })
})

describe('validateLobbySettings', () => {
  it('accepts the default and mixed biomes', () => {
    expect(validateLobbySettings(DEFAULT_LOBBY_SETTINGS)).toEqual({
      settings: DEFAULT_LOBBY_SETTINGS,
    })
    const mixed = {
      zones: [
        { biome: 'water', baseHp: 500 },
        { biome: 'beach', baseHp: 1000 },
        { biome: 'land', baseHp: 2000 },
      ],
    }
    expect(validateLobbySettings(mixed)).toEqual({ settings: mixed })
  })
  it('rejects wrong zone counts, bad biomes, bad hp, junk', () => {
    expect('errors' in validateLobbySettings({ zones: [] })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'space', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'water', baseHp: 0 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      zones: [
        { biome: 'water', baseHp: 1.5 },
        { biome: 'water', baseHp: 1000 },
        { biome: 'water', baseHp: 1000 },
      ],
    })).toBe(true)
    expect('errors' in validateLobbySettings(null)).toBe(true)
    expect('errors' in validateLobbySettings('x')).toBe(true)
  })
  it('accepts a custom materialsPerTurn inside the allowed range', () => {
    const custom = { ...DEFAULT_LOBBY_SETTINGS, materialsPerTurn: 120_000 }
    expect(validateLobbySettings(custom)).toEqual({ settings: custom })
    const min = { ...DEFAULT_LOBBY_SETTINGS, materialsPerTurn: MIN_MATERIALS_PER_TURN }
    expect(validateLobbySettings(min)).toEqual({ settings: min })
    const max = { ...DEFAULT_LOBBY_SETTINGS, materialsPerTurn: MAX_MATERIALS_PER_TURN }
    expect(validateLobbySettings(max)).toEqual({ settings: max })
  })
  it('accepts settings saved before the setting existed', () => {
    const legacy = { zones: DEFAULT_LOBBY_SETTINGS.zones }
    expect(validateLobbySettings(legacy)).toEqual({ settings: legacy })
  })
  it('rejects a materialsPerTurn that is out of range, fractional, or not a number', () => {
    for (const bad of [
      MIN_MATERIALS_PER_TURN - 1, MAX_MATERIALS_PER_TURN + 1, 0, -75_000,
      75_000.5, NaN, '75000', null,
    ]) {
      expect('errors' in validateLobbySettings({
        ...DEFAULT_LOBBY_SETTINGS, materialsPerTurn: bad,
      })).toBe(true)
    }
  })
  it('accepts and rejects deckRules overrides', () => {
    const withRules = { ...DEFAULT_LOBBY_SETTINGS, deckRules: { deckSize: 30, uniqueCopyLimit: 3 } }
    expect(validateLobbySettings(withRules)).toEqual({ settings: withRules })
    expect('errors' in validateLobbySettings({
      ...DEFAULT_LOBBY_SETTINGS, deckRules: { deckSize: 0 },
    })).toBe(true)
    expect('errors' in validateLobbySettings({
      ...DEFAULT_LOBBY_SETTINGS, deckRules: { bogusKey: 5 },
    })).toBe(true)
  })
})
