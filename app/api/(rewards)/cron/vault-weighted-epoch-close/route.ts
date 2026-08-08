// POST /api/cron/vault-weighted-epoch-close
// Auth: Bearer CRON_SECRET
//
// Closes due epochs for pair vaults wired to MintwareWeightedDistributor. For each such
// vault it: loads the epoch's LP positions + referral graph + Attribution percentiles,
// runs the weighted allocation, oracle-signs the EpochRoot, submits closeEpoch on-chain
// via a keeper, and persists the Merkle tree for the claim route.
//
// FAIL-CLOSED (C9): if the Attribution score source is unavailable for a vault's epoch,
// that vault is SKIPPED (epoch left open) — never closed on a degraded snapshot.
//
// Deployment prerequisites (this route no-ops cleanly until they exist):
//   • env KEEPER_PRIVATE_KEY (gas payer; holds NO reward authority) + a chain RPC
//   • the distributor deployed and each vault wired via setWeightedDistributor()
//   • Supabase: `social_vaults` rows carry weighted_distributor_address /
//     weighted_distributor_vault_id / token0_decimals / token1_decimals / current epoch;
//     `vault_lp_positions` (wallet, liquidity_units, lock_tier, deposited_at) per vault;
//     `referral_records` (referrer, referred); `vault_weighted_epochs` sink table.

import { createHandler } from '@/lib/web2/routeHandler'
import { API } from '@/lib/web2/api'
import { CHAIN_RPC } from '@/lib/constants'
import type { Hex } from 'viem'
import type { LockTier } from '@/lib/web2/vault/types'
import {
  assembleLpInputs,
  buildClaimIndex,
  submitCloseEpoch,
  type RawLpPosition,
} from '@/lib/rewards/vault/weightedEpochCloser'
import {
  buildAndSignWeightedEpoch,
  ScoreSourceUnavailableError,
} from '@/lib/rewards/vault/weightedEpochOrchestrator'

export const dynamic = 'force-dynamic'

const SIG_WINDOW_SECS = 60 * 60 // keeper must submit within an hour of signing

/** Best-effort Attribution percentile fetch for a set of wallets. Returns null (→ fail-closed)
 *  if the score source errors wholesale; a per-wallet miss is simply absent from the map. */
async function loadPercentiles(wallets: string[]): Promise<Map<string, number> | null> {
  try {
    const map = new Map<string, number>()
    await Promise.all(
      wallets.map(async (w) => {
        const res = await fetch(`${API}/score?address=${w}`, { cache: 'no-store' })
        if (res.ok) {
          const pct = (await res.json())?.percentile
          if (typeof pct === 'number') map.set(w.toLowerCase(), pct)
        }
      })
    )
    return map
  } catch {
    return null // score source down → caller fail-closes
  }
}

