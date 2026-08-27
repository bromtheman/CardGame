import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// LH built-in card effects.
registerEffect('ampereOnPlay', grant({ draw: 1 }))
