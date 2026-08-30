import {
  choice, drawFromPool, enemyVehicleOptions, grant, grantKeywords, sacrificeToSave,
  spawnVehicles, summonHulls, whenPlayed, zoneOccupants,
} from './primitives.ts'
import { registerEffect } from './registry.ts'
import { GT_HEAVY_AIRSHIP_MIN_COST, KEYWORDS, VEHICLE_TYPES } from '../gameSettings.ts'
import type { Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import { copyMeta, zoneById } from '../engine/gameEngine.ts'
import { moveEntry } from '../engine/heroPowers.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'

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

const IRON_CORDON = 'ironCordonBattle'

// "Whenever this vehicle survives a battle in which an allied GT airship is
// destroyed, you may sacrifice this vehicle to save that airship."
//
// "GT airship" unqualified is the whole fourteen-card pool — faction GT,
// vehicleType airship — not the eight heavy ones (spec §7.3). The Onyx
// Throne's own second clause says "GT heavy airship" and means the eight,
// which is what makes the distinction deliberate rather than sloppy.
//
// Saving it does NOT unwind the airship's onDeathEffect: that fired earlier in
// the same DECIDE_BATTLE_REPORT, before this trigger could run, and stands
// (spec §4.3, DP2 departure 7).
const ironCordonSave = sacrificeToSave({
  effect: IRON_CORDON,
  prompt: 'Sacrifice Iron Cordon to save a destroyed GT airship?',
  eligible: (battle, actor) => battle.casualties.filter((c) =>
    c.side === actor &&
    c.entry.faction === 'GT' &&
    c.entry.vehicleType === VEHICLE_TYPES.AIRSHIP),
})

registerEffect(IRON_CORDON, (payload) => {
  if (payload.resolution !== undefined) return ironCordonSave(payload)
  const { battle } = payload
  if (!battle || battle.phase !== 'resolve' || !battle.isParticipant || !battle.survived) return true
  return ironCordonSave(payload)
})

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
// The repeat is bounded by the hulls that were in the zone when the CHAIN
// began, not by whatever is in it now. Spec §7.3 always claimed the repeat
// "terminates on the zone's population"; that was true only while a zone's
// population could not grow mid-chain, and Dryad — which board-spawns a
// replacement whenever it is dragged into a defensive battle, forced ones
// included — made it false. A Trebuchet fighting a Dryad destroys it, the
// Dryad's own lock trigger has already replaced it, and the offer comes round
// again forever.
//
// Fixing Trebuchet rather than Dryad keeps both cards' printed text intact:
// Dryad still triggers on every defensive battle (and §7.3's Catshark ruling
// already says a forced battle IS a battle), while Trebuchet's chain now
// terminates provably — `chainIds` is fixed at chain start, every iteration
// requires destroying one of them, so the eligible list strictly shrinks.
//
// `chainIds === null` means "this IS the chain start": take the zone as it
// stands and freeze it.
function trebuchetChoiceFor(chainIds: string[] | null) {
  const eligible = (game: Parameters<typeof enemyVehicleOptions>[0], actor: Side, zoneId: number) => {
    const inZone = enemyVehicleOptions(game, actor, zoneId)
    return chainIds === null ? inZone : inZone.filter((o) => chainIds.includes(o.id))
  }
  return choice({
    effect: TREBUCHET,
    prompt: 'Have Trebuchet battle an enemy vehicle from this zone in a 1v1?',
    options: ({ game, actor, targetZoneId }) => (
      typeof targetZoneId === 'number' ? eligible(game, actor, targetZoneId) : []
    ),
    data: ({ game, actor, targetZoneId }) => ({
      zoneId: targetZoneId,
      // Re-derived at every entry as (still in the zone) ∩ (already in the
      // chain), so it only ever NARROWS: a hull destroyed by the last battle
      // drops out, and one spawned mid-chain was never in it to begin with.
      // That monotone shrink is the termination argument.
      chainIds: typeof targetZoneId === 'number'
        ? eligible(game, actor, targetZoneId).map((o) => o.id)
        : [],
    }),
    resolve: (payload, choiceId) => {
      // Empty options (no eligible enemy left) land here too — do nothing and
      // return true, so Trebuchet still deploys (or, on a repeat, still ends
      // quietly) without a suspension. This IS "you may": declining via
      // `cancel` on a non-empty offer is the other half.
      if (choiceId === null) return true
      const { game, actor, card, ctx } = payload
      const zoneId = payload.pending?.data?.zoneId
      const stashedChain = payload.pending?.data?.chainIds
      if (typeof zoneId !== 'number' || !Array.isArray(stashedChain)) return false
      const chain = stashedChain.filter((id): id is string => typeof id === 'string')
      // Re-confirm the target is still legal AND still in the chain's frozen
      // set — RESOLVE_PENDING_EFFECT's own zoneId/targetInstanceId fields are
      // client-supplied and unvalidated; only choiceId (checked against
      // pending.options by choice() itself) and this server-side re-check are
      // trusted, the same guard Braveheart and Eclipse both carry
      // (docs/claude/card-effects.md).
      // Defence in depth only: choice() has already checked choiceId against
      // pending.options, which were built from this same filtered set, so no
      // test can kill this line. It exists so options and the chain cannot
      // silently diverge if either is ever computed differently.
      if (!chain.includes(choiceId)) return false
      if (!enemyVehicleOptions(game, actor, zoneId).some((o) => o.id === choiceId)) return false
      return declareForcedBattle(game, ctx, {
        zoneId,
        aggressor: actor,
        attackerIds: [card.instanceId],
        defenderIds: [choiceId],
        cause: card.name,
        // Names itself: DECIDE_BATTLE_REPORT re-enters TREBUCHET with this once
        // the battle resolves (spec §4.3, departure 3). zoneId and chainIds are
        // stashed because entry (c) has no other route back to either; the
        // win/survive test comes off the engine's own outcome rather than a
        // declare-time defenderIds snapshot — see (c) below.
        continuation: { effect: TREBUCHET, side: actor, card, data: { zoneId, chainIds: chain } },
      })
    },
  })
}

registerEffect(TREBUCHET, (payload) => {
  if (payload.continuation === undefined) {
    // (a) on play: no chain yet, so the zone as it stands becomes the chain.
    // (b) re-entry after an answer: the chain was frozen on (a) and lives in
    //     pending.data, which resolve() reads back directly.
    const stashed = payload.pending?.data?.chainIds
    const chain = Array.isArray(stashed)
      ? stashed.filter((id): id is string => typeof id === 'string')
      : null
    return trebuchetChoiceFor(chain)(payload)
  }

  // (c): the battle this card forced has just resolved. activeBattle is
  // already null (DECIDE_BATTLE_REPORT nulls it before firing the
  // continuation), so the outcome arrives on `payload.battle` — the SAME
  // BattleContext the resolve triggers were handed, scoped to this hull.
  //
  // Wave 4 replaced the previous test, which asked whether every defender
  // stashed at DECLARE time was gone from the zone. That was correct while a
  // battle's roster could not change after it locked; Terawatt's join broke it
  // — a defender that joined afterwards was invisible to the stash, so
  // Trebuchet scored a battle it had lost as a clean win and took a free
  // repeat. `battle.won` is computed over the battle's FINAL roster.
  //
  // Nothing to invent for "fully heal it" (spec §7.3): Trebuchet's own printed
  // SCRAPPY already repairs it free across the whole 80-89.999% band. "Damaged
  // beyond repair" means destroyed, not merely damaged, so a Scrappy-repaired
  // survivor still gets the repeat — which `survived` already reflects,
  // because it is computed after repairs.
  const { game, continuation, battle } = payload
  const zoneId = continuation.data?.zoneId
  const stashedChain = continuation.data?.chainIds
  if (typeof zoneId !== 'number' || !Array.isArray(stashedChain)) return true
  if (!zoneById(game.state, zoneId)) return true
  if (!battle || !battle.survived || !battle.won) return true
  // A clean win: re-offer (a)'s choice, over the SAME frozen set. The win
  // destroyed one of them, so the eligible list is strictly smaller than it
  // was — which is what makes the repeat terminate rather than merely tend to
  // (spec §7.3). An emptied list falls through choice()'s own empty-options
  // rule and ends the chain quietly.
  return trebuchetChoiceFor(stashedChain.filter((id): id is string => typeof id === 'string'))({
    game, actor: continuation.side, card: continuation.card, ctx: payload.ctx, targetZoneId: zoneId,
  })
})
