-- =============================================================================
-- Migration: Fix pending_rewards unique index scope (H2 audit finding)
--
-- The original index (tx_hash, reward_type) was missing campaign_id.
-- This allowed the same (tx_hash, reward_type) pair to create only one row
-- across ALL campaigns — a tx that appears in two campaigns would silently
-- drop the second reward row via ignoreDuplicates.
--
-- Fix: drop the narrow index, add campaign_id as the leading column.
-- =============================================================================

DROP INDEX IF EXISTS pending_rewards_tx_type_uidx;

CREATE UNIQUE INDEX pending_rewards_campaign_tx_type_uidx
  ON pending_rewards (campaign_id, tx_hash, reward_type);
