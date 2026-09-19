-- Scored menu (docs/superpowers/specs/2026-09-19-scored-menu-design.md §7):
-- the tempo guard's record when it replaced the model's pick — the menu
-- number picked (null for a pass), the number played, and the gap in turns.
alter table public.bot_decisions add column guard jsonb;
