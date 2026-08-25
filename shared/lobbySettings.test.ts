import { describe, expect, it } from 'vitest'
import { DEFAULT_LOBBY_SETTINGS, validateLobbySettings } from './lobbySettings.ts'

describe('DEFAULT_LOBBY_SETTINGS', () => {
  it('is 3 water zones at 1000 HP', () => {
    expect(DEFAULT_LOBBY_SETTINGS.zones).toEqual([
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
      { biome: 'water', baseHp: 1000 },
    ])
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
