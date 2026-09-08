// RED-TEAM PoC (off-chain, 2026-09-08) — deposit MISROUTING via the silent single-env fallback.
// /api/gateway/{meta,deposit,withdraw,position,alerts} resolved the pool from a caller-supplied `pool`
// param; on NO registry match they fell back to the env instance (LP_GATEWAY_POSITION_MANAGER) and
// /api/gateway/meta hard-coded `live: true`. The UI's slug ("meme-usdg", from the GeckoTerminal pair
// label) never equals the registry key (a 32-byte v4 poolId), so EVERY /earn/[pool] page deposited into
// the fallback PM. Verified live at the time: GET https://mintware.finance/api/gateway/meta?pool=nonexistent-pool →
// {positionManager: 0x24ff…3b11, poolAddress: "pons-usdg", live: true}.
//
// STATUS AFTER CLOSE-OUT (docs/developers/audits/closeout/ui-money-path.md O-2 / O-1):
//   • every MONEY-PATH route (meta/position/positions/deposit/withdraw) now resolves through
//     `lib/gateway/routeInstance.ts#resolveInstanceStrict` — registry populated ⇒ a miss is 404 `pool_not_live`
//     (label slugs, inactive rows, attacker strings, even the env pool); registry empty ⇒ the env rig is served
//     ONLY for its own pool, tagged `source:'env-fallback'`, `live:false`. The `_FIXED` cases lock that.
//   • RESIDUAL (kept as evidence, first block): the legacy `registry.resolveRouteInstance` helper still falls
//     back to the env PM. It is no longer on any money path — its one remaining caller is the read-only
//     `/api/gateway/alerts` (ui-money-path.md "residual risk"). Do not re-wire it into a route that moves funds.
import { describe, it, expect } from 'vitest'
import { resolveRouteInstance } from '../registry'
import { resolveInstanceStrict, listResolvableInstances } from '../routeInstance'
import { fakeSupabase } from './fakeSupabase'
import { nextDepositBasis } from '../basisMath'

const ENV_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const REG_PM = '0x00000000000000000000000000000000000000aa' as const
const POOL_ID = '0x' + 'ab'.repeat(32)
const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: ENV_PM, staging: null, poolAddress: 'pons-usdg' }
const activeRow = { pool_address: POOL_ID, chain_id: 46630, position_manager: REG_PM, staging: '0x' + '11'.repeat(20), quote_asset: '0x' + '22'.repeat(20), status: 'active' }

describe('LEGACY helper (residual, read-only alerts only): resolveRouteInstance still falls back to the env PM', () => {
  it('a registered v4 pool keyed by poolId is NOT found when the UI passes its pair-label slug → fallback', async () => {
    const { client } = fakeSupabase({ tables: { gateway_instances: [activeRow] } })
    // V1Discover (pre-fix): slug = encodeURIComponent(pairLabel.replace(/\s*\/\s*/g,'-').toLowerCase()) → "meme-usdg"
    const inst = await resolveRouteInstance(client, cfg, 'meme-usdg')
    expect(inst?.positionManager).toBe(ENV_PM)
    expect(inst?.poolAddress).toBe('pons-usdg')
  })

  it('an INACTIVE (deactivated) instance also falls back to the env PM instead of 404-ing', async () => {
    const { client } = fakeSupabase({ tables: { gateway_instances: [{ ...activeRow, status: 'inactive' }] } })
    const inst = await resolveRouteInstance(client, cfg, POOL_ID)
    expect(inst?.positionManager).toBe(ENV_PM)
  })

  it('an arbitrary attacker-crafted pool param is accepted (no 404)', async () => {
    const { client } = fakeSupabase()
    const inst = await resolveRouteInstance(client, cfg, "'; drop table --")
    expect(inst?.positionManager).toBe(ENV_PM)
  })
})

