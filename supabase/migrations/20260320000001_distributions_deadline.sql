-- Add deadline column to distributions table.
-- Stores the unix timestamp deadline the oracle signed into the EIP-712 message.
-- Required by MintwareDistributor v2: claim() verifies block.timestamp <= deadline.
-- Nullable for backward compat — existing rows have no deadline; /api/claim falls
-- back to 90 days from now for those rows (fallback logged as console.warn).

ALTER TABLE distributions
  ADD COLUMN IF NOT EXISTS deadline bigint;

COMMENT ON COLUMN distributions.deadline IS
  'Unix timestamp (seconds) deadline included in the oracle EIP-712 signature. '
  'Passed to claim() on MintwareDistributor v2. Null for pre-v2 distributions.';
