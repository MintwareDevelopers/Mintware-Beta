// RED-TEAM PoC (off-chain, 2026-09-08) — deposit MISROUTING via the silent single-env fallback.
// /api/gateway/{meta,deposit,withdraw,position,alerts} resolve the pool from a caller-supplied `pool`
// param; on NO registry match they fall back to the env instance (LP_GATEWAY_POSITION_MANAGER) and
// /api/gateway/meta hard-codes `live: true`. The UI's slug ("meme-usdg", from the GeckoTerminal pair
// label) never equals the registry key (a 32-byte v4 poolId), so EVERY /earn/[pool] page deposits into
// the fallback PM. Verified live: GET https://mintware.finance/api/gateway/meta?pool=nonexistent-pool →
// {positionManager: 0x24ff…3b11, poolAddress: "pons-usdg", live: true}. Passing = demonstrated.
import { describe, it, expect } from 'vitest'
import { resolveRouteInstance } from '../registry'
import { fakeSupabase } from './fakeSupabase'
import { nextDepositBasis } from '../basisMath'

const ENV_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const REG_PM = '0x00000000000000000000000000000000000000aa' as const
const POOL_ID = '0x' + 'ab'.repeat(32)
const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: ENV_PM, staging: null, poolAddress: 'pons-usdg' }

describe('deposit misrouting: unknown / label-shaped pool param → env fallback PM, still "live"', () => {
  it('a registered v4 pool keyed by poolId is NOT found when the UI passes its pair-label slug → fallback', async () => {
    const { client } = fakeSupabase({
      tables: { gateway_instances: [{ pool_address: POOL_ID, chain_id: 46630, position_manager: REG_PM, staging: '0x1', quote_asset: '0x2', status: 'active' }] },
    })
    // V1Discover: slug = encodeURIComponent(pairLabel.replace(/\s*\/\s*/g,'-').toLowerCase()) → "meme-usdg"
    const inst = await resolveRouteInstance(client, cfg, 'meme-usdg')
    expect(inst?.positionManager).toBe(ENV_PM) // ← user on /earn/meme-usdg is handed the pons-usdg rig
    expect(inst?.poolAddress).toBe('pons-usdg')
  })

  it('an INACTIVE (deactivated) instance also falls back to the env PM instead of 404-ing', async () => {
    const { client } = fakeSupabase({
      tables: { gateway_instances: [{ pool_address: POOL_ID, chain_id: 46630, position_manager: REG_PM, staging: '0x1', quote_asset: '0x2', status: 'inactive' }] },
    })
    const inst = await resolveRouteInstance(client, cfg, POOL_ID)
    expect(inst?.positionManager).toBe(ENV_PM)
  })

  it('an arbitrary attacker-crafted pool param is accepted (no 404) — phishing link /earn/<anything> deposits into the fallback', async () => {
    const { client } = fakeSupabase()
    const inst = await resolveRouteInstance(client, cfg, "'; drop table --")
    expect(inst?.positionManager).toBe(ENV_PM)
  })
})

describe('ledger drift baked into the UI flow (A-4 root cause, not just "skips the route")', () => {
  it('cost basis is additive and only ever reduced by /api/gateway/withdraw — which the UI never calls', () => {
    // components/web2/v1/V1PoolDetail.tsx#withdraw(): tx → setStatus('done'); refreshPosition() — no record call.
    // components/web2/v1/V1PoolDetail.tsx#deposit(): POSTs {address, txHash, pool} with NO authMessage/
    // authSignature/issuedAt → 401 AUTH_REQUIRED from createHandler → the deposit is never recorded either.
    let basis = 0n
    const D = 1_000_000_000n // 1,000 USDG
    for (let cycle = 0; cycle < 5; cycle++) basis = nextDepositBasis(basis, D, false) // deposit… withdraw (unrecorded)… repeat
    expect(basis).toBe(5n * D) // leaderboard "capital at work" = 5,000 USDG on 1,000 USDG of actual capital
  })
})
