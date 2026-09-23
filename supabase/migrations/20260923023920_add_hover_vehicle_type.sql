-- 2026-09-22 LH hovercraft amendment (docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md §4-§5):
-- a new vehicle type, 'hover', that counts as a ship for every rule and spawns
-- just above the water in FtD. Applied to production BEFORE the merge through
-- the Supabase MCP apply_migration, so the seed job's upsert of the hover Watt
-- cannot race it; this file carries the version that call recorded. It only
-- widens the list, so nothing live can notice.
alter table public.cards drop constraint cards_vehicle_type_check;
alter table public.cards add constraint cards_vehicle_type_check
  check (vehicle_type in ('ship','airship','tank','plane','sub','hover'));
