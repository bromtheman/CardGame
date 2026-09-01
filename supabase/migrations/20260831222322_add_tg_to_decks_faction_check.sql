-- Wave 7: TG becomes a draftable faction.
--
-- `decks_faction_check` is a THIRD copy of the deck-faction list, after
-- shared/gameSettings.ts's DECK_FACTIONS and the <select> in DecksPage.tsx that
-- reads it. Nothing keeps the three in sync, and no code search finds this one
-- because it is a constraint rather than code — TG was seeded, listed in the
-- builder's dropdown, and still rejected at insert with a 23514.
--
-- `cards_faction_check` already lists TG (it carries every FACTIONS value), so
-- the 26 cards seeded cleanly. Only the DECK list was narrow.
--
-- Kept in the same order as DECK_FACTIONS so the two read as the same list.
alter table public.decks drop constraint decks_faction_check;
alter table public.decks add constraint decks_faction_check
  check (faction = any (array['DWG', 'GT', 'LH', 'OW', 'SS', 'TG', 'WF']));
