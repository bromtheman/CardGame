import { EXCALIBUR_DISCOUNT, KEYWORDS, REPAIRMEN_READY_DRAW_MAX_COST, RHEA_MAX_PLANE_COST } from '../gameSettings.ts'
import { costDelta, drawFromPool, grant, grantKeywords, sequence } from './primitives.ts'
import { registerEffect } from './registry.ts'
import { findVehicle } from '../engine/gameEngine.ts'

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

// "Grant target vehicle scrappy. If the target is an AI vehicle that costs
// less than 200k, draw a card."
registerEffect('repairmenReadyEffect', sequence(
  grantKeywords({ keywords: [KEYWORDS.SCRAPPY], target: 'field' }),
  (payload) => {
    const found = findVehicle(payload.game.state, payload.targetInstanceId ?? '')
    if (!found) return false
    const { entry } = found
    if (entry.isBuiltIn && entry.materialCost < REPAIRMEN_READY_DRAW_MAX_COST) {
      return grant({ draw: 1 })(payload)
    }
    return true
  },
))
