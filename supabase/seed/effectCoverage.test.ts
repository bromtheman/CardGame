import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'
import { TRIGGERS, GT_HEAVY_AIRSHIP_MIN_COST } from '../../shared/gameSettings'
import '../../shared/engine/index'
import { DATA_EFFECT_KEYS, effectName, isImplemented } from '../../shared/effects/registry'

const ALL_META_KEYS = [...Object.values(TRIGGERS), 'costModifier']
const key = (c: { faction: string; name: string }) => `${c.faction}:${c.name}`

// Permanently exempt: card text that is player-conduct guidance for the spawn
// sheet, not a trigger. There is nothing for the engine to fire.
const EXEMPT: Record<string, string> = {
  'SS:Falcon Squadron': 'Robotic-shaped conduct text: players apply it when reporting results',
}

// The gaps not yet closed (Falcon Squadron is permanently EXEMPT above).
// Delete entries as their wave lands — the "KNOWN_GAPS contains no stale
// entries" test below rejects stale ones, so this list only shrinks.
//
// The five effect-coverage waves emptied it: all 65 of the spec's cards are
// built. Everything left arrived AFTER them, from the 2026-08-30 balance pass.
const KNOWN_GAPS: Record<string, string> = {
  // The 2026-08-30 balance pass seeded twelve cards whose text needs behaviour
  // the engine does not have yet. Every one plays vanilla and logs a note at
  // play time (spec §3.9); none of them silently half-works.
  //
  //   new mechanics
  //     DWG:Albacore / DWG:Tarpon  a per-player, per-zone aircraft deploy lock
  //     SS:Chrysaor                a resourceSurge that RAISES the price
  //     SS:Paladin                 a resourceSurge that GRANTS halfCost+temporary
  //     SS:Blockade                a rider that fires when the ENEMY deploys
  //     SS:Victoria                an activated ability paid in materials, not CP
  //     WF:Judgement               the same, plus a costModifier off enemy hull types
  //     WF:Purifier                a zone deploy prerequisite + "no base damage"
  //   existing primitives, not yet registered under their own name
  //     SS:Nothung                 spawnVehicles('Sacrilego')
  //     SS:Balmung                 a catalog mint into hand at costDelta -cost
  //     WF:Harbringer              DWG Waters' clause-2 guest, WF ships <=100k
  'DWG:Albacore': 'balance 2026-08-30', 'DWG:Tarpon': 'balance 2026-08-30',
  'SS:Chrysaor': 'balance 2026-08-30', 'SS:Paladin': 'balance 2026-08-30',
  'SS:Blockade': 'balance 2026-08-30', 'SS:Victoria': 'balance 2026-08-30',
  'SS:Nothung': 'balance 2026-08-30', 'SS:Balmung': 'balance 2026-08-30',
  'WF:Purifier': 'balance 2026-08-30', 'WF:Judgement': 'balance 2026-08-30',
  'WF:Harbringer': 'balance 2026-08-30',
}

