-- Deposit replay / idempotency guard.
-- The vault/deposit route verifies an on-chain deposit tx but never stored its
-- hash, so the same verified tx could be POSTed repeatedly — each replay inflating
-- vault_lp_positions.liquidity_units (reward weight), social_vaults.tvl_usdc, and
-- vault_referrals.net_liquidity. Store the tx_hash and enforce uniqueness so a
-- replay hits ON CONFLICT and is rejected before any crediting.
--
-- Partial unique index (WHERE tx_hash IS NOT NULL) keeps pre-existing rows (no
-- tx_hash) valid while enforcing one-credit-per-tx on all new deposits.

ALTER TABLE lp_deposits ADD COLUMN IF NOT EXISTS tx_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS lp_deposits_tx_hash_uq
  ON lp_deposits (tx_hash) WHERE tx_hash IS NOT NULL;

COMMENT ON COLUMN lp_deposits.tx_hash IS
  'On-chain deposit tx hash. Unique (partial) — prevents replay double-crediting.';
