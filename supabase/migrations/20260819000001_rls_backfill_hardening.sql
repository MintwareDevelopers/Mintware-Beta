-- ============================================================================
-- RLS BACKFILL HARDENING (2026-08-19)
-- ============================================================================
-- Supabase applies no explicit GRANT/REVOKE, so the default `anon`/`authenticated`
-- full-CRUD grants on `public` tables stay in force. RLS is therefore the ONLY thing
-- standing between the public anon key (shipped in the browser bundle) and direct
-- reads/writes of a table via PostgREST.
--
-- An earlier hardening pass enabled RLS on the original/core tables (see docs/schema.sql
-- and the per-table create migrations). But every table added AFTERWARD shipped WITHOUT
-- `enable row level security`, silently reintroducing anon read/write. This migration
-- closes that gap for all 19 such tables.
--
-- POLICY MODEL: deny-all. We enable RLS and add NO anon/authenticated policy, so the
-- public key can neither read nor write these tables. This is safe because every one of
-- them is accessed ONLY by server routes through the service-role client
-- (`lib/web2/supabase.ts` → `SUPABASE_SERVICE_ROLE_KEY`), which has BYPASSRLS and is never
-- shipped to the browser. Verified: none of these tables are read by the browser supabase
-- client (the only client-side reads are the referral flow on core tables).
--
-- If a table below ever needs to be read directly by the browser, add exactly:
--     create policy "<name> public read" on public.<t> for select using (true);
-- (a SELECT-only policy — writes stay service-role only). Do NOT add anon write policies.
--
-- Idempotent: `alter table ... enable row level security` is a no-op when already enabled,
-- and `if exists` guards tables that may not be present in a given environment.
-- ============================================================================

-- ── Money path — CRITICAL (anon could forge reward magnitude / drain pools / mint rewards) ──
-- swap_quotes: server-computed USD amount the reward path trusts (audit HIGH #6/#7). Anon UPDATE
--   here defeats the exact spoof-prevention it was built for.
alter table if exists public.swap_quotes            enable row level security;
-- token_pool_deductions: idempotency guard against double-decrementing a token pool. Anon DELETE
--   of a guard row enables pool-drain replay.
alter table if exists public.token_pool_deductions  enable row level security;
-- vault_lp_positions / vault_weighted_epochs: feed the LIVE Rail B weighted distributor's Merkle
--   tree (lib/rewards/vault/vaultMerkleBuilder.ts). Anon INSERT/UPDATE inflates one's own payout.
alter table if exists public.vault_lp_positions     enable row level security;
alter table if exists public.vault_weighted_epochs  enable row level security;

-- ── Tenancy & PII — holds invited emails (must never be anon-readable) ──
alter table if exists public.orgs                   enable row level security;
alter table if exists public.org_members            enable row level security;
alter table if exists public.waitlist               enable row level security;

-- ── AI / agent scoring + oracle signature state ──
alter table if exists public.ai_agent_scores        enable row level security;
alter table if exists public.ai_agent_profiles      enable row level security;
alter table if exists public.ai_agent_mwp_hashes    enable row level security;
alter table if exists public.ai_agent_pnl           enable row level security;
alter table if exists public.ai_campaign_volume     enable row level security;
alter table if exists public.ai_volume_campaigns    enable row level security;
alter table if exists public.ai_pending_signatures  enable row level security;

-- ── Vault operations ──
alter table if exists public.vault_rebalance_proposals enable row level security;

-- ── RWA (shelved) — lock down while the tables still exist; drop separately if truly dead ──
alter table if exists public.vault_issuers          enable row level security;
alter table if exists public.vault_deals            enable row level security;
alter table if exists public.vault_deal_documents   enable row level security;
alter table if exists public.vault_redemptions      enable row level security;

-- ============================================================================
-- POST-APPLY VERIFICATION (run in the Supabase SQL editor against production):
--
--   -- 1) Every public table should now report rowsecurity = true:
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--   order by rowsecurity, tablename;
--
--   -- 2) Confirm the DASHBOARD-MANAGED core tables (defined in docs/schema.sql, NOT in
--   --    migrations) actually have RLS applied in prod — the repo cannot verify this:
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--     and tablename in ('campaigns','wallet_profiles','referral_records','participants');
--   -- If any show rowsecurity = false, apply the RLS blocks from docs/schema.sql.
--
--   -- 3) No table should grant anon/authenticated INSERT/UPDATE/DELETE via a policy:
--   select schemaname, tablename, policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public' and cmd <> 'SELECT'
--   order by tablename;
-- ============================================================================
