-- Owner-only telemetry for the model-backed PracticeAI
-- (docs/superpowers/specs/2026-09-16-llm-practice-ai-design.md §7). One row
-- per model call, including failed ones, written by game-action and
-- lobby-action with the service role AFTER apply_action_tx / start_game_tx
-- succeed. Never read by the frontend.
create table public.bot_decisions (
  id                bigint generated always as identity primary key,
  game_id           uuid not null references public.games(id) on delete cascade,
  version           integer not null,
  turn_number       numeric not null,
  kind              text not null check (kind in ('turn', 'response', 'decision', 'choice')),
  model             text not null,
  latency_ms        integer not null,
  prompt_tokens     integer,
  completion_tokens integer,
  cached_tokens     integer,
  cost_usd          numeric,
  menu_size         integer not null,
  plan              jsonb not null default '[]'::jsonb,
  applied           jsonb not null default '[]'::jsonb,
  expectation       jsonb,
  report            jsonb,
  table_talk        text,
  fallback_reason   text check (fallback_reason in
                      ('timeout', 'http', 'malformed', 'budget', 'disabled', 'plan_rejected')),
  error             text, -- the failure's status and message excerpt when fallback_reason is set; never a key
  created_at        timestamptz not null default now()
);

-- Covers the FK (cascade deletes) and the expected-vs-actual self-join.
create index bot_decisions_game_version_idx on public.bot_decisions (game_id, version);

alter table public.bot_decisions enable row level security;
-- Deliberately NO policies (the battle_tokens pattern): RLS is on and nothing
-- is granted, so anon and authenticated see nothing; the service role writes
-- and the owner reads by SQL.
