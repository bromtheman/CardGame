import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import { TRIGGERS } from '../../shared/gameSettings'
import '../../shared/engine/index'
import { DATA_EFFECT_KEYS, effectName, isImplemented } from '../../shared/effects/registry'

const ALL_META_KEYS = [...Object.values(TRIGGERS), 'costModifier']
const key = (c: { faction: string; name: string }) => `${c.faction}:${c.name}`

// Permanently exempt: card text that is player-conduct guidance for the spawn
// sheet, not a trigger. There is nothing for the engine to fire.
const EXEMPT: Record<string, string> = {
  'SS:Falcon Squadron': 'Robotic-shaped conduct text: players apply it when reporting results',
}

// 36 of the 65 gaps (Falcon Squadron is permanently EXEMPT above),
// baselined so the guard is green from day one. Delete entries as their wave
// lands — the third test rejects stale ones, so this list only shrinks.
const KNOWN_GAPS: Record<string, string> = {
  'SS:PredatorX': 'wave 1', 'LH:Orbit': 'wave 1',
  'SS:Excalibur': 'wave 1', 'OW:Garrison': 'wave 1', 'SS:Repairmen Ready': 'wave 1',
  'GT:[GT] Osprey': 'wave 1',

  'GT:[GT] Hunchback': 'wave 2', 'GT:[GT] Monsoon': 'wave 2', 'LH:Spectrum': 'wave 2',
  'DWG:Kraken': 'wave 2', 'OW:Special Foundries': 'wave 2',
  'LH:Robotic Assemblers': 'wave 2', 'OW:Defensive Parapet': 'wave 2',
  'LH:Sapphire Screen': 'wave 2', 'WF:All for the Cause': 'wave 2',

  'DWG:Flying Squirrel Attack': 'wave 3', 'WF:Martyr Attack': 'wave 3',
  'SS:Air Strafe': 'wave 3', 'LH:Orbit Flank': 'wave 3', 'DWG:Gang Up': 'wave 3',
  'SS:Braveheart': 'wave 3', 'LH:Eclipse': 'wave 3', 'OW:Trebuchet': 'wave 3',

  'SS:Catshark': 'wave 4', 'SS:Dryad': 'wave 4', 'OW:The Onyx Throne': 'wave 4',
  'SS:Sacrilego': 'wave 4', 'OW:Iron Cordon': 'wave 4', 'LH:Terawatt': 'wave 4',
  'WF:Buzzsaw': 'wave 4', 'WF:Veles': 'wave 4',

  'WF:Ambush': 'wave 5', 'DWG:Ongoing Attrition': 'wave 5', 'OW:Sub Killer': 'wave 5',
  'DWG:Recurring Threat': 'wave 5', 'OW:Sabotage': 'wave 5',
}

// cardText is optional on SeedCard, so it must be optional here too.
function classify(card: { faction: string; name: string; cardText?: string; meta?: unknown }) {
  const meta = (card.meta ?? {}) as Record<string, unknown>
  const names = ALL_META_KEYS
    .map((k) => effectName({ meta }, k))
    .filter((n): n is string => n !== null)
  const hasData = DATA_EFFECT_KEYS.some((k) => meta[k] !== undefined && meta[k] !== null)
  return {
    unimplemented: names.filter((n) => !isImplemented(n)),
    silent: (card.cardText ?? '').trim() !== '' && names.length === 0 && !hasData,
  }
}

describe('built-in card effect coverage', () => {
  it('G1: every effect name in meta resolves to a registered implementation', async () => {
    const { cards } = await loadSeedData()
    const offenders: string[] = []
    for (const card of cards.filter((c) => c.isBuiltIn)) {
      const { unimplemented } = classify(card)
      if (unimplemented.length > 0 && KNOWN_GAPS[key(card)] === undefined) {
        offenders.push(`${key(card)} → ${unimplemented.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('G2: every card with card text has an implemented effect, data key, or exemption', async () => {
    const { cards } = await loadSeedData()
    const offenders: string[] = []
    for (const card of cards.filter((c) => c.isBuiltIn)) {
      const { silent } = classify(card)
      if (silent && KNOWN_GAPS[key(card)] === undefined && EXEMPT[key(card)] === undefined) {
        offenders.push(key(card))
      }
    }
    expect(offenders).toEqual([])
  })

  it('KNOWN_GAPS contains no stale entries — delete a card once its wave lands', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [key(c), c]))
    const stale: string[] = []
    for (const k of Object.keys(KNOWN_GAPS)) {
      const card = byKey.get(k)
      if (!card) { stale.push(`${k} (no such card)`); continue }
      const { unimplemented, silent } = classify(card)
      if (unimplemented.length === 0 && !silent) stale.push(k)
    }
    expect(stale).toEqual([])
  })

  it('the gap shrinks as waves land', () => {
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(36)
  })
})
