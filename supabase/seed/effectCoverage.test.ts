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

// The gaps not yet closed (Falcon Squadron is permanently EXEMPT above),
// baselined so the guard is green from day one. Delete entries as their wave
// lands — the "KNOWN_GAPS contains no stale entries" test below rejects
// stale ones, so this list only shrinks.
const KNOWN_GAPS: Record<string, string> = {
  'GT:[GT] Hunchback': 'wave 2', 'GT:[GT] Monsoon': 'wave 2', 'LH:Spectrum': 'wave 2',
  'DWG:Kraken': 'wave 2', 'OW:Special Foundries': 'wave 2',
  'LH:Robotic Assemblers': 'wave 2', 'OW:Defensive Parapet': 'wave 2',
  'LH:Sapphire Screen': 'wave 2', 'WF:All for the Cause': 'wave 2',

  'DWG:Flying Squirrel Attack': 'wave 3', 'WF:Martyr Attack': 'wave 3',
  'SS:Air Strafe': 'wave 3', 'LH:Orbit Flank': 'wave 3', 'DWG:Gang Up': 'wave 3',
  'SS:Braveheart': 'wave 3', 'LH:Eclipse': 'wave 3', 'OW:Trebuchet': 'wave 3',
  'SS:Excalibur': 'wave 3 — a vehicle with a hand target has no play path',

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

// G1 above only checks that a trigger key's effect NAME resolves to a
// registered implementation — it never checks whether the engine reads that
// KEY at all for a card of the card's own TYPE. That gap is exactly the
// shape of bug Garrison shipped with: its meta named a real, registered
// implementation (garrisonEffect) under playOnVehicleEffect, so G1 was
// satisfied even though no vehicle-targeting handler could ever be the
// right path for a card whose text targets your own hand. This check would
// have caught it had the mismatch been of *type* (e.g. a vehicle wrongly
// given a hand/field-targeting key) — a vehicle can only ever be played
// through PLAY_CARD_TO_ZONE (every other handler in placement.ts rejects
// `card.type !== 'ability'`), so playOnVehicleEffect/playOnCardEffect meta
// on a vehicle is dead, and an ability is always `spendCard`'d and never
// pushed into `zone.cards`, so it can never become a battle participant and
// onDeathEffect can never fire for one. It does NOT catch Garrison's actual
// bug: playOnVehicleEffect and playOnCardEffect are both legitimately
// dispatchable for an *ability* card (via two different handlers keyed on
// the same type), so a same-type mix-up between the two needs a human
// reading the card text against the key, which is how Garrison's fix
// actually happened. Confirmed by reverting Garrison's key and rerunning
// this suite — see the wave report for the (still-green) output. Verified
// against the four registerHandler blocks in shared/engine/placement.ts
// (resolvePlayEffects's `keys` argument at each call site) and the
// onDeathEffect dispatch in shared/engine/battleResolve.ts's
// destroyedEntries loop — not against the original review notes, which had
// onDeathEffect on the ability side and missed that playOnZoneEffect is
// read unconditionally by PLAY_CARD_TO_ZONE regardless of type
// (resolvePlayEffects's key list there does not branch on card.type), so it
// is technically reachable for a vehicle too.
const REACHABLE_TRIGGERS: Record<string, readonly string[]> = {
  vehicle: ['onPlayEffect', 'playOnZoneEffect', 'onDeathEffect', 'costModifier'],
  ability: ['onPlayEffect', 'playOnZoneEffect', 'playOnVehicleEffect', 'playOnCardEffect', 'costModifier'],
}

function unreachableTriggers(card: { type: string; meta?: unknown }): string[] {
  const meta = (card.meta ?? {}) as Record<string, unknown>
  const allowed = REACHABLE_TRIGGERS[card.type] ?? []
  return ALL_META_KEYS.filter((k) => effectName({ meta }, k) !== null && !allowed.includes(k))
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

  it('G3: every trigger key a card carries is one the engine dispatches for its type', async () => {
    const { cards } = await loadSeedData()
    const offenders: string[] = []
    for (const card of cards.filter((c) => c.isBuiltIn)) {
      if (KNOWN_GAPS[key(card)] !== undefined) continue
      const bad = unreachableTriggers(card)
      if (bad.length > 0) offenders.push(`${key(card)} (${card.type}) → ${bad.join(', ')}`)
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

  it('wave 1 is complete — no wave-1 entries remain', () => {
    expect(Object.values(KNOWN_GAPS).filter((w) => w === 'wave 1')).toEqual([])
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(31)
  })
})
