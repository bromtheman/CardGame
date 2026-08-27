import { describe, expect, it } from 'vitest'
import {
  CATALOG_EFFECTS, effectFor, effectName, isImplemented, noteUnimplemented,
  registerEffect,
} from './registry.ts'
import './dwgEffects.ts'
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
