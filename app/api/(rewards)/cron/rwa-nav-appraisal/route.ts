// =============================================================================
// GET /api/cron/rwa-nav-appraisal
//
// Keeper cron for the RWA vRWA/USDC oracle pool. Reads the vault's on-chain NAV
// (ERC-4626 convertToAssets) and posts the matching Q96 appraisal to
// MintwareOracleHook.setAppraisal so the pool's price bands track NAV.
//
// Env-gated (see lib/web3/rwa/navKeeper.ts): no-ops with skipped:'not_configured'
// until RWA_ORACLE_HOOK_ADDRESS / RWA_POOL_ID / RWA_VAULT_ADDRESS / RWA_POOL_VRWA
// / RWA_POOL_USDC / RWA_KEEPER_PRIVATE_KEY are set — safe to ship before the pool
// exists. Schedule: weekly (Monday), alongside the other RWA crons.
//
// Authorization: Bearer <CRON_SECRET>
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { runNavAppraisal } from '@/lib/web3/rwa/navKeeper'

export const maxDuration = 120

export const GET = createHandler(async (_req, ctx) => {
  try {
    const report = await runNavAppraisal()
    if (!report.configured) ctx.log.info('rwa-nav', 'keeper not configured — skipping', {})
    else if (report.skipped) ctx.log.warn('rwa-nav', `skipped: ${report.skipped}`, { ...report } as Record<string, unknown>)
    else ctx.log.info('rwa-nav', 'appraisal posted', { poolId: report.poolId, txHash: report.txHash })
    return ctx.json({ ok: true, ...report })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.log.error('rwa-nav', 'appraisal failed', { message })
    return ctx.json({ ok: false, error: message }, 500)
  }
}, { auth: 'bearer-token' })
