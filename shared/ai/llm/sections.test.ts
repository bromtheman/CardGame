import { describe, expect, it } from 'vitest'
import type { GameAction } from '../../engine/engineTypes'
import { knownActionTypes } from '../../engine/index'
import { formatTableTalk, isTableTalk } from './tableTalk'
import {
  inSection, isSectionMarker, nextSection, SECTION_ASKS, SECTION_LINES, SECTION_MARKERS, SECTION_ORDER, sectionOf,
} from './sections'
import type { Section } from './sections'

// One sample per action type, and where the spec (§3.1) puts it. The pin
// below fails when the engine learns a type this table does not place.
const SAMPLES: Record<GameAction['type'], GameAction> = {
  END_TURN: { type: 'END_TURN' },
  CONCEDE: { type: 'CONCEDE' },
  ABANDON: { type: 'ABANDON' },
  PLAY_CARD_TO_ZONE: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 1 },
  PLAY_ABILITY_CARD: { type: 'PLAY_ABILITY_CARD', instanceId: 'x' },
  PLAY_CARD_TARGETING_CARD_ON_FIELD: { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'x', targetInstanceId: 'y' },
  PLAY_CARD_TARGETING_CARD_IN_HAND: { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: 'x', targetInstanceId: 'y' },
  MOVE_VEHICLE: { type: 'MOVE_VEHICLE', instanceId: 'x', zoneId: 2 },
  ACTIVATE_VEHICLE: { type: 'ACTIVATE_VEHICLE', instanceId: 'x' },
  ATTACK_ENEMY_BASE: { type: 'ATTACK_ENEMY_BASE', zoneId: 1 },
  ATTACK_ENEMY_FLEET: { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 },
  RESPOND_TO_ATTACK: { type: 'RESPOND_TO_ATTACK', optOutIds: [] },
  SUBMIT_BATTLE_REPORT: { type: 'SUBMIT_BATTLE_REPORT', results: {}, repairs: [] },
  DECIDE_BATTLE_REPORT: { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] },
  SET_ALERT_CARD: { type: 'SET_ALERT_CARD', instanceId: 'x' },
  USE_HERO_POWER: { type: 'USE_HERO_POWER', power: 'draw' },
  RESOLVE_PENDING_EFFECT: { type: 'RESOLVE_PENDING_EFFECT', cancel: true },
}
const EXPECTED: Record<GameAction['type'], Section | null> = {
  END_TURN: 'finish', CONCEDE: null, ABANDON: null,
  PLAY_CARD_TO_ZONE: 'deploy', PLAY_ABILITY_CARD: 'deploy',
  PLAY_CARD_TARGETING_CARD_ON_FIELD: 'deploy', PLAY_CARD_TARGETING_CARD_IN_HAND: 'deploy',
  MOVE_VEHICLE: 'deploy', ACTIVATE_VEHICLE: 'activate',
  ATTACK_ENEMY_BASE: 'fight', ATTACK_ENEMY_FLEET: 'fight',
  RESPOND_TO_ATTACK: null, SUBMIT_BATTLE_REPORT: null, DECIDE_BATTLE_REPORT: null,
  SET_ALERT_CARD: 'deploy', USE_HERO_POWER: 'deploy', RESOLVE_PENDING_EFFECT: null,
}

describe('sectionOf', () => {
  it('places every action type the engine knows', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...new Set(knownActionTypes())].sort())
    for (const [type, action] of Object.entries(SAMPLES)) {
      expect(sectionOf(action), type).toBe(EXPECTED[type as GameAction['type']])
    }
  })
  it('splits the hero powers: Flanking Maneuver and Tactical Positioning fight, the rest deploy', () => {
    const power = (p: Extract<GameAction, { type: 'USE_HERO_POWER' }>['power']): GameAction => ({ type: 'USE_HERO_POWER', power: p })
    for (const p of ['salvage', 'draw', 'rapidRedeployment', 'boardingParty', 'changeOrder', 'flyby', 'counterIntelligence', 'drones'] as const) {
      expect(sectionOf(power(p)), p).toBe('deploy')
    }
    expect(sectionOf(power('flankingManeuver'))).toBe('fight')
    expect(sectionOf(power('tacticalPositioning'))).toBe('fight')
  })
})

describe('sections', () => {
  it('run deploy → activate → fight → finish, and nextSection stops at finish', () => {
    expect(SECTION_ORDER).toEqual(['deploy', 'activate', 'fight', 'finish'])
    expect(nextSection('deploy')).toBe('activate')
    expect(nextSection('fight')).toBe('finish')
    expect(nextSection('finish')).toBeNull()
  })
  it('show deploy items again in finish, and nothing else crosses', () => {
    expect(inSection('deploy', 'deploy')).toBe(true)
    expect(inSection('deploy', 'finish')).toBe(true)
    expect(inSection('finish', 'finish')).toBe(true)
    expect(inSection('fight', 'finish')).toBe(false)
    expect(inSection('finish', 'deploy')).toBe(false)
    expect(inSection(null, 'deploy')).toBe(false)
    expect(inSection('activate', 'activate')).toBe(true)
  })
  it('markers carry the table-talk prefix without the spoken quotes, and are recognised', () => {
    for (const s of SECTION_ORDER) {
      expect(isTableTalk(SECTION_MARKERS[s])).toBe(true)
      expect(SECTION_MARKERS[s]).not.toContain('"')
      expect(isSectionMarker(SECTION_MARKERS[s])).toBe(true)
    }
    expect(SECTION_MARKERS.fight).toBe('PracticeAI: fighting…')
    expect(isSectionMarker(formatTableTalk('fighting…'))).toBe(false)   // a spoken line, not a marker
    expect(isSectionMarker('Zone 1: base bombardment for 60')).toBe(false)
  })
  it('names every section in its line and tells the model where next goes in its ask', () => {
    for (const s of SECTION_ORDER) expect(SECTION_LINES[s]).toContain(`SECTION: ${s.toUpperCase()}`)
    expect(SECTION_ASKS.deploy).toContain('ACTIVATE')
    expect(SECTION_ASKS.activate).toContain('FIGHT')
    expect(SECTION_ASKS.fight).toContain('FINISH')
    expect(SECTION_ASKS.finish).toContain('END TURN')
    for (const s of SECTION_ORDER) expect(SECTION_ASKS[s]).toContain('[]')
  })
})
