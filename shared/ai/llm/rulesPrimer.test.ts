import { describe, expect, it } from 'vitest'
import { KEYWORDS, MATERIALS_PER_TURN, SURVIVE_HP_PERCENT } from '../../gameSettings'
import { FACTION_NOTES, GENERAL_TIPS } from './factionNotes'
import { KEYWORD_GLOSSARY, PRIMER_TEMPLATE, renderPrimer } from './rulesPrimer'

describe('rules primer', () => {
  it('carries no literal number — every figure is a placeholder filled from gameSettings', () => {
    const stripped = PRIMER_TEMPLATE.replace(/\{\{[A-Z_]+\}\}/g, '')
    expect(stripped).not.toMatch(/\d/)
    for (const text of Object.values(KEYWORD_GLOSSARY)) expect(text).not.toMatch(/\d/)
  })
  it('has a glossary line for every keyword the engine knows', () => {
    for (const keyword of Object.values(KEYWORDS)) expect(KEYWORD_GLOSSARY[keyword], keyword).toBeTruthy()
  })
  it('shows the exact JSON object the model must answer with', () => {
    const shape = PRIMER_TEMPLATE.slice(PRIMER_TEMPLATE.indexOf('HOW YOU PLAY'))
    for (const key of ['"plan"', '"expectation"', '"summary"', '"battle"', '"zoneId"', '"outcome"', '"confidence"', '"tableTalk"']) {
      expect(shape, key).toContain(key)
    }
    expect(shape).toContain('ONE JSON object')
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
})
