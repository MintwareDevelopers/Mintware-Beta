create table if not exists public.universal_reward_epochs (
  id uuid primary key default gen_random_uuid(),
  epoch_key text not null unique,
  chain_id bigint not null,
  pool_id text not null,
  epoch_start timestamptz not null,
  epoch_end timestamptz not null,
  trade_count integer not null default 0,
  total_value_usd numeric(20,6) not null default 0,
  total_allocated_usd numeric(20,6) not null default 0,
  merkle_root text,
  total_usdc_wei text,
  tree_json jsonb,
  status text not null default 'published',
  distribution_id uuid references public.distributions(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists universal_reward_epochs_pool_epoch_idx
  on public.universal_reward_epochs (pool_id, epoch_start desc);

create unique index if not exists universal_reward_epochs_distribution_uidx
  on public.universal_reward_epochs (distribution_id)
  where distribution_id is not null;

create table if not exists public.universal_reward_allocations (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.universal_reward_epochs(id) on delete cascade,
  recipient text not null,
  recipient_type text not null,
  source_trade_ids jsonb not null default '[]'::jsonb,
  quality text not null,
  amount_usd numeric(20,6) not null,
  amount_usdc_wei text,
  merkle_proof jsonb,
  included_in_merkle boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists universal_reward_allocations_epoch_idx
  on public.universal_reward_allocations (epoch_id);

create index if not exists universal_reward_allocations_recipient_idx
  on public.universal_reward_allocations (recipient);

alter table if exists public.universal_reward_epochs enable row level security;
alter table if exists public.universal_reward_allocations enable row level security;

create or replace function public.touch_universal_reward_epochs_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists universal_reward_epochs_touch_updated_at on public.universal_reward_epochs;
create trigger universal_reward_epochs_touch_updated_at
before update on public.universal_reward_epochs
for each row
execute function public.touch_universal_reward_epochs_updated_at();
