-- Pair vaults are DUAL-token: a deposit provides both token0 (USDC) and token1 (e.g. WETH). The
-- ledger only recorded the USDC side (`usdc_amount`); the token1 contribution was verified from the
-- on-chain Deposited event but never persisted. Record it so a pair deposit is fully represented.
-- The reward-weighting basis is fixed separately in the deposit route: vault_lp_positions.liquidity_units
-- now accumulates the event's `sharesMinted` (V4 liquidity = both tokens), not the USDC side alone.
ALTER TABLE lp_deposits
  ADD COLUMN IF NOT EXISTS token1_amount numeric NOT NULL DEFAULT 0;
