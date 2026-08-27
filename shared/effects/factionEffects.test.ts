import { describe, expect, it } from 'vitest'
import { effectFor } from './registry.ts'
import '../engine/index.ts'

// Importing the engine barrel must register every faction's effects. If a
// module is missing its side-effect import there, Deno fails at runtime with
// "Unknown or not-yet-supported action" — this catches it in CI instead.
describe('faction effect modules are registered via the engine barrel', () => {
  it('registers a canary from each faction module', () => {
    expect(effectFor('mandrelOnPlay')).not.toBeNull()      // owEffects
    expect(effectFor('resoluteOnPlay')).not.toBeNull()     // ssEffects
    expect(effectFor('ampereOnPlay')).not.toBeNull()       // lhEffects
    expect(effectFor('excruciatorOnPlay')).not.toBeNull()  // wfEffects
  })
})
