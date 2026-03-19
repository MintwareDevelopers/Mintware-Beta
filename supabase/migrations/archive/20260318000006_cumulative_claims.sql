-- =============================================================================
-- Migration: 20260318000006_cumulative_claims
--
-- Adds support for the cumulative Merkle claim model and the zero-gas
-- oracle signature flow.
--
-- Changes:
--   distributions
--     + oracle_signature        TEXT          — EIP-712 sig from oracle signer
--     + total_cumulative_wei    TEXT          — sum of all cumulative leaf amounts
--     - onchain_id              (deprecated)  — was uint256 from createDistribution()
--                                               kept for backwards compat, not used
--
--   daily_payouts
--     + cumulative_amount_wei   TEXT NOT NULL — wallet's total earned to date
--                                               this is the Merkle leaf value
--     amount_wei is now the per-epoch increment (kept for analytics/display)
--
-- Merkle leaf encoding (contract + merkleBuilder.ts must match):
--   StandardMerkleTree.of([[wallet, cumulative_amount_wei]], ['address', 'uint256'])
--   → keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))
-- =============================================================================

-- ---------------------------------------------------------------------------
-- distributions: add oracle_signature + total_cumulative_wei
-- ---------------------------------------------------------------------------

ALTER TABLE distributions
  ADD COLUMN IF NOT EXISTS oracle_signature     TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_cumulative_wei TEXT        DEFAULT NULL;

-- Index for quickly finding pending distributions that need signing
CREATE INDEX IF NOT EXISTS idx_distributions_pending
  ON distributions (campaign_id, status)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- daily_payouts: add cumulative_amount_wei
-- ---------------------------------------------------------------------------

ALTER TABLE daily_payouts
  ADD COLUMN IF NOT EXISTS cumulative_amount_wei TEXT DEFAULT NULL;

-- Backfill: for any existing rows without cumulative_amount_wei, use amount_wei.
-- These are pre-migration rows from the per-epoch model; treat them as if
-- cumulative = incremental (epoch 1 behaviour — no prior epochs).
UPDATE daily_payouts
  SET cumulative_amount_wei = amount_wei
  WHERE cumulative_amount_wei IS NULL
    AND amount_wei IS NOT NULL;

-- Make non-nullable now that backfill is done
-- (use a safe default of '0' for any rows with null amount_wei)
UPDATE daily_payouts
  SET cumulative_amount_wei = '0'
  WHERE cumulative_amount_wei IS NULL;

-- ---------------------------------------------------------------------------
-- Comment on deprecated column
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN distributions.onchain_id IS
  'Deprecated — was uint256 from MintwareDistributor.createDistribution(). '
  'Now replaced by oracle_signature (EIP-712 signed root). '
  'Kept for backwards compatibility; ignored by current claim flow.';

COMMENT ON COLUMN distributions.oracle_signature IS
  'EIP-712 signature from the oracle signer over '
  '(campaignId bytes32, epochNumber uint256, merkleRoot bytes32). '
  'Stored as 0x-prefixed hex. Set by onchainPublisher.signMerkleRoot() after '
  'Merkle tree is built. Users pass this to MintwareDistributor.claim().';

COMMENT ON COLUMN distributions.total_cumulative_wei IS
  'Sum of all wallets'' cumulative_amount_wei in this distribution. '
  'Represents the maximum the contract could owe if every wallet claimed now '
  'for the first time. Used for contract balance monitoring.';

COMMENT ON COLUMN daily_payouts.cumulative_amount_wei IS
  'Wallet''s total earned to date across all epochs of this campaign. '
  'This is the value encoded in the Merkle leaf. '
  'amount_wei holds just this epoch''s incremental payout.';
