-- RWA on-chain deployment: record the deployed vault/vRWA/hook + pool key on the
-- RWA vault row once a deal is listed on-chain (via DeployRwaFlow.s.sol). The list
-- step also seeds a `router_pools` row so the meta-router can trade the vRWA/USDC pair.
-- Until a deal is listed, these stay null and the deal is paperwork-only. See
-- docs/developers/phase3-router-design.md + the RWA build spec.

alter table public.social_vaults
  add column if not exists vault_address     text,       -- MintwareRWAVault4626
  add column if not exists vrwa_address       text,      -- MintwareVRWA (the tradeable bearer token)
  add column if not exists hook_address       text,      -- MintwareOracleHook (bands)
  add column if not exists pool_currency0     text,      -- V4 PoolKey (canonical sort order)
  add column if not exists pool_currency1     text,
  add column if not exists pool_fee           bigint,    -- V4 fee (dynamic-fee flag for RWA)
  add column if not exists pool_tick_spacing  integer,
  add column if not exists listed_at          timestamptz;

comment on column public.social_vaults.vault_address is 'On-chain RWA vault address (set when the deal is listed on-chain)';
comment on column public.social_vaults.vrwa_address  is 'On-chain vRWA bearer token traded on the secondary pool';
