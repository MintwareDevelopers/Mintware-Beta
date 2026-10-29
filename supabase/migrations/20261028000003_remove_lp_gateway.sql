-- Deferred LP Gateway removal. This migration is intentionally not applied by this change;
-- the owner will decide when it is safe to remove the retired Gateway data.

DROP VIEW IF EXISTS public.gateway_fee_ledger_reconciliation;
DROP VIEW IF EXISTS public.gateway_fee_balances;

-- The card funding rail is independent of LP Gateway. Remove its optional legacy reference first
-- so gateway_positions can be dropped without touching card-spend data.
DO $$
BEGIN
  IF to_regclass('public.card_spend_buffers') IS NOT NULL THEN
    ALTER TABLE public.card_spend_buffers DROP COLUMN IF EXISTS gateway_position_id;
  END IF;
END $$;

-- Drop every legacy overload of the Gateway RPCs, including signatures superseded by later migrations.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'record_gateway_harvest',
        'record_gateway_deposit_event',
        'record_gateway_withdraw_event',
        'recompute_gateway_position',
        'apply_gateway_pm_attribution'
      )
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.signature);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.gateway_position_recompute_issues;
DROP TABLE IF EXISTS public.gateway_position_snapshots;
DROP TABLE IF EXISTS public.gateway_alerts;
DROP TABLE IF EXISTS public.gateway_fee_payouts;
DROP TABLE IF EXISTS public.gateway_fee_credits;
DROP TABLE IF EXISTS public.gateway_harvest_logs;
DROP TABLE IF EXISTS public.gateway_known_depositors;
DROP TABLE IF EXISTS public.gateway_index_cursors;
DROP TABLE IF EXISTS public.gateway_deploy_events;
DROP TABLE IF EXISTS public.gateway_deposit_events;
DROP TABLE IF EXISTS public.harvest_events;
DROP TABLE IF EXISTS public.gateway_positions;
