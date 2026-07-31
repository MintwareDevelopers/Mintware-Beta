// RWA oracle-pool keeper — NAV → appraisal price math.
//
// MintwareOracleHook stores a keeper-set `appraisalX96` and enforces price bands
// around it. The hook's price convention (priceX96FromSqrt = sqrtP²/2^96) is the
// Uniswap-v4 raw price: appraisalX96 = (token1 raw units / token0 raw units) × 2^96.
//
// NAV source is the RWA vault's ERC-4626 accounting: `convertToAssets(1 whole
// share)` returns the USDC (asset) raw amount backing one whole vRWA (shares are
// minted 1:1 with vRWA). That raw amount IS the fair price of one whole vRWA in
// raw USDC — so the decimal scaling collapses to just the vRWA unit and Q96.
//
// Deliberately pure + integer-only (no floats) so it can be unit-tested and can't
// drift from the on-chain convention.

const Q96 = 1n << 96n

export interface NavToAppraisalInput {
  /** convertToAssets(10**shareDecimals): raw USDC backing one whole vRWA. Must be > 0. */
  assetsPerWholeShareRaw: bigint
  /** decimals() of the vRWA / pool share token. */
  vrwaDecimals: number
  /** true when vRWA is the pool's currency0 (i.e. vRWAaddress < USDCaddress). */
  vrwaIsCurrency0: boolean
}

/**
 * Compute the Q96 appraisal price to post via `setAppraisal(poolId, appraisalX96)`.
 * Matches the hook's `priceX96` = token1/token0 raw × 2^96.
 */
export function appraisalX96FromNav({
  assetsPerWholeShareRaw: a,
  vrwaDecimals,
  vrwaIsCurrency0,
}: NavToAppraisalInput): bigint {
  if (a <= 0n) throw new Error('appraisalX96FromNav: NAV (assetsPerWholeShareRaw) must be positive')
  if (!Number.isInteger(vrwaDecimals) || vrwaDecimals < 0 || vrwaDecimals > 36)
    throw new Error(`appraisalX96FromNav: bad vrwaDecimals ${vrwaDecimals}`)

  const oneVrwa = 10n ** BigInt(vrwaDecimals)

  // token0 = vRWA, token1 = USDC → price = rawUSDC / rawVRWA
  //   = a (raw USDC for 1 whole vRWA) / oneVrwa (raw vRWA in 1 whole vRWA) × 2^96
  // token0 = USDC, token1 = vRWA → reciprocal.
  return vrwaIsCurrency0
    ? (a * Q96) / oneVrwa
    : (oneVrwa * Q96) / a
}
