// =============================================================================
// lib/web3/vault/treasuryProvisioning.ts
//
// Turns a persisted treasury-vault create intent (social_vaults row: project token, pool params, the
// signed + stored tranche choices) into the parameters an operator needs to actually stand the vault
// up: the env for `contracts-v4/script/DeployTreasuryV2.s.sol`, and the team's `commitTeam` call.
//
// This is the bridge between the /vault/create flow (#229) and the deploy script (#2). The actual
// on-chain broadcast is operator-gated (funded deployer key + a live adapter); this only computes the
// deterministic parameters. One thing it deliberately CANNOT compute: commitTeam's FIRST arg — the
// junior TOKEN amount — because the intent stores the junior's USD *value* (`juniorCommitUsdc`), and
// converting that to a token count needs the launch price, which is a provision-time input.
// =============================================================================

import type { VaultTrancheIntent } from '../signedActionMessages'

/** Infrastructure addresses the intent does NOT carry (chain-level, operator-supplied). */
export interface TreasuryInfra {
  poolManager: string
  usdc: string
  adapter: string // an IYieldAdapter over USDC (e.g. AaveV3YieldAdapter)
  circleTreasury: string // the card rail / protocol treasury
  edgeSigner?: string // granted EDGE_SIGNER_ROLE
  relayer?: string // granted RELAYER_ROLE
  initSqrtPrice?: string // decimal-adjusted for the real 6dp-USDC / 18dp-token pool
}

/** The parts of a persisted `social_vaults` treasury row this needs. */
export interface TreasuryCreateRecord {
  projectToken: string // the team token — the junior/volatile leg
  poolKey: { fee: number; tickSpacing: number }
  tranche: VaultTrancheIntent
}

function usdc6(value: number): string {
  // 6dp USDC base units, rounded to the nearest unit.
  return String(Math.round(value * 1e6))
}

/**
 * The env map for `forge script DeployTreasuryV2.s.sol` (the deploy-side — fully determined).
 * `DEPLOYER_PRIVATE_KEY` and any `GATEWAY_ADMIN` override are the operator's, not returned here.
 */
export function buildTreasuryDeployEnv(rec: TreasuryCreateRecord, infra: TreasuryInfra): Record<string, string> {
  const env: Record<string, string> = {
    V4_POOL_MANAGER: infra.poolManager,
    USDC_ADDRESS: infra.usdc,
    TEAM_TOKEN_ADDRESS: rec.projectToken,
    ADAPTER_ADDRESS: infra.adapter,
    CIRCLE_TREASURY: infra.circleTreasury,
    POOL_FEE: String(rec.poolKey.fee),
    TICK_SPACING: String(rec.poolKey.tickSpacing),
  }
  if (infra.initSqrtPrice) env.INIT_SQRT_PRICE = infra.initSqrtPrice
  if (infra.edgeSigner) env.EDGE_SIGNER = infra.edgeSigner
  if (infra.relayer) env.RELAYER = infra.relayer
  return env
}

/**
 * The team's post-deploy `commitTeam(teamTokens, juniorUSDC, lockDur)` args that the intent DOES
 * determine:
 *   - `juniorUsdc6dp` → commitTeam's 2nd arg. Non-zero only when the team chose to SUBORDINATE its
 *     USDC (first-loss, PR #227); otherwise the team's USDC is senior and goes in via `depositUSDC`.
 *   - `seniorUsdc6dp` → the team's senior deposit (a SEPARATE `depositUSDC` step), non-zero only when
 *     NOT subordinated.
 *   - `lockSeconds`   → commitTeam's 3rd arg.
 * commitTeam's 1st arg (the junior TOKEN amount) is computed at provision time from
 * `tranche.juniorCommitUsdc` and the launch price — it is not derivable here.
 */
/**
 * The gateway role grants an operator MUST make after standing a treasury up, or the corresponding
 * money paths silently revert on-chain. Learned the hard way (2026-08-20 E2E): a factory-deployed
 * gateway grants RELAYER_ROLE to `gatewayAdmin` (the deployer) — but `settleSpend` is submitted by the
 * ORACLE signer (`getOracleSigner('root')`), a DIFFERENT address. Without this grant the card/settle
 * path reverts with `AccessControlUnauthorizedAccount`, and the tx still mines (status 0), so callers
 * that don't check the receipt would mis-record it as settled.
 *
 * `DeployTreasuryV2.s.sol` already grants these when its `RELAYER`/`EDGE_SIGNER` envs are set — but the
 * FACTORY path does not, so return the grants explicitly for either path. Each is `grantRole(role,
 * account)` on the gateway, callable by its DEFAULT_ADMIN.
 *
 *   RELAYER_ROLE  → the oracle/relayer that submits settleSpend (REQUIRED for any settlement).
 *   EDGE_SIGNER_ROLE → the edge-auth signer, only if ≥$250 (ShortLivedHoldAuth) settlement is used.
 */
export function requiredGatewayRoleGrants(opts: { relayer: string; edgeSigner?: string }): Array<{ role: 'RELAYER_ROLE' | 'EDGE_SIGNER_ROLE'; account: string; required: boolean; why: string }> {
  const grants: Array<{ role: 'RELAYER_ROLE' | 'EDGE_SIGNER_ROLE'; account: string; required: boolean; why: string }> = [
    { role: 'RELAYER_ROLE', account: opts.relayer, required: true, why: 'submits settleSpend; without it every settlement reverts (AccessControlUnauthorizedAccount)' },
  ]
  if (opts.edgeSigner) {
    grants.push({ role: 'EDGE_SIGNER_ROLE', account: opts.edgeSigner, required: false, why: 'signs the ShortLivedHoldAuth for ≥$250 settlements (unneeded below the high-value threshold)' })
  }
  return grants
}

export function trancheCommitPlan(t: VaultTrancheIntent): {
  juniorUsdc6dp: string
  seniorUsdc6dp: string
  lockSeconds: number
  juniorCommitUsdcValue: number
} {
  const subordinated = t.subordinateUsdc && t.teamUsdc > 0
  return {
    juniorUsdc6dp: subordinated ? usdc6(t.teamUsdc) : '0',
    seniorUsdc6dp: subordinated ? '0' : usdc6(t.teamUsdc),
    lockSeconds: t.lockDays * 86_400,
    juniorCommitUsdcValue: t.juniorCommitUsdc, // token amount = this / launchPrice, at provision time
  }
}
