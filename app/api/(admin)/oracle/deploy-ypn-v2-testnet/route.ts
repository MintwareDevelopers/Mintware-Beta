// DEPRECATED (2026-08-18) — do not use to deploy the YPN v2 stack.
//
// This route deployed the PRE-CONVERGENCE, module-based treasury vault: it wired a standalone
// `MintwareV4LiquidityModule` via `setLiquidityModule` / `setJitSkipSender(module)`. The P2 convergence
// DELETED that module — the current `MintwareTreasuryVault` self-holds its Uniswap-V4 position through the
// delegatecall library `MWTreasuryPositionLib`, and exposes no `setLiquidityModule`. So this route's
// embedded artifacts (`@/lib/web3/artifacts/treasuryV2` VAULT/MODULE bytecode) are stale, and the converged
// vault's linked-library bytecode can't be deployed correctly through viem's `deployContract` anyway.
//
// Canonical converged deploy is the Foundry script, which links the library and mines the hook correctly:
//   forge script contracts-v4/script/DeployTreasuryV2.s.sol --rpc-url base_sepolia --broadcast --slow
//
// The v2 SMOKE routes (`smoke-ypn-v2-testnet`, `commit-team-ypn-v2-testnet`, `jit-smoke-ypn-v2-testnet`)
// take a `vault` address, so they work unchanged against a `DeployTreasuryV2`-deployed vault. Runbook:
// docs/developers/testnet-smoke-runbook.md.

import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (_req, ctx) => {
  ctx.log.warn('deploy-ypn-v2-testnet', 'Deprecated route hit — deploys the deleted module-based vault')
  return ctx.json(
    {
      ok: false,
      error: 'deprecated',
      reason:
        'This route deployed the pre-convergence module-based treasury vault (setLiquidityModule). ' +
        'MintwareV4LiquidityModule was deleted in the P2 convergence; the current vault self-holds its V4 ' +
        'position via MWTreasuryPositionLib and has no setLiquidityModule.',
      use: 'forge script contracts-v4/script/DeployTreasuryV2.s.sol --rpc-url base_sepolia --broadcast --slow',
      runbook: 'docs/developers/testnet-smoke-runbook.md',
      note: 'The v2 smoke/commit/jit admin routes take a `vault` address and work against a DeployTreasuryV2-deployed vault.',
    },
    410,
  )
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
