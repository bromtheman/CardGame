import { drawFromPool, grant, grantKeywords, whenPlayed, zoneOccupants } from './primitives.ts'
import { registerEffect } from './registry.ts'
import { KEYWORDS } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { moveEntry } from '../engine/heroPowers.ts'

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

// "If played into a zone in which you have no friendly vehicles, spawn
// another copy into that zone."
registerEffect('clydesdaleEffect', whenPlayed(
  (p) => zoneOccupants(p, 'own')?.length === 0,
  ({ game, actor, card, ctx, targetZoneId }) => {
    const zone = game.state.zones.find((z) => z.id === targetZoneId)
    if (!zone) return false
    const copy: ZoneCardEntry = {
      ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    }
    zone.cards[actor].push(copy)
    game.state.log.push(`A second ${card.name} rolls off the line in zone ${zone.id}`)
    return true
  },
))

// "Target an AI vehicle in hand. Give it the HALFCOST and INOFFENSIVE
// keywords." The seeded meta key said playOnVehicleEffect (a field target);
// the card text says "in hand", and card text is authoritative (spec 2 §6).
registerEffect('garrisonEffect', grantKeywords({
  keywords: [KEYWORDS.HALF_COST, KEYWORDS.INOFFENSIVE],
  target: 'hand',
  filter: { isBuiltIn: true, type: 'vehicle' },
}))

// "Once per turn, you may spend 1cp to draw a card" — the CP is charged by
// ACTIVATE_VEHICLE from meta.activateCpCost, so the effect is only the draw.
registerEffect('hunchbackActivate', grant({ draw: 1 }))

// "Once per turn, you may pay 1cp to move this vehicle to another zone."
// Reuses the hero-power relocation, so biome legality and the movedOnTurn
// stamp behave exactly as they do for a Mobile vehicle's MOVE_VEHICLE.
registerEffect('monsoonActivate', ({ game, actor, card, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  return moveEntry(game, actor, card.instanceId, targetZoneId, true).ok
})
