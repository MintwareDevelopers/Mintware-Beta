// Regression coverage for the deploy() threshold-ordering gap Codex's live fix-watch caught
// (2026-09-09, ~22:59 UTC watch entry): `deployGateway` used to check the dust-floor threshold against
// `staged` ALONE, before it had even read the quote parked directly in the PM's own balance — so a
// parked-only recovery (staged=0, parked>0, any positive threshold under `parked`) always returned
// `below_threshold` without ever considering the parked quote. That was literally the scenario V1-03's
// original fix (see lib/gateway/positionReader.ts, lib/gateway/positionQuote.test.ts) was about: quote
// sitting idle in the PM's own balance must be usable, not stranded. FIXED same day: the parked-balance
// read now happens BEFORE the threshold check, and the check sizes off `staged + parked`.
//
// This exercises the real `deployGateway` orchestration end-to-end (not just the pure `computeDeployMinLiquidity`
// helper `deploy.test.ts` already covers) — mocking every on-chain/network seam it touches.
import { describe, it, expect, vi } from 'vitest'
import { getSqrtPriceAtTick } from './v4Math'

const PM = '0x' + 'aa'.repeat(20)
const STAGING = '0x' + 'bb'.repeat(20)
const QUOTE_ASSET = '0x' + 'cc'.repeat(20)
const CURRENCY1 = '0x' + 'ee'.repeat(20)
const POOL_MANAGER = '0x' + 'dd'.repeat(20)
const SPOT = getSqrtPriceAtTick(0) // dead-center of the fixed range, quote:paired = 1:1

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => '0x' + '99'.repeat(32)),
}))

vi.mock('./chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example' }),
  gatewayPublicClient: () => ({
    chain: { id: 46630 },
    estimateContractGas: async () => 900_000n,
    waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
      if (address === STAGING && functionName === 'stagedAssets') return 0n // nothing staged — parked-only scenario
      if (address === PM) {
        switch (functionName) {
          case 'quoteAsset': return QUOTE_ASSET
          case 'poolKey': return { currency0: QUOTE_ASSET, currency1: CURRENCY1, fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) }
          case 'poolManager': return POOL_MANAGER
          case 'tickLower': return -23040
          case 'tickUpper': return 23040
          case 'referencePrice': return [SPOT, 0n, 0n]
          case 'maxDeviationBps': return 500
        }
      }
      if (address === QUOTE_ASSET && functionName === 'balanceOf') { expect(args).toEqual([PM]); return 10_000_000n } // 10 USDG parked directly in the PM
      throw new Error(`unexpected ${address}:${functionName}`)
    },
  }),
}))
vi.mock('./poolState', () => ({ readCurrentTick: async () => ({ sqrtPriceX96: SPOT }) }))
vi.mock('./discovery', () => ({ fetchHotPools: async () => [] })) // no external reference; waived below via env
vi.mock('../web3/oracleSigner', () => ({ getOracleSigner: async () => ({ address: '0x' + 'aa'.repeat(20) }) }))
vi.mock('viem', async (original) => ({
  ...await original<typeof import('viem')>(),
  createWalletClient: () => ({ writeContract: mocks.write }),
}))

import { deployGateway } from './deploy'

describe('deployGateway — parked-only quote can still trigger a deploy (threshold-ordering fix)', () => {
  it('FIXED: staged=0, parked=10 USDG, threshold=1 USDG ⇒ deploys off the TOTAL, not just staged', async () => {
    vi.stubEnv('LP_GATEWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC', '1000000') // 1 USDG — well under the 10 USDG parked
    vi.stubEnv('LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE', 'false') // no GeckoTerminal fixture wired in this test
    try {
      const r = await deployGateway({ instance: { positionManager: PM as `0x${string}`, staging: STAGING as `0x${string}` } })
      // The old (buggy) ordering returned `below_threshold` here — staged alone (0) never cleared 1 USDG,
      // and `parked` wasn't even read yet at the point that check ran.
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.quoteDeployedAtomic).toBe(10_000_000n) // staged (0) + parked (10 USDG)
      expect(mocks.write).toHaveBeenCalled() // the deploy tx was actually submitted, not skipped
    } finally { vi.unstubAllEnvs() }
  })

  it('still refuses when staged + parked is below the threshold (the floor is real, not disabled)', async () => {
    vi.stubEnv('LP_GATEWAY_DEPLOY_ENABLED', 'true')
    vi.stubEnv('LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC', '50000000') // 50 USDG — above the 10 USDG parked
    vi.stubEnv('LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE', 'false')
    try {
      const r = await deployGateway({ instance: { positionManager: PM as `0x${string}`, staging: STAGING as `0x${string}` } })
      expect(r).toEqual({ ok: false, status: 200, error: 'staged balance below deploy threshold', reason: 'below_threshold' })
    } finally { vi.unstubAllEnvs() }
  })

  it('threshold=0 (unset) is still the explicit-disable escape hatch, regardless of how much is parked', async () => {
    vi.stubEnv('LP_GATEWAY_DEPLOY_ENABLED', 'true')
    // LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC intentionally left unset ⇒ defaults to '0'
    vi.stubEnv('LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE', 'false')
    try {
      const r = await deployGateway({ instance: { positionManager: PM as `0x${string}`, staging: STAGING as `0x${string}` } })
      expect(r).toEqual({ ok: false, status: 200, error: 'staged balance below deploy threshold', reason: 'below_threshold' })
    } finally { vi.unstubAllEnvs() }
  })
})
