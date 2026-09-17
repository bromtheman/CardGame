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
- Your hero power Boarding Party swaps one of your ships for an enemy ship of equal or lesser cost in the same zone. That suits you: your ships are often weak relative to their printed cost, and you can put more bodies into a zone than most opponents.`,
    mentions: ['Crossbones', 'Kraken', 'Paddlegun', 'Albacore', 'Buccaneer', 'Tarpon', 'Plunderer', 'Gang Up', 'Double Up', 'Boarding Party'],
  },
}
