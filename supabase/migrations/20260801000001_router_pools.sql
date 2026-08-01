-- MW meta-router pool registry.
-- Each row is a Mintware V4 pool the internal router may route a listed pair against.
-- Read by POST /api/swap/best-route (server, service role) to decide LI.FI vs internal.
-- Empty until Slice 2 is deployed + pools seeded → router falls through to LI.FI.
-- Design: docs/developers/phase3-router-design.md

create table if not exists public.router_pools (
  id           uuid primary key default gen_random_uuid(),
  chain_id     integer     not null,
  router       text        not null,           -- MWRouter address (execution target)
  hooks        text        not null,           -- MWSocialHook (PoolKey.hooks)
  currency0    text        not null,           -- V4 PoolKey, canonical sort (currency0 < currency1)
  currency1    text        not null,
  fee          integer     not null,           -- V4 PoolKey fee (uint24; may carry dynamic-fee flag)
  tick_spacing integer     not null,           -- V4 PoolKey tick spacing (int24)
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  -- Addresses are stored lowercase; the pair is unique per chain (either token order).
  constraint router_pools_pair_unique unique (chain_id, currency0, currency1)
);

-- Hot path: fetch active pools for a chain.
create index if not exists router_pools_chain_active_idx
  on public.router_pools (chain_id) where active;

-- RLS: server routes use the service role (bypasses RLS). No anon access — the
-- registry is read server-side only. Enable RLS with no public policy so a leaked
-- anon key cannot read or write it.
alter table public.router_pools enable row level security;
