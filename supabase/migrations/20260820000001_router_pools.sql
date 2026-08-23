-- ============================================================================
-- router_pools (2026-08-20)
-- ============================================================================
-- Registry of Mintware V4 pools the MW meta-router can price a swap against.
-- Read by app/api/(web2)/swap/best-route/route.ts via registryFromFetcher()
-- (lib/web2/router/listing.ts). Row shape mirrors RouterPoolRow in that module.
--
-- The meta-router is flag-gated OFF in prod (NEXT_PUBLIC_MW_ROUTER_ENABLED unset →
-- LI.FI-only). This table simply removes the "relation does not exist" failure so the
-- registry query returns [] cleanly until Track 0 seeds real pools. Writes are
-- operator/service-role only (no self-serve pool listing yet).
--
-- RLS: deny-all, matching 20260819000001_rls_backfill_hardening.sql. The table is
-- accessed ONLY by the server route on the service-role client (BYPASSRLS); the browser
-- never reads it, so no anon policy is added. Supabase applies no REVOKE, so RLS is the
-- only gate against the public anon key.
-- ============================================================================

create table if not exists public.router_pools (
  id           uuid primary key default gen_random_uuid(),
  chain_id     integer     not null,
  router       text        not null,
  hooks        text        not null,
  currency0    text        not null,
  currency1    text        not null,
  fee          integer     not null,
  tick_spacing integer     not null,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- One listing per pool key (order-sensitive on currency0/currency1 — the V4 pool id is
-- derived from the sorted pair + fee + tickSpacing + hooks, so this is the canonical key).
create unique index if not exists router_pools_pool_key
  on public.router_pools (chain_id, currency0, currency1, fee, tick_spacing, hooks);

-- Hot path: best-route fetches active rows for a chain.
create index if not exists router_pools_chain_active
  on public.router_pools (chain_id) where active;

-- Deny-all RLS (service-role only). See migration header + 20260819000001.
alter table if exists public.router_pools enable row level security;
