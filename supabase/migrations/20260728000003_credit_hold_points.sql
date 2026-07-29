-- ============================================================================
-- RWA Incentive Layer · R4 — atomic, idempotent hold-credit RPC.
--
-- Fixes the code-review finding that the app-side insert → increment → rollback
-- pattern could double-credit on an ambiguous (post-commit) RPC failure. Moves
-- the guard-insert + participant-increment into ONE transaction, keyed on a
-- campaign-scoped unique index, so credit is idempotent regardless of any error
-- the client observes. No client-side rollback, and the insert + increment can
-- never diverge.
--
-- The pre-existing global index activity_wallet_tx_action_uidx (wallet, tx_hash,
-- action_type) is left INTACT for the DeFi path (one credit per on-chain tx,
-- globally). The hold tx_hash therefore keeps the campaign id embedded
-- (hold:<campaignId>:<epoch>:<date>) so a legitimate cross-campaign insert never
-- trips that global index while ON CONFLICT targets the campaign-scoped one.
-- ============================================================================

-- Campaign-scoped dedup index — the ON CONFLICT target below. Adding campaign_id
-- to the existing (wallet, tx_hash, action_type) tuple can only make rows more
-- unique, so this never conflicts with existing activity rows.
create unique index if not exists activity_campaign_wallet_tx_action_uidx
  on activity (campaign_id, tx_hash, wallet, action_type);

-- Atomic credit: insert the guard row + increment the participant in one tx.
-- Returns TRUE if newly credited, FALSE if it was already credited (idempotent).
create or replace function credit_hold_points(
  p_campaign_id text,
  p_wallet      text,
  p_tx_hash     text,
  p_points      numeric,
  p_recorded_at timestamptz
) returns boolean language plpgsql as $$
begin
  insert into activity (campaign_id, wallet, action_type, points_earned, tx_hash, recorded_at)
    values (p_campaign_id, p_wallet, 'hold', p_points, p_tx_hash, p_recorded_at)
    on conflict (campaign_id, tx_hash, wallet, action_type) do nothing;

  if not found then
    return false;  -- already credited for this campaign/epoch/date — idempotent no-op
  end if;

  update participants
     set total_points = total_points + p_points
   where campaign_id = p_campaign_id
     and wallet       = p_wallet;

  return true;
end;
$$;