export const POST = createHandler(async (_req, ctx) => {
  const keeperKey = process.env.KEEPER_PRIVATE_KEY as Hex | undefined
  if (!keeperKey) {
    return ctx.json({ skipped: true, reason: 'KEEPER_PRIVATE_KEY not set' })
  }

  // Vaults wired to the distributor with an epoch due to close.
  const { data: vaults } = await ctx.supabase
    .from('social_vaults')
    .select('id, chain_id, weighted_distributor_address, weighted_distributor_vault_id, token0_decimals, token1_decimals, current_epoch, epoch_ends_at, fees0, fees1')
    .not('weighted_distributor_address', 'is', null)

  if (!vaults?.length) return ctx.json({ closed: 0, vaults: 0 })

  const results: Array<{ vault: string; status: string; tx?: string }> = []

  for (const v of vaults) {
    try {
      // 1. LP positions for this vault's open epoch.
      const { data: positions } = await ctx.supabase
        .from('vault_lp_positions')
        .select('wallet, liquidity_units, lock_tier, deposited_at')
        .eq('vault_id', v.id)
        .eq('status', 'active')

      if (!positions?.length) { results.push({ vault: v.id, status: 'no_positions' }); continue }

      const raw: RawLpPosition[] = positions.map((p: {
        wallet: string; liquidity_units: number | string; lock_tier: string; deposited_at: string
      }) => ({
        wallet: p.wallet,
        liquidityUnits: Number(p.liquidity_units),
        lockTier: p.lock_tier as LockTier,
        daysHeld: (Date.now() - new Date(p.deposited_at).getTime()) / 86_400_000,
      }))

      // 2. Referral graph (referred → referrer) for these wallets.
      const wallets = raw.map((r) => r.wallet.toLowerCase())
      const { data: refs } = await ctx.supabase
        .from('referral_records')
        .select('referrer, referred')
        .in('referred', wallets)
      const referrerByWallet = new Map<string, string>()
      for (const r of refs ?? []) referrerByWallet.set(r.referred.toLowerCase(), r.referrer.toLowerCase())

      // 3. Attribution percentiles (fail-closed on outage).
      const percentileByWallet = await loadPercentiles(wallets)
      const { lps, scoresAvailable } = assembleLpInputs(raw, referrerByWallet, percentileByWallet)

      // 4. Weight → tree → oracle-signed EpochRoot (throws ScoreSourceUnavailableError → skip).
      const deadline = Math.floor(Date.now() / 1000) + SIG_WINDOW_SECS
      const signed = await buildAndSignWeightedEpoch({
        vaultId: v.weighted_distributor_vault_id as `0x${string}`,
        epochNumber: Number(v.current_epoch),
        distributorAddress: v.weighted_distributor_address as `0x${string}`,
        chainId: Number(v.chain_id),
        feesPot: { amount0: Number(v.fees0 ?? 0), amount1: Number(v.fees1 ?? 0) },
        lps,
        token0Decimals: Number(v.token0_decimals ?? 18),
        token1Decimals: Number(v.token1_decimals ?? 18),
        deadline,
        scoresAvailable,
      })

      // 5. Submit closeEpoch on-chain via the keeper.
      const rpcUrl = CHAIN_RPC[Number(v.chain_id) === 8453 ? 'base' : 'base_sepolia']
      const txHash = await submitCloseEpoch(
        {
          distributorAddress: v.weighted_distributor_address as `0x${string}`,
          chainId: Number(v.chain_id),
          rpcUrl,
          keeperPrivateKey: keeperKey,
        },
        signed.closeEpochArgs
      )

      // 6. Persist the tree for the claim route.
      await ctx.supabase.from('vault_weighted_epochs').upsert({
        vault_id: v.id,
        epoch_number: Number(v.current_epoch),
        merkle_root: signed.merkleRoot,
        total0_wei: signed.total0Wei,
        total1_wei: signed.total1Wei,
        deadline,
        tx_hash: txHash,
        claim_index: buildClaimIndex(signed),
        tree_json: signed.treeDump,
        margin_required0: signed.marginRequired.amount0,
        margin_required1: signed.marginRequired.amount1,
      }, { onConflict: 'vault_id,epoch_number' })

      ctx.log.info('vault-weighted-epoch-close', 'closed', { vault: v.id, epoch: v.current_epoch, tx: txHash })
      results.push({ vault: v.id, status: 'closed', tx: txHash })
    } catch (e) {
      if (e instanceof ScoreSourceUnavailableError) {
        ctx.log.warn('vault-weighted-epoch-close', 'skipped (scores unavailable, fail-closed)', { vault: v.id })
        results.push({ vault: v.id, status: 'skipped_scores_unavailable' })
      } else {
        ctx.log.error('vault-weighted-epoch-close', 'error', { vault: v.id, error: String(e) })
        results.push({ vault: v.id, status: 'error' })
      }
    }
  }

  return ctx.json({ vaults: vaults.length, closed: results.filter((r) => r.status === 'closed').length, results })
}, { auth: 'bearer-token' })
