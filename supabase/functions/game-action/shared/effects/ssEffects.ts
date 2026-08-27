import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// SS built-in card effects.
registerEffect('resoluteOnPlay', grant({ draw: 1 }))
