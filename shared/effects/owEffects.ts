import { drawFromPool, grant } from './primitives.ts'
import { registerEffect } from './registry.ts'

// OW built-in card effects. Cards whose faction is GT but whose seed row
// lives in OW-Built-in.js are registered here too.
registerEffect('mandrelOnPlay', grant({ draw: 1 }))
registerEffect('rookOnPlay', grant({ draw: 1 }))
registerEffect('claymoreEffect', grant({ draw: 1 }))
registerEffect('palisadeEffect', grant({ draw: 1 }))
registerEffect('javelinOnDeath', grant({ draw: 1 }))
registerEffect('bulwarkOnPlay', grant({ cp: 2 }))
registerEffect('maceEffect', grant({ cp: 1 }))

const gtAirship = drawFromPool({
  source: 'catalog', filter: { faction: 'GT', vehicleType: 'airship' }, count: 1,
})
registerEffect('halberdOnDeath', gtAirship, { needsCatalog: true })
registerEffect('jormangundOnDeath', gtAirship, { needsCatalog: true })
registerEffect('partisanEffect', gtAirship, { needsCatalog: true })

// OW has no built-in submarines, so a player's only subs are custom cards in
// their own deck — which is why the card says "if you have one".
registerEffect('cauldronEffect', drawFromPool({
  source: 'deck', filter: { vehicleType: 'sub' }, count: 1, allowEmpty: true,
}))
