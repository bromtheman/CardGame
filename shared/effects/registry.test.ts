import { describe, expect, it } from 'vitest'
import {
  CATALOG_EFFECTS, effectFor, effectName, isImplemented, noteUnimplemented,
  registerEffect,
} from './registry.ts'
import './dwgEffects.ts'
import type { CardInstance } from '../engine/gameInit.ts'
import { inst, makeGame } from '../engine/testFixtures.ts'

describe('effect registry', () => {
  it('registers and finds an effect', () => {
    registerEffect('testEffect', () => true)
    expect(isImplemented('testEffect')).toBe(true)
    expect(effectFor('nopeEffect')).toBeNull()
  })
  it('effectName trims stored names and rejects non-strings', () => {
    const card = inst({ meta: { onPlayEffect: 'orbitFlankEffect ', onDeathEffect: 7 } })
    expect(effectName(card, 'onPlayEffect')).toBe('orbitFlankEffect')
    expect(effectName(card, 'onDeathEffect')).toBeNull()
    expect(effectName(card, 'playOnZoneEffect')).toBeNull()
  })
  it('noteUnimplemented logs once per unknown name, skips implemented ones', () => {
    registerEffect('knownEffect', () => true)
    const game = makeGame()
    const card = inst({ name: 'Orbit', meta: { onPlayEffect: 'knownEffect', onActivate: 'mysteryEffect' } })
    noteUnimplemented(game, card)
    expect(game.state.log.filter((l) => l.includes('mysteryEffect'))).toHaveLength(1)
    expect(game.state.log.some((l) => l.includes('knownEffect'))).toBe(false)
  })
  it('exposes the catalog-requiring set', () => {
    expect(CATALOG_EFFECTS.has('reservesEffect')).toBe(true)
    expect(CATALOG_EFFECTS.has('spawnBuccaneerEffect')).toBe(true)
  })
})

describe('needsCatalog registration flag', () => {
  it('adds flagged effects to CATALOG_EFFECTS and leaves unflagged ones out', () => {
    registerEffect('t_needsCatalog', () => true, { needsCatalog: true })
    registerEffect('t_plain', () => true)
    expect(CATALOG_EFFECTS.has('t_needsCatalog')).toBe(true)
    expect(CATALOG_EFFECTS.has('t_plain')).toBe(false)
  })
})

describe('noteUnimplemented — text with no effect name', () => {
  const note = (over: Partial<CardInstance>) => {
    const game = makeGame()
    noteUnimplemented(game, inst({ meta: {}, ...over }))
    return game.state.log
  }

  it('notes a card whose text names no effect at all', () => {
    expect(note({ name: 'Ransack', cardText: 'draw a card and gain 1cp.' }))
      .toEqual(['Ransack: its card text has no implemented effect yet — plays as vanilla'])
  })

  it('stays silent for a true vanilla card', () => {
    expect(note({ name: 'Tarpon', cardText: '' })).toEqual([])
  })

  it('stays silent when additionalSpawns satisfies the text', () => {
    expect(note({ name: 'Abactor', cardText: 'add an additional copy', meta: { additionalSpawns: 1 } }))
      .toEqual([])
  })

  it('stays silent when resourceSurge satisfies the text', () => {
    expect(note({
      name: 'PredatorX', cardText: 'loses its HALFCOST keyword',
      meta: { resourceSurge: { materialsOver: 120000, extraSpawns: 1 } },
    })).toEqual([])
  })

  it('does not add the second note when an unimplemented name was already reported', () => {
    const log = note({ name: 'Kraken', cardText: 'refresh a hero power', meta: { onPlayEffect: 'ghostEffect' } })
    expect(log).toEqual(['Kraken: effect "ghostEffect" is not implemented yet — plays as vanilla'])
  })

  it('stays silent when the card has a working effect', () => {
    expect(note({ name: 'Crossbones', cardText: 'draw a card', meta: { onPlayEffect: 'crossbonesOnPlay' } }))
      .toEqual([])
  })
})
