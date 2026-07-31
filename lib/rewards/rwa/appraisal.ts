// RWA oracle-pool keeper — NAV → appraisal price math.
//
// MintwareOracleHook stores a keeper-set `appraisalX96` and enforces price bands
// around it. The hook's price convention (priceX96FromSqrt = sqrtP²/2^96) is the
// Uniswap-v4 raw price: appraisalX96 = (token1 raw units / token0 raw units) × 2^96.
//
// NAV source is the RWA vault's ERC-4626 accounting: `convertToAssets(sharesRaw)`
// returns the USDC (asset) raw amount backing `sharesRaw` shares. The vault mints
// vRWA 1:1 with shares **in raw units** (vrwa.mint(receiver, shares)), so
// `sharesRaw` raw shares == `sharesRaw` raw vRWA, and the pool's raw price is
// simply `assetsRaw / sharesRaw` — independent of vRWA's declared decimals. We
// therefore divide by the exact share amount passed to convertToAssets, NOT by
// 10^vrwaDecimals (that would be wrong whenever the vRWA token's decimals differ
// from the vault's share decimals, and would halt the pool).
//
// Deliberately pure + integer-only (no floats) so it can be unit-tested and can't
// drift from the on-chain convention.

const Q96 = 1n << 96n

export interface NavToAppraisalInput {
  /** convertToAssets(sharesRaw): raw USDC backing `sharesRaw` shares. Must be > 0. */
  assetsRaw: bigint
  /** the exact share amount passed to convertToAssets (also = raw vRWA amount, 1:1). Must be > 0. */
  sharesRaw: bigint
  /** true when vRWA is the pool's currency0 (i.e. vRWAaddress < USDCaddress). */
  vrwaIsCurrency0: boolean
}

/**
 * Compute the Q96 appraisal price to post via `setAppraisal(poolId, appraisalX96)`.
 * Matches the hook's `priceX96` = token1/token0 raw × 2^96.
 */
export function appraisalX96FromNav({ assetsRaw, sharesRaw, vrwaIsCurrency0 }: NavToAppraisalInput): bigint {
  if (assetsRaw <= 0n) throw new Error('appraisalX96FromNav: NAV (assetsRaw) must be positive')
  if (sharesRaw <= 0n) throw new Error('appraisalX96FromNav: sharesRaw must be positive')

  // raw price = rawUSDC / rawVRWA = assetsRaw / sharesRaw (since raw vRWA == raw shares).
  // token0 = vRWA, token1 = USDC → price = assetsRaw/sharesRaw. Reversed → reciprocal.
  return vrwaIsCurrency0
    ? (assetsRaw * Q96) / sharesRaw
    : (sharesRaw * Q96) / assetsRaw
}
