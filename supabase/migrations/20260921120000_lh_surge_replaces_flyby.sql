-- 2026-09-21 LH redesign (spec §6): Surge replaces Flyby. The seed only ever
-- upserts, so the retired power's row is removed here; the `flyby`
-- implementation stays registered in game-action for games already in flight.
-- The id is uuidv5('hero:LH:Flyby') as seed_data.sql printed it.
delete from public.hero_powers where id = '6f174556-c99f-5ceb-9be5-6b7d03bb11b1';
