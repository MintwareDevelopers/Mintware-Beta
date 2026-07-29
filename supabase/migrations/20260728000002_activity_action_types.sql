-- ============================================================================
-- RWA Incentive Layer · R4 fix — widen activity.action_type CHECK.
--
-- The hold-snapshot cron writes action_type='hold', but the original CHECK
-- (20260319000003_participants_and_activity.sql) only allowed
-- bridge|trade|referral_bridge|referral_trade — so every hold insert failed
-- with Postgres 23514, was swallowed by the cron's `if (insErr) skipped++`,
-- and R4 credited nothing while reporting ok:true. Widen the CHECK to the RWA
-- action types. Additive; existing rows/values are unaffected.
--
-- Drops the existing CHECK regardless of its auto-generated name, then re-adds
-- the widened one under a stable name. Idempotent (re-run drops + re-adds).
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'activity'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%action_type%'
  loop
    execute format('alter table activity drop constraint %I', r.conname);
  end loop;
end $$;

alter table activity
  add constraint activity_action_type_check
  check (action_type in (
    'bridge', 'trade', 'referral_bridge', 'referral_trade',
    'subscribe', 'hold', 'referral_subscribe'
  ));
