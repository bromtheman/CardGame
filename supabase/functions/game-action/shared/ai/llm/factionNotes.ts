import type { BotFaction } from '../botDecks.ts'

// Strategy prose the rules primer appends for the model: general tips for
// every faction, then the bot's own faction's playstyle. Owner-written; the
// prose is game advice, not rules, so it lives apart from the primer's
// templated rules and is rendered per faction like the rest of the prefix.
// factionNotes.test.ts holds it to the primer's no-digit rule (a cost in
// prose rots against the next balance pass) and pins every `mentions` name
// against the seed source AND the bot's deck, spelled as the seed prints it —
// the model sees exactly those spellings on the board and the menu.

export interface FactionNote {
  // Bullet lines, one "- " per tip, under the primer's YOUR FACTION heading.
  text: string
  // Every card or hero-power name the prose relies on, verbatim.
  mentions: string[]
}

export const GENERAL_TIPS = `- Spend your materials every turn. Anything left when you end the turn is gone, and next turn's income is the same either way, so there is never a reason to save. Repairs are the one thing leftover materials can still buy, and a weak one: they rarely come up, and a repaired hull is worth far less than the extra firepower the same materials would have fielded. If you can afford another hull, play it.
- Once a zone is lost, leave it be. Do not waste resources trying to salvage a zone that is about to be lost; the opponent's vehicles are likely trapped there after it is over, so they are penalized for over-committing.
- If a zone is stacked against you, Half-Cost and Temporary cards can generate quick value and equalize the zone, since it is hard to kill ships when their force is overwhelming. Abilities can also cut down their force before a battle.
- Stealthy vehicles can build up in a zone safely ahead of time, so that you can play more forces there later.`

export const FACTION_NOTES: Partial<Record<BotFaction, FactionNote>> = {
  DWG: {
    text: `- DWG is a pirate faction specializing in stealing the opponent's cards and manipulating the board outside of battle. Its early ships are often weak for their cost relative to other factions but make up for it with abilities.
- The flagship is Crossbones, a reasonably powerful anti-surface ship which, like the other DWG ships, struggles against air and submarines. Look to Kraken and Paddlegun for anti-air.
- Your airships are where your battlefield punching power comes in: Albacore and Buccaneer are both very capable combatants, and Tarpon is not bad either.
- Your endgame comes from superior card draw, specifically drawing from your opponent's deck. Use Plunderer (a ship that draws from the enemy deck when it survives a victorious fleet battle or damages the enemy base) to generate cards from your opponent's deck, and use Gang Up (which lets your whole fleet in a zone battle one singled-out enemy vehicle) to get Plunderer generating cards more than once in a single turn.
- Double Up is a zero-cost ability that makes a ship spawn an additional copy of itself when played. It helps you build an early-game fleet faster than other factions can, for an early lead.
- Your hero power Boarding Party swaps one of your ships for an enemy ship or submarine of equal or lesser cost in the same zone. That suits you: your ships are often weak relative to their printed cost, and you can put more bodies into a zone than most opponents.`,
    mentions: ['Crossbones', 'Kraken', 'Paddlegun', 'Albacore', 'Buccaneer', 'Tarpon', 'Plunderer', 'Gang Up', 'Double Up', 'Boarding Party'],
  },
  LH: {
    text: `- LH is the Lightning Hoods: fast laser, plasma and EMP craft. Your hulls carry CHARGE — a pip fills at the start of each of your turns up to the card's max, and a hull's "Discharge N" ability spends N of them. Charge is visible to both players and dies with the hull, so a charging hull is a threat your opponent will try to fleet-attack; keep it behind a Blocker (Kilowatt, Anode, Angstrom) or move it away with Mobile.
- Cheap pickets (Chrysoprase, Volta, Dipole) exist to bank pips. A "Drain N Charge" capital is always playable: when your board holds its N pips as you play it they are drained and it costs less, otherwise it costs full price, so keep the pickets alive and let them refill between capitals. Conduit adds one extra charge a turn to the other LH hulls in its lane; Volta adds a pip at once.
- Stun (Ampere on play, Penumbra at three pips, EMP Salvo) switches an enemy hull off through its next turn: it cannot attack, move, Block or Screen, and a Stealthy hull cannot withdraw. Stun a Blocker and bombard past it the same turn; stun a Stealthy hull and fleet-attack it. Ampere also lands fully charged, so spend its pips the turn you play it — on EMP Salvo, Data Burst or a Drain capital.
- Umbra shells the base past Blockers at two pips and stays Stealthy, so it keeps firing; Eclipse duels a chosen enemy at two pips. Fire a full hull rather than holding it unless you are saving its pips for a Drain capital.
- Draw keeps your hand full: the Watt's first pip arrives at the start of your next turn, so discharge it for a card each turn it lives, and it brings a permanent decoy plane that pulls enemy effects away from your other hulls; Faraday, Kilowatt and Megawatt draw a card when played; Data Burst spends two pips from one hull for two cards. Turn spare pips into cards whenever no beam, stun or Drain needs them.`,
    // Every card name the prose relies on, verbatim — a test pins each against the seed.
    mentions: [
      'Kilowatt', 'Anode', 'Angstrom', 'Chrysoprase', 'Volta', 'Dipole', 'Conduit',
      'Ampere', 'Penumbra', 'EMP Salvo', 'Umbra', 'Eclipse', 'Watt', 'Faraday', 'Data Burst', 'Megawatt',
    ],
  },
}