// Cards that pass G2 — they resolve at least one implemented effect — but
// whose card text is only partly built. G2 asks "any implemented effect?",
// not "does all of the text work?", so it cannot see these, and they cannot
// go in KNOWN_GAPS without tripping the stale-entry assertion. Delete an
// entry when its wave finishes the card.
// Empty as of wave 4: both entries (Plunderer's clause 2, DWG Waters'
// clauses 2-3) were closed by the wave that owned them. The assertion below
// still runs over it, so the next partly-built card has a home ready.
const PARTIAL: Record<string, string> = {}

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
// given a hand/field-targeting key) — playOnVehicleEffect meta on a vehicle
// is dead (every handler but PLAY_CARD_TO_ZONE rejects `card.type !==
// 'ability'`, and nothing in wave 3 changes that for the field-targeting
// handler). playOnCardEffect is different: spec §4.3 DP6 has
// PLAY_CARD_TARGETING_CARD_IN_HAND gain an optional `zoneId` and accept a
// vehicle carrying that key too — deploy it to the zone, then fire the
// effect, no `spendCard` — so this table admits the row now, ahead of that
// handler change landing later in the wave (Excalibur is the only vehicle
// that will use it). An ability, meanwhile, is always `spendCard`'d and
// never pushed into `zone.cards`, so it can never become a battle
// participant and onDeathEffect can never fire for one. It does NOT catch
// Garrison's actual bug: playOnVehicleEffect and playOnCardEffect are both
// legitimately dispatchable for an *ability* card (via two different
// handlers keyed on the same type), so a same-type mix-up between the two
// needs a human
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
// Wave 2 adds `onActivate` to the vehicle row: ACTIVATE_VEHICLE
// (shared/engine/activate.ts) dispatches it for a hull already on the board,
// which only a vehicle can be. It is deliberately absent from the ability
// row — an ability is spendCard'd on resolution and never enters zone.cards.
// Wave 4 adds the three DP2 keys to the vehicle row, ahead of the first card
// that names one — the ordering wave 2 used for onActivate and wave 3 for
// playOnCardEffect. G3 skips any card still in KNOWN_GAPS, so this table only
// bites the moment a card is closed, and the failure then reads as "this card
// is mis-wired" rather than "the table is out of date".
//
// They are deliberately absent from the `ability` row. An ability is
// spendCard'd on resolution and never enters zone.cards, so it can never be a
// battle participant. DWG Waters is the apparent exception and is not one: its
// battle-time riders fire from state.zoneEffects, dispatched by the registry
// name that entry already stores, under its existing playOnZoneEffect key —
// so no ability carries a DP2 key (spec §4.3, DP2 departure 2).
const REACHABLE_TRIGGERS: Record<string, readonly string[]> = {
  vehicle: [
    'onPlayEffect', 'playOnZoneEffect', 'onDeathEffect', 'costModifier', 'onActivate',
    'playOnCardEffect', 'onBattleEffect', 'onBattleVictory', 'onBattleDefeat',
  ],
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

  // All five effect-coverage waves are done, so nothing labelled for one may
  // reappear. The count is deliberately exact rather than `toHaveLength(0)`:
  // it is what stops a thirteenth gap being added quietly, and it must be
  // decremented by whoever closes one.
  it('all five waves are complete — only the 2026-08-30 balance pass remains', () => {
    for (const wave of ['wave 1', 'wave 2', 'wave 3', 'wave 4', 'wave 5']) {
      expect(Object.values(KNOWN_GAPS).filter((w) => w.startsWith(wave))).toEqual([])
      expect(Object.values(PARTIAL).filter((w) => w.startsWith(wave))).toEqual([])
    }
    expect(Object.keys(KNOWN_GAPS)).toHaveLength(11)
  })

  it('PARTIAL names real cards that currently pass G1 and G2, and never overlaps KNOWN_GAPS', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [key(c), c]))
    const problems: string[] = []
    for (const k of Object.keys(PARTIAL)) {
      const card = byKey.get(k)
      if (!card) { problems.push(`${k} (no such card)`); continue }
      if (KNOWN_GAPS[k] !== undefined) { problems.push(`${k} (also in KNOWN_GAPS)`); continue }
      const { unimplemented, silent } = classify(card)
      // A card that is wholly broken belongs in KNOWN_GAPS, not here.
      if (unimplemented.length > 0 || silent) problems.push(`${k} (is a full gap, not a partial)`)
    }
    expect(problems).toEqual([])
  })

  it('the GT airship pool splits 6 light / 8 heavy on the spec §7.3 cost cliff', async () => {
    const { cards } = await loadSeedData()
    const airships = cards.filter(
      (c) => c.isBuiltIn && c.faction === 'GT' && c.vehicleType === 'airship',
    )
    const heavy = airships.filter((c) => c.materialCost >= GT_HEAVY_AIRSHIP_MIN_COST)
    expect(airships).toHaveLength(14)
    expect(heavy).toHaveLength(8)
  })
})
