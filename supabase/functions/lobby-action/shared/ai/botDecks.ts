// PracticeAI's decks (2026-09-16 AI opponent spec §3.2): one curated list per
// faction the bot can field, keyed by CARD NAME → copies. Names are resolved
// to ids against the live `cards` table by lobby-action's ADD_BOT (seeded ids
// are deterministic, uuidv5("card:FACTION:NAME"), so names are stable keys
// that also read in review). botDecks.test.ts pins every list against the
// seed SOURCE: exists, not retired, not summon-only, legal under the default
// deck rules, ≤ 3 tank copies (the default board is all water), ≥ 12
// vehicles, and cheap enough that turns 1 and 2 have a play.
//
// GT is deliberately absent (owner decision 2026-09-16: not fully
// implemented, and all-flier, so it cannot meet the flier cap). LH was added
// 2026-09-21, once the redesign's engine, cards and ship profiles shipped.
// Adding a faction later is a new list here plus a BOT_FACTIONS entry.
//
// Curation notes: no `upkeepRequired` hulls (TG), because a greedy bot would
// bleed materials to them; at most one or two targeted abilities per deck,
// because the policy aims them by trial; Scrappy/Blocker hulls preferred,
// because the bot never repairs a Fragile hull and never dodges a battle.

export type BotFaction = 'DWG' | 'OW' | 'SS' | 'WF' | 'TG' | 'LH'

export const BOT_FACTIONS: readonly BotFaction[] = ['DWG', 'OW', 'SS', 'WF', 'TG', 'LH']

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
    'Balmung': 2,
    'Trondheim': 1,
    'Air Strafe': 2,
    'Resolute': 1,
    'Cyclone': 2,
    'Asphodel': 2,
    'Hydra': 2,
    'Repairmen Ready': 1,
    'Sacrilego': 1,
    'Thresher Shark': 1,
    'Cash advance': 1,
    'Chrysaor': 1,
    'Tyr': 1,
    'Victoria': 1,
    'Blockade': 1,
  },
  WF: {
    'Earth Raker': 2,
    'Sub Strike': 1,
    'Ambush': 1,
    'Disemboweler': 1,
    'Excruciator': 1,
    'Judgement': 1,
    'All for the Cause': 1,
    'Purifier': 2,
    'Scourge': 2,
    'Basher': 2,
    'Slasher': 1,
    'The Last Rite': 1,
    'Buzzsaw': 1,
    'Martyr Attack': 1,
    'Veles': 2,
  },
  // Horror (50k ship) left this list when the 2026-09-16 balance pass retired
  // it (M-9). Its two slots went to a second Frustration and a second Vengeful
  // rather than another cheap ship: Obelisk and Nostalgia, the only TG ships
  // under 100k, were already at the two-copy cap, and every other non-retired
  // TG ship not at cap is 330k+ or upkeepRequired. Both stand-ins were already
  // in the deck, so the bot's behaviour with them is self-play-proven, and
  // neither needs a choice — Frustration is a plain Stealthy hull and Vengeful's
  // trigger is passive. Fliers land exactly on the six-copy cap.
  //
  // '[TG] Obsession' and '[TG] Hysteria' (the borrowed LH robotics-pool rows,
  // both ship-type) left this list when the 2026-09-21 LH redesign retired all
  // four pool cards (spec §7) — the pool draw was their only reader. Unlike
  // Horror, their two slots could NOT go to already-included cards: every
  // non-flier already sits at the two-copy cap, and Jealousy/Optimism are
  // fliers already at the six-copy FLIER_COPY_LIMIT, so bumping either
  // overflows it. Agony (sub, Blocker) and Wonder (ship) are the replacements
  // instead — neither upkeepRequired, retired, nor summon-only, and both
  // ship/sub so the flier count stays at exactly six. Subs land at 5 of 6.
  TG: {
    'Curiosity': 2,
    'Obelisk': 2,
    'Nostalgia': 2,
    'Frustration': 2,
    'Spite': 2,
    'Vengeful': 2,
    'Ecstasy': 2,
    'Loathing': 2,
    'Jealousy': 1,
    'Optimism': 1,
    'Agony': 1,
    'Wonder': 1,
  },
  // 2026-09-21 LH redesign. Curated for the bot: batteries it can protect,
  // three Blockers, one timer, one beam, and the ability cards the policy
  // aims by trial. No Drain capitals: curated while Drain gated a play, when a
  // greedy bot held them all game. Since 2026-09-23 Drain is a discount and
  // they are always playable — a candidate for the next curation.
  // 2026-09-22 draw amendment: Faraday ×2 and Data Burst ×2 came in for both
  // Watts, Megawatt and the second Kilowatt — none of them named in the LH
  // strategy notes (factionNotes.ts), which pin every card they name to this
  // list. Fliers 3 of 6. 2026-09-23: Megawatt (now "When played, draw a card")
  // back in for the second Data Burst; Feedback Loop stays out — a one-ply
  // evaluator cannot see a draw that only pays on later discharges.
  // 2026-09-22 hovercraft amendment: Byte retired, so both Watts came back
  // (Byte's draw moved to them); Anode replaced the retired Hydrovolt. Still
  // twenty cards, fliers 3 of 6 — a spawned Luxon is not a deck card.
  LH: {
    'Chrysoprase': 2,
    'Watt': 2,
    'Volta': 1,
    'Conduit': 1,
    'Dipole': 1,
    'Faraday': 2,
    'Umbra': 1,
    'Kilowatt': 1,
    'Ampere': 1,
    'Eclipse': 1,
    'Anode': 1,
    'Megawatt': 1,
    'Penumbra': 1,
    'Angstrom': 1,
    'EMP Salvo': 1,
    'Overcharge': 1,
    'Data Burst': 1,
  },
}
