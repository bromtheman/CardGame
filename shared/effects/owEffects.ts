import {
  choice, drawFromPool, enemyVehicleOptions, grant, grantKeywords, spawnVehicles, whenPlayed, zoneOccupants,
} from './primitives.ts'
import { registerEffect } from './registry.ts'
import { GT_HEAVY_AIRSHIP_MIN_COST, KEYWORDS } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { copyMeta, otherSide, zoneById } from '../engine/gameEngine.ts'
import { moveEntry } from '../engine/heroPowers.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import { summonHulls } from './primitives.ts'

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
      ...card, instanceId: ctx.newId(), meta: copyMeta(card.meta),
      playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
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

// "Draw one card from either the GT Airship or Heavy Airship deck (your
// choice)." Spec §7.3 puts the cliff at GT_HEAVY_AIRSHIP_MIN_COST, which
// splits the fourteen GT airships 6 / 8 — the guard pins those counts.
const SPECIAL_FOUNDRIES = 'specialFoundriesEffect'
const gtLightAirship = drawFromPool({
  source: 'catalog',
  filter: { faction: 'GT', vehicleType: 'airship', maxCost: GT_HEAVY_AIRSHIP_MIN_COST - 1 },
  count: 1,
})
const gtHeavyAirship = drawFromPool({
  source: 'catalog',
  filter: { faction: 'GT', vehicleType: 'airship', minCost: GT_HEAVY_AIRSHIP_MIN_COST },
  count: 1,
})
// The Onyx Throne's second clause (DP1): "Once per turn, you may pay 1cp to
// draw a GT heavy airship card." Same pool half Special Foundries' heavy
// option draws from, filtered on faction + vehicleType + the §7.3 cost cliff —
// never on the GT_AIRSHIP / GT_HEAVY_AIRSHIP source-file grouping arrays,
// which misreport at least two cards' faction and type.
registerEffect('onyxThroneActivate', gtHeavyAirship, { needsCatalog: true })

registerEffect(SPECIAL_FOUNDRIES, choice({
  effect: SPECIAL_FOUNDRIES,
  prompt: 'Draw from which GT airship pool?',
  options: () => [
    { id: 'light', label: 'GT Airship' },
    { id: 'heavy', label: 'GT Heavy Airship' },
  ],
  resolve: (payload, choiceId) => (choiceId === 'heavy' ? gtHeavyAirship(payload) : gtLightAirship(payload)),
}), { needsCatalog: true })

// Wave 4, DP2 (spec §4.3). "Whenever this vehicle would partake in a defensive
// battle, spawn an allied Parapet alongside it for that battle" — the card
// text's missing noun is authored in spec §7.2, and "for that battle" is what
// makes it a battle SUMMON rather than a free 259k hull every time.
//
// It joins the battle that already exists rather than declaring one:
// declareForcedBattle refuses outright while state.activeBattle is non-null,
// and at lock it always is. joinBattle (battleDeclare.ts) is the only function
// that appends to a battle in progress.
//
// isParticipant, because a DP2 effect can also be reached as a forced-battle
// bystander; isDefender, because the text says "defensive".
registerEffect('onyxThroneBattle', ({ game, actor, ctx, card, battle }) => {
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant || !battle.isDefender) return true
  const hulls = summonHulls(game, ctx, 'Parapet', 1)
  if (!hulls) return false
  const [parapet] = hulls
  if (!joinBattle(game, actor, parapet.instanceId, parapet)) return false
  game.state.log.push(`A Parapet stands alongside ${card.name} in zone ${battle.zoneId}`)
  return true
}, { needsCatalog: true })

// "Spawn two parapets into a zone. They gain Inoffensive, Scrappy, and blocker
// keywords." Keywords come from the summoning card, not the Parapet row —
// the established pattern (spawnBuccaneerEffect stamps Scrappy the same way).
registerEffect('defensiveParapetEffect', spawnVehicles({
  cardName: 'Parapet',
  count: 2,
  zones: 'target',
  keywords: [KEYWORDS.INOFFENSIVE, KEYWORDS.SCRAPPY, KEYWORDS.BLOCKER],
}), { needsCatalog: true })

