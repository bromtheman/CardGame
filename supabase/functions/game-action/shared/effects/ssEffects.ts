import { EXCALIBUR_DISCOUNT, RHEA_MAX_PLANE_COST } from '../gameSettings.ts'
import { costDelta, drawFromPool, grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// SS built-in card effects.
registerEffect('resoluteOnPlay', grant({ draw: 1 }))
registerEffect('ironMaidenOnDeath', grant({ draw: 1 }))
registerEffect('victoriaOnDeath', grant({ draw: 1 }))
registerEffect('trondheimOnDeath', grant({ draw: 1 }))
registerEffect('maelstromOnPlay', grant({ cp: 1 }))

registerEffect('rheaOnPlay', drawFromPool({
  source: 'catalog',
  filter: { faction: 'SS', vehicleType: 'plane', maxCost: RHEA_MAX_PLANE_COST - 1 },
  count: 1,
  strip: ['temporary'],
}), { needsCatalog: true })

// "Pick one AI ship in hand and reduce its cost by 200k." AI means built-in
// (design spec §3.10, "AI/built-in card costs").
registerEffect('excaliburOnPlay', costDelta({
  delta: -EXCALIBUR_DISCOUNT,
  filter: { isBuiltIn: true, vehicleType: 'ship', type: 'vehicle' },
}))
