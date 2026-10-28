-- Drop tables, views and functions that nothing on `main` reads or writes.
--
-- Why: the Free-tier instance is over its memory limit and swaps to disk, which is
-- what drains the Disk IO budget. Every relation adds to PostgREST's schema cache
-- and to each backend's catalog cache, so dead schema costs memory for nothing.
-- This is housekeeping; it does not by itself guarantee the instance stops swapping.
--
-- Scope: 18 relations with zero references in app/, lib/ or components/ (campaign,
-- RWA and pre-pivot leftovers), plus the campaign-era functions that only touch them
-- and that no code calls. Tables still referenced on `main` (campaigns, activity,
-- distributions, pending_rewards, vault_* reward rails, ...) are left for a later
-- cleanup once the simplification branches that delete their code have merged.
--
-- Safety: no CASCADE anywhere. If a relation has a dependent object outside this
-- list, the DROP fails and the whole migration rolls back with nothing changed.
-- Row backups (JSON, 33 rows across 7 tables; the other 11 are empty) were taken
-- on 2026-10-28 before this was written.

begin;

-- campaigns.linked_deal_id references vault_deals; keep the column, drop the FK.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = 'campaigns' and con.contype = 'f'
       and con.confrelid = to_regclass('public.vault_deals')
  loop
    execute format('alter table public.campaigns drop constraint %I', c.conname);
  end loop;
end $$;

-- Some of these were created in the dashboard, so their FKs between each other are
-- not all visible in the repo. Drop in passes: anything blocked only by another
-- listed relation succeeds on a later pass; a pass with no progress means an
-- outside dependency, so re-raise and roll back.
do $$
declare
  pending text[] := array[
    'campaign_leaderboard',
    'campaign_payouts',
    'participants',
    'epoch_state',
    'swap_events',
    'swap_quotes',
    'token_pool_deductions',
    'vault_deal_documents',
    'vault_redemptions',
    'vault_deals',
    'vault_issuers',
    'vault_seeding',
    'seed_contributions',
    'team_seeds',
    'ai_campaign_volume',
    'ai_volume_campaigns',
    'auth_nonces',
    'wallet_activity'
  ];
  remaining text[];
  rel text;
  kind "char";
  last_err text;
begin
  while cardinality(pending) > 0 loop
    remaining := '{}';
    foreach rel in array pending loop
      select c.relkind into kind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = rel;
      begin
        if kind is null then
          raise notice 'skip %: not present', rel;
        elsif kind = 'v' then
          execute format('drop view public.%I', rel);
        elsif kind = 'm' then
          execute format('drop materialized view public.%I', rel);
        elsif kind in ('r', 'p') then
          execute format('drop table public.%I', rel);
        else
          raise exception 'unexpected relkind % for %', kind, rel;
        end if;
      exception when dependent_objects_still_exist then
        last_err := sqlerrm;
        remaining := remaining || rel;
      end;
    end loop;
    if cardinality(remaining) = cardinality(pending) then
      raise exception 'blocked by an outside dependency: %', last_err;
    end if;
    pending := remaining;
  end loop;
end $$;

-- Campaign-era functions that only touch the dropped tables (or the shelved
-- campaign pool) and that no code calls. All overloads are dropped.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'deduct_token_pool_reward',
         'deduct_token_pool_reward_idempotent',
         'credit_hold_points',
         'increment_earned_usd',
         'increment_participant_points',
         'increment_epoch_points',
         'update_participants_updated_at',
         'update_epoch_state_updated_at'
       )
  loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