// "When Played, you may choose to have this vehicle battle an opponents
// vehicle from the same zone in a 1v1. If the trebuchet wins without
// becoming damaged beyond repair, fully heal it and you may repeat this
// effect." The only three-phase effect in the wave (spec §4.3, departure 3),
// and the only consumer of ActiveBattle.continuation. Seed correction:
// PLAY_ON_VEHICLE -> ON_PLAY (spec §6, §4.3 departure 4) — the text is "When
// Played... you may choose", an on-play trigger with a choice, not a
// targeted play, so it picks its opponent through the same choice dialog as
// Braveheart/Eclipse/Orbit Flank rather than needing its own dispatch point.
//
// Three entries share this one registry name, and the payloads for (a) and
// (c) are otherwise IDENTICAL shapes — `continuation` is the only thing that
// tells them apart (task 9 brief):
//   (a) on play:        resolution === undefined && continuation === undefined
//   (b) choice answered: resolution !== undefined
//   (c) battle resolved: continuation !== undefined
const TREBUCHET = 'trebuchetEffect'

// (a) offers the 1v1; (b) is its resolve, once answered. This is also what a
// clean win (c, below) re-invokes for the repeat: a synthetic first-entry
// payload built from the zoneId stashed at declare time reaches this exact
// options()/resolve() pair, so "you may repeat this effect" IS (a) asked
// again — not a second mechanism.
const trebuchetChoice = choice({
  effect: TREBUCHET,
  prompt: 'Have Trebuchet battle an enemy vehicle from this zone in a 1v1?',
  options: ({ game, actor, targetZoneId }) => (
    typeof targetZoneId === 'number' ? enemyVehicleOptions(game, actor, targetZoneId) : []
  ),
  data: ({ targetZoneId }) => ({ zoneId: targetZoneId }),
  resolve: (payload, choiceId) => {
    // Empty options (no enemy vehicle in the zone) land here too — do
    // nothing and return true, so Trebuchet still deploys (or, on a repeat,
    // still ends quietly) without a suspension. This IS "you may": declining
    // via `cancel` on a non-empty offer is the other half.
    if (choiceId === null) return true
    const { game, actor, card, ctx } = payload
    const zoneId = payload.pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    // Re-confirm the target is still legal — RESOLVE_PENDING_EFFECT's own
    // zoneId/targetInstanceId fields are client-supplied and unvalidated;
    // only choiceId (checked against pending.options by choice() itself) and
    // this server-side re-check are trusted, the same guard Braveheart and
    // Eclipse both carry (docs/claude/card-effects.md).
    if (!enemyVehicleOptions(game, actor, zoneId).some((o) => o.id === choiceId)) return false
    return declareForcedBattle(game, ctx, {
      zoneId,
      aggressor: actor,
      attackerIds: [card.instanceId],
      defenderIds: [choiceId],
      cause: card.name,
      // Names itself: DECIDE_BATTLE_REPORT re-enters TREBUCHET with this once
      // the battle resolves (spec §4.3, departure 3). zoneId and defenderIds
      // are stashed here, at declare time, because entry (c) below has no
      // other route back to either — continuation carries no targetZoneId of
      // its own, and outcome HP is never plumbed onto any payload.
      continuation: { effect: TREBUCHET, side: actor, card, data: { zoneId, defenderIds: [choiceId] } },
    })
  },
})

registerEffect(TREBUCHET, (payload) => {
  if (payload.continuation === undefined) return trebuchetChoice(payload)

  // (c): the battle this card forced has just resolved. activeBattle is
  // already null (DECIDE_BATTLE_REPORT nulls it before firing the
  // continuation), so the whole win test reads off zone.cards — no outcome
  // plumbing needed, and nothing to invent for "fully heal it" (spec §7.3):
  // Trebuchet's own printed SCRAPPY already repairs it free across the whole
  // 80-89.999% band. "Damaged beyond repair" means destroyed, not merely
  // damaged, so a Scrappy-repaired survivor still gets the repeat.
  const { game, continuation } = payload
  const zoneId = continuation.data?.zoneId
  const defenderIds = continuation.data?.defenderIds
  if (typeof zoneId !== 'number' || !Array.isArray(defenderIds)) return true
  const zone = zoneById(game.state, zoneId)
  if (!zone) return true
  // Survived: Trebuchet itself is still on its own side of the zone.
  const survived = zone.cards[continuation.side].some((c) => c.instanceId === continuation.card.instanceId)
  if (!survived) return true // damaged beyond repair — no repeat
  // Won: every defender stashed at declare time is gone from the enemy's
  // side of the same zone.
  const enemy = otherSide(continuation.side)
  const won = defenderIds.every((id) => typeof id === 'string' && !zone.cards[enemy].some((c) => c.instanceId === id))
  if (!won) return true // a defender is still standing — no repeat
  // A clean win: re-offer (a)'s choice in the same zone. The repeat is
  // unbounded but self-limiting (spec §7.3) — nothing here caps it; an empty
  // zone just lets the choice above's own empty-options rule end it quietly.
  return trebuchetChoice({
    game, actor: continuation.side, card: continuation.card, ctx: payload.ctx, targetZoneId: zoneId,
  })
})
