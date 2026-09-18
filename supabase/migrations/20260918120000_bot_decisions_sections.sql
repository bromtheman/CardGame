-- Sectioned bot turn (docs/superpowers/specs/2026-09-18-sectioned-bot-turn-design.md §7):
-- the section a turn call was for, the call's number within its request, and
-- `passed` — the sectioned flow's empty answer on a one-move kind, answered
-- by the heuristic without tripping the policy. The constraint name is the
-- one Postgres gave the inline check in 20260916230000_bot_decisions.sql
-- (verified against the live project on 2026-09-18).
alter table public.bot_decisions
  add column section text check (section in ('deploy', 'activate', 'fight', 'finish')),
  add column seq integer;

alter table public.bot_decisions drop constraint bot_decisions_fallback_reason_check;
alter table public.bot_decisions add constraint bot_decisions_fallback_reason_check
  check (fallback_reason in ('timeout', 'http', 'malformed', 'budget', 'disabled', 'plan_rejected', 'passed'));
