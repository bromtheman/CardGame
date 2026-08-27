import { grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// OW built-in card effects. Cards whose faction is GT but whose seed row
// lives in OW-Built-in.js are registered here too.
registerEffect('mandrelOnPlay', grant({ draw: 1 }))
