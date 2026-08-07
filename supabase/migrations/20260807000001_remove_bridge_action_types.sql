-- ============================================================================
-- Remove retired campaign action types: 'bridge' and 'referral_bridge'.
--
-- The bridge campaign action (reward users for bridging to a chain) was only
-- ever verifiable on Core DAO, which was never shipped (its bridge contract
-- stayed a pending placeholder). The Core chain, its bridge verifier, and the
-- daily bridge-verify cron have been removed from the app; this drops the two
-- now-unused action types from the activity.action_type CHECK.
--
-- Narrows the CHECK set from 20260728000002_activity_action_types.sql. Any stray
-- legacy rows (there should be none — the bridge path never credited real
-- points) are deleted first so the tightened constraint applies cleanly.
-- Idempotent (safe to re-run).
-- ============================================================================

-- Remove any legacy rows for the retired action types (none expected).
delete from activity where action_type in ('bridge', 'referral_bridge');

-- Drop the existing action_type CHECK regardless of its auto-generated name,
-- then re-add the narrowed set (RWA action types retained; bridge removed).
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
    'trade', 'referral_trade',
    'subscribe', 'hold', 'referral_subscribe'
  ));