describe('_FIXED (O-2): the money path resolves STRICTLY — a miss is 404, the env rig is never "live"', () => {
  it('defense holds: the pair-label slug for a registered poolId → 404 pool_not_live; the poolId itself → the registry PM, live:true', async () => {
    const { client } = fakeSupabase({ tables: { gateway_instances: [activeRow] } })
    expect(await resolveInstanceStrict(client, cfg, 'meme-usdg')).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    const hit = await resolveInstanceStrict(client, cfg, POOL_ID.toUpperCase())
    expect(hit).toMatchObject({ ok: true, inst: { positionManager: REG_PM, poolAddress: POOL_ID, source: 'registry', live: true } })
    // the env pool is NOT reachable while the registry is populated either
    expect(await resolveInstanceStrict(client, cfg, 'pons-usdg')).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    // UI links are now keyed by poolId (V1Discover.slug / V1Portfolio.slugOf emit p.poolAddress) — the label is display-only
  })

  it('defense holds: an INACTIVE (deactivated) instance is a 404 — never the env rig', async () => {
    const { client } = fakeSupabase({ tables: { gateway_instances: [{ ...activeRow, status: 'inactive' }] } })
    expect(await resolveInstanceStrict(client, cfg, POOL_ID)).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    expect(await listResolvableInstances(client, cfg)).toEqual([expect.objectContaining({ source: 'env-fallback', live: false })]) // registry has NO active row ⇒ only the rig, and only as a dev rig
  })

  it('defense holds: an attacker-crafted /earn/<anything> is a 404 whether the registry is populated or empty', async () => {
    const populated = fakeSupabase({ tables: { gateway_instances: [activeRow] } }).client
    const empty = fakeSupabase().client
    for (const bad of ["'; drop table --", 'not-a-registered-pool', '0x' + '00'.repeat(32)]) {
      expect(await resolveInstanceStrict(populated, cfg, bad)).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
      expect(await resolveInstanceStrict(empty, cfg, bad)).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    }
  })

  it('defense holds: while the registry is EMPTY the env rig is served only for its own pool, tagged env-fallback and live:false', async () => {
    const { client } = fakeSupabase()
    const r = await resolveInstanceStrict(client, cfg, 'pons-usdg')
    expect(r).toMatchObject({ ok: true, inst: { positionManager: ENV_PM, poolAddress: 'pons-usdg', source: 'env-fallback', live: false } })
    // nothing configured at all ⇒ 503, never a fabricated target
    expect(await resolveInstanceStrict(client, { ...cfg, positionManager: null, poolAddress: null }, 'pons-usdg')).toEqual({ ok: false, status: 503, error: 'gateway_not_configured' })
  })
})

describe('ledger drift baked into the UI flow (A-4 root cause) — the math is unchanged; the UI now records both legs (O-1)', () => {
  it('cost basis is additive and only ever reduced by /api/gateway/withdraw — which the UI now calls after every successful withdraw', () => {
    // Pre-fix: V1PoolDetail#withdraw() → tx → 'done' with no record call, and #deposit() POSTed an unsigned
    // body (401). Post-fix (ui-money-path.md O-1): confirmDeposit/confirmWithdraw sign the exact route message
    // and POST; failure shows "not yet recorded" + Retry; the Portfolio is chain-first so an unrecorded
    // position is visible with an "Unrecorded" badge. The pure math below still shows WHY recording matters.
    let basis = 0n
    const D = 1_000_000_000n // 1,000 USDG
    for (let cycle = 0; cycle < 5; cycle++) basis = nextDepositBasis(basis, D, false) // deposit… withdraw (UNRECORDED)… repeat
    expect(basis).toBe(5n * D) // "capital at work" = 5,000 USDG on 1,000 USDG of actual capital — if withdraws were never recorded
    // O-11 (profile-leaderboard.md): the leaderboard no longer ranks by Σ entry_nav at all — it ranks by on-chain
    // sharesOf × NAV pinned to one block, so this drift can no longer inflate a rank even when a record is missed.
  })
})
