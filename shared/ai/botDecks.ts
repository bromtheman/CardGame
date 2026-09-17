// PracticeAI's decks (2026-09-16 AI opponent spec §3.2): one curated list per
// faction the bot can field, keyed by CARD NAME → copies. Names are resolved
// to ids against the live `cards` table by lobby-action's ADD_BOT (seeded ids
// are deterministic, uuidv5("card:FACTION:NAME"), so names are stable keys
// that also read in review). botDecks.test.ts pins every list against the
// seed SOURCE: exists, not retired, not summon-only, legal under the default
// deck rules, ≤ 3 tank copies (the default board is all water), ≥ 12
// vehicles, and cheap enough that turns 1 and 2 have a play.
//
// GT and LH are deliberately absent (owner decision 2026-09-16: neither is
// fully implemented; GT is also all-flier and cannot meet the flier cap).
// Adding a faction later is a new list here plus a BOT_FACTIONS entry.
//
// Curation notes: no `upkeepRequired` hulls (TG), because a greedy bot would
// bleed materials to them; at most one or two targeted abilities per deck,
// because the policy aims them by trial; Scrappy/Blocker hulls preferred,
// because the bot never repairs a Fragile hull and never dodges a battle.

export type BotFaction = 'DWG' | 'OW' | 'SS' | 'WF' | 'TG'

export const BOT_FACTIONS: readonly BotFaction[] = ['DWG', 'OW', 'SS', 'WF', 'TG']

export function isBotFaction(x: unknown): x is BotFaction {
  return typeof x === 'string' && (BOT_FACTIONS as readonly string[]).includes(x)
}

export const BOT_DECKS: Record<BotFaction, Record<string, number>> = {
  DWG: {
    'Corsair': 1,
    'Tarpon': 1,
    'Albacore': 2,
    'Pilferer': 1,
    'Abactor': 1,
    'Ransack': 1,
    'Paddlegun': 1,
    'Plunderer': 2,
    'Sinners Luck': 1,
    'Kraken': 1,
    'Crossbones': 1,
    'Buccaneer': 1,
    'Gang Up': 2,
    "Double Up": 2,
    "Reserves": 2
  },
  OW: {
    'Claymore': 2,
    'Partisan': 2,
    'Rook': 2,
    'Cauldron': 2,
    'Clydesdale': 2,
    'Mandrel': 2,
    'Brandistock': 2,
    'Mace': 1,
    'Iron Cordon': 1,
    'Palisade': 1,
    'Jormangund': 1,
    'Javelin': 1,
    'Bulwark': 1,
  },
  SS: {
    'Sacrilego': 2,
    'Resolute': 2,
    'Chrysaor': 2,
    'Argonaut': 2,
    'Catshark': 2,
    'Iron Maiden': 2,
    'Spectre': 1,
    'Paladin': 1,
    'Braveheart': 1,
    'Trondheim': 1,
    'Nothung': 1,
    'Typhoon': 1,
    'Wolin': 1,
    'Falcon Squadron': 1,
  },
  WF: {
    'Earth Raker': 2,
    'Buzzsaw': 2,
    'Pulverizer': 2,
    'Pontus': 1,
    'Basher': 2,
    'Pandemonium': 2,
    'Scourge': 2,
    'Veles': 2,
    'Slasher': 2,
    'Judgement': 1,
    'Excruciator': 1,
    'The Repentance': 1,
  },
  TG: {
    'Curiosity': 2,
    'Obelisk': 2,
    'Horror': 2,
    'Nostalgia': 2,
    'Frustration': 1,
    'Spite': 2,
    'Vengeful': 1,
    'Ecstasy': 2,
    'Loathing': 2,
    '[TG] Obsession': 1,
    '[TG] Hysteria': 1,
    'Jealousy': 1,
    'Optimism': 1,
  },
}
