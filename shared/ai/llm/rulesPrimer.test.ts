import { describe, expect, it } from 'vitest'
import { KEYWORDS, MATERIALS_PER_TURN, SURVIVE_HP_PERCENT } from '../../gameSettings'
import { shipProfilesForFaction } from '../../shipProfiles'
import { FACTION_NOTES, GENERAL_TIPS } from './factionNotes'
import { TEMPO_GUARD_TURNS } from './llmSettings'
import { HOW_YOU_PLAY, KEYWORD_GLOSSARY, PRIMER_TEMPLATE, PRIMER_VALUES, renderPrimer, tempoGuardLine } from './rulesPrimer'

describe('rules primer', () => {
  it('carries no literal number — every figure is a placeholder filled from gameSettings', () => {
    const stripped = PRIMER_TEMPLATE.replace(/\{\{[A-Z_]+\}\}/g, '')
    expect(stripped).not.toMatch(/\d/)
    for (const text of Object.values(KEYWORD_GLOSSARY)) expect(text).not.toMatch(/\d/)
    for (const block of Object.values(HOW_YOU_PLAY)) expect(block).not.toMatch(/\d/)
  })
  it('times a stun from the turn it lands, whoever stunned it (2026-09-23 Overheat)', () => {
    expect(PRIMER_TEMPLATE).toContain('until the end of the turn after the one it was stunned in')
    expect(PRIMER_TEMPLATE).not.toContain("until the end of its owner's next turn")
  })
  it('gives the economy its own rule: materials are overwritten each turn, never saved', () => {
    // One clause inside the turn-flow bullet lost to the model's "materials
    // are a stockpile" prior (2026-09-17 bot_decisions: "conserving resources
    // until my material income increases"). The rule stands alone, and says
    // what saving actually does — nothing.
    const rules = PRIMER_TEMPLATE.slice(PRIMER_TEMPLATE.indexOf('RULES'), PRIMER_TEMPLATE.indexOf('KEYWORDS'))
    expect(rules).toContain('\n- Materials are not savings.')
    expect(rules).toMatch(/overwritten .* whether you spent everything or nothing/)
  })
  it('has a glossary line for every keyword the engine knows', () => {
    for (const keyword of Object.values(KEYWORDS)) expect(KEYWORD_GLOSSARY[keyword], keyword).toBeTruthy()
  })
  it('shows the exact JSON object the model must answer with, per flow', () => {
    for (const key of ['"plan"', '"expectation"', '"summary"', '"battle"', '"zoneId"', '"outcome"', '"confidence"', '"tableTalk"']) {
      expect(HOW_YOU_PLAY.single, key).toContain(key)
    }
    for (const key of ['"actions"', '"then"', '"note"', '"battle"', '"zoneId"', '"outcome"', '"confidence"', '"tableTalk"', '"continue"', '"next"']) {
      expect(HOW_YOU_PLAY.sections, key).toContain(key)
    }
    for (const block of Object.values(HOW_YOU_PLAY)) {
      expect(block.startsWith('HOW YOU PLAY\n')).toBe(true)
      expect(block).toContain('ONE JSON object')
    }
  })
  it('renders the single flow’s answer shape by default and the sectioned flow’s on request, after the same prefix', () => {
    const single = renderPrimer('DWG')
    const sections = renderPrimer('DWG', 'sections')
    // Each block's own {{TEMPO_GUARD_LINE}} placeholder is resolved by render,
    // so the byte-for-byte check is against the block with that one swap made
    // — same block, same rule, its digit no longer literal.
    const guardLine = tempoGuardLine(TEMPO_GUARD_TURNS)
    expect(single).toContain(HOW_YOU_PLAY.single.replace('{{TEMPO_GUARD_LINE}}', guardLine))
    expect(single).not.toContain('"actions"')
    expect(sections).toContain(HOW_YOU_PLAY.sections.replace('{{TEMPO_GUARD_LINE}}', guardLine))
    expect(sections).not.toContain('"plan"')
    expect(sections).toContain('DEPLOY')
    expect(sections).toContain('continues from ACTIVATE')
    expect(single.slice(0, single.indexOf('HOW YOU PLAY'))).toBe(sections.slice(0, sections.indexOf('HOW YOU PLAY')))
    expect(sections).not.toContain('{{')
  })
  it('renders every placeholder, the faction, and the glossary', () => {
    const text = renderPrimer('DWG')
    expect(text).not.toContain('{{')
    expect(text).toContain('captain of the DWG fleet')
    expect(text).toContain(String(MATERIALS_PER_TURN))
    expect(text).toContain(`${SURVIVE_HP_PERCENT}%`)
    expect(text).toContain(KEYWORD_GLOSSARY[KEYWORDS.BLOCKER])
  })
  it('appends the general tips and the faction’s own playstyle notes, ahead of the answer shape', () => {
    const text = renderPrimer('DWG')
    expect(text).toContain('GENERAL TIPS')
    expect(text).toContain(GENERAL_TIPS)
    expect(text).toContain('YOUR FACTION')
    expect(text).toContain(FACTION_NOTES.DWG!.text)
    expect(text.indexOf('GENERAL TIPS')).toBeLessThan(text.indexOf('YOUR FACTION'))
    expect(text.indexOf('YOUR FACTION')).toBeLessThan(text.indexOf('HOW YOU PLAY'))
  })
  it('leaves the faction section out entirely for a faction with no notes yet', () => {
    const text = renderPrimer('OW')
    expect(text).toContain(GENERAL_TIPS)
    expect(text).not.toContain('YOUR FACTION')
    expect(text).not.toContain('Crossbones')
    expect(text).not.toMatch(/\n\n\n/)
  })
  it('rosters every profiled hull of the faction under YOUR FLEET, between the playstyle notes and the answer shape', () => {
    const text = renderPrimer('DWG')
    expect(text.indexOf('YOUR FACTION')).toBeLessThan(text.indexOf('YOUR FLEET'))
    expect(text.indexOf('YOUR FLEET')).toBeLessThan(text.indexOf('HOW YOU PLAY'))
    const fleet = text.slice(text.indexOf('YOUR FLEET'), text.indexOf('HOW YOU PLAY'))
    const profiles = shipProfilesForFaction('DWG')
    expect(profiles.length).toBeGreaterThan(0)
    for (const { name } of profiles) expect(fleet).toContain(`\n- ${name} (`)
    expect(fleet).toContain(
      '- Crossbones (CRAM battleship, flagship): fire 5, tough 4, speed 2, range 5; vs ships 5, aircraft 2, subs 1, missiles 3. Brawler, not glass cannon.',
    )
    // The scale is explained in words, once, so the digits on each line read as scores.
    expect(fleet).toMatch(/one weakest to five strongest/)
  })
  it('rosters every SS hull under YOUR FLEET, after the general tips and ahead of the answer shape', () => {
    // SS has profiles but (as of this writing) no playstyle notes, so the
    // fleet section follows the tips directly and must still space cleanly.
    const text = renderPrimer('SS')
    expect(text.indexOf('GENERAL TIPS')).toBeLessThan(text.indexOf('YOUR FLEET'))
    expect(text.indexOf('YOUR FLEET')).toBeLessThan(text.indexOf('HOW YOU PLAY'))
    const fleet = text.slice(text.indexOf('YOUR FLEET'), text.indexOf('HOW YOU PLAY'))
    const profiles = shipProfilesForFaction('SS')
    expect(profiles).toHaveLength(27)
    for (const { name } of profiles) expect(fleet).toContain(`\n- ${name} (`)
    expect(fleet).toContain(
      '- Tyr (flagship battleship): fire 5, tough 5, speed 3, range 5; vs ships 5, aircraft 2, subs 1, missiles 5. Flagship tank. Nine 380 mm armour-piercing guns, 88 interceptors, the toughest hull on this list; nothing under water. Designers: 50 battle points, difficulty 3.',
    )
    expect(text).not.toMatch(/\n\n\n/)
  })
  it('rosters the WF hulls the same way, summaries and all', () => {
    const text = renderPrimer('WF')
    const fleet = text.slice(text.indexOf('YOUR FLEET'), text.indexOf('HOW YOU PLAY'))
    for (const { name } of shipProfilesForFaction('WF')) expect(fleet).toContain(`\n- ${name} (`)
    expect(fleet).toContain(
      '- Martyr (kamikaze nuke drone): fire 1, tough 1, speed 5, range 1; vs ships 3, aircraft 1, subs 1, missiles 1. Suicide glass cannon.',
    )
  })
  it('rosters the LH hulls the same way', () => {
    const text = renderPrimer('LH')
    const fleet = text.slice(text.indexOf('YOUR FLEET'), text.indexOf('HOW YOU PLAY'))
    for (const { name } of shipProfilesForFaction('LH')) expect(fleet).toContain(`\n- ${name} (`)
  })
  it('leaves the fleet section out entirely for a faction with no profiles yet', () => {
    const text = renderPrimer('OW')
    expect(text).not.toContain('YOUR FLEET')
    expect(text).not.toMatch(/\n\n\n/)
  })
  it('explains the tempo tag in both flows and names the guard margin through its placeholder', () => {
    for (const flow of ['single', 'sections'] as const) {
      const text = renderPrimer('DWG', flow)
      expect(text).toContain('tempo estimate in brackets')
      expect(text).toContain(`A move worth at least ${TEMPO_GUARD_TURNS} turn${TEMPO_GUARD_TURNS === 1 ? '' : 's'} of tempo less than the best move is not accepted — the best move is played instead.`)
      // renderPrimer must substitute in two passes: HOW_YOU_PLAY[flow] is
      // itself inserted from a placeholder, and carries one of its own.
      expect(text).not.toContain('{{')
    }
    expect(HOW_YOU_PLAY.single).toContain('{{TEMPO_GUARD_LINE}}')
    expect(HOW_YOU_PLAY.sections).toContain('{{TEMPO_GUARD_LINE}}')
    expect(PRIMER_VALUES).not.toHaveProperty('TEMPO_GUARD_TURNS')   // the margin is a render argument, not a dictionary entry
    expect(PRIMER_VALUES).not.toHaveProperty('TEMPO_GUARD_LINE')
  })
  it('renders the guard line from the margin it is given — the policy’s, not the constant — and drops it when the margin is not finite', () => {
    // An advisory eval (--guard inf) must not tell the model a guard exists.
    for (const flow of ['single', 'sections'] as const) {
      const advisory = renderPrimer('DWG', flow, Infinity)
      expect(advisory).not.toContain('is not accepted')
      expect(advisory).not.toContain('the best move is played instead')
      expect(advisory).toContain('treat it as a compass, not an order.\n')   // the sentence before the line still closes the bullet
      expect(advisory).not.toContain('{{')
      expect(renderPrimer('DWG', flow)).toContain(tempoGuardLine(TEMPO_GUARD_TURNS))   // the default is the constant
      expect(renderPrimer('DWG', flow, 2.5)).toContain('A move worth at least 2.5 turns of tempo less than the best move is not accepted')
    }
    expect(tempoGuardLine(Infinity)).toBe('')
    expect(tempoGuardLine(NaN)).toBe('')
    expect(tempoGuardLine(1)).toBe(' A move worth at least 1 turn of tempo less than the best move is not accepted — the best move is played instead.')
    expect(tempoGuardLine(2)).toContain('at least 2 turns of tempo')
    expect(tempoGuardLine(0.5)).toContain('at least 0.5 turns of tempo')
  })
  it('explains the board’s enemy-hull scoring braces in both flows, with no digit', () => {
    const sentence = 'A hull on the board shows its fighting scores in braces when its faction has a profile — fire, toughness, then how it fares against ships, aircraft and submarines, each one weakest to five strongest — for the enemy\'s hulls as well as yours.'
    expect(sentence).not.toMatch(/\d/)
    for (const flow of ['single', 'sections'] as const) {
      expect(HOW_YOU_PLAY[flow]).toContain(sentence)
      expect(renderPrimer('DWG', flow)).toContain(sentence)
    }
  })
  it('tells the model a hovercraft is a ship (2026-09-22 hovercraft amendment)', () => {
    expect(PRIMER_TEMPLATE).toContain('Placement: ships, hovercraft and submarines go to water or beach zones;')
    expect(PRIMER_TEMPLATE).toContain('A hovercraft (type hover) counts as a ship for every rule.')
  })
})
