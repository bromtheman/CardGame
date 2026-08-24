create table public.cards (
  id uuid primary key,
  name text not null,
  is_built_in boolean not null default false,
  owner_id uuid references public.profiles (id) on delete cascade,
  faction text not null
    check (faction in ('NEUTRAL','DWG','SS','LH','TG','OW','SD','WF','GT')),
  type text not null check (type in ('vehicle','ability')),
  vehicle_type text
    check (vehicle_type in ('ship','airship','tank','plane','sub')),
  blueprint_cost integer not null default 0,
  material_cost integer not null default 0,
  cp_cost integer not null default 0,
  card_text text not null default '',
  image_url text not null default '',
  keywords jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vehicle_requires_vehicle_type
    check (type <> 'vehicle' or vehicle_type is not null),
  constraint built_in_has_no_owner
    check (not is_built_in or owner_id is null)
);

create index cards_owner_id_idx on public.cards (owner_id);
create index cards_faction_idx on public.cards (faction);

alter table public.cards enable row level security;

-- Read-only for clients; ALL writes go through service role (Studio/edge functions).
create policy "cards_select_authenticated" on public.cards
  for select to authenticated using (true);

create table public.hero_powers (
  id uuid primary key,
  name text not null,
  faction text not null
    check (faction in ('NEUTRAL','DWG','SS','LH','TG','OW','SD','WF','GT')),
  power_text text not null,
  cp_cost integer not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.hero_powers enable row level security;

create policy "hero_powers_select_authenticated" on public.hero_powers
  for select to authenticated using (true);
