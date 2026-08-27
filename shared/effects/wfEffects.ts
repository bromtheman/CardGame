import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// WF built-in card effects.
registerEffect('excruciatorOnPlay', grant({ draw: 1 }))
registerEffect('purifierEffect', grant({ draw: 1 }))
