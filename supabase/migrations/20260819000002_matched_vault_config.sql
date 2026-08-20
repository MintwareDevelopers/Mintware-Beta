-- Matched-liquidity launch config. A team commits its token; the community funds the quote up to
-- match_target_usdc; the team's token pairs PROPORTIONALLY as it fills (matchedTokens =
-- teamTokens × filled/target), and the pool activates once community fill reaches
-- activation_threshold_bps of the target (contract also requires ≥3 backers). Nullable — only
-- vault_kind='matched' rows use them. RLS on social_vaults is unchanged (writes are service-role only).
alter table social_vaults add column if not exists match_target_usdc numeric;
alter table social_vaults add column if not exists activation_threshold_bps integer
  check (activation_threshold_bps is null or (activation_threshold_bps > 0 and activation_threshold_bps <= 10000));

comment on column social_vaults.match_target_usdc is 'matched vaults: target community quote (USDC) to raise';
comment on column social_vaults.activation_threshold_bps is 'matched vaults: min community fill vs target to go live (bps; e.g. 5000 = 50%)';
