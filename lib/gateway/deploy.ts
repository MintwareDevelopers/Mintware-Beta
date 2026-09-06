// LP-gateway pair/deploy orchestration — moves staged (Morpho-earning) quote capital into the target
// V4 pool once a threshold is reached. Owner-gated on-chain (getOracleSigner('root') is the position
// manager's owner); the paired leg is acquired by zapping via the MW router seam. YIELD/PRINCIPAL note:
// this deploys PRINCIPAL from staging into the LP (that's the product) — it never spends principal on a
// buffer; the yield-first rule governs the buffer path (harvest.ts), not this.
//
// DARK-LAUNCHED, fail-closed, OFF by default: no-ops unless LP_GATEWAY_DEPLOY_ENABLED === 'true' and the
// config + staging address + oracle signer resolve. Also no-ops (safely) while the zap seam is unwired.

import { createWalletClient, http } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI, LP_STAGING_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { swapQuoteToPaired } from '@/lib/gateway/routerSwap'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void; warn: (t: string, m: string, c?: Record<string, unknown>) => void; error: (t: string, m: string, c?: Record<string, unknown>) => void }

type Reason = 'disabled' | 'config' | 'signer' | 'below_threshold' | 'zap_unwired' | 'tx'
export type DeployOutcome =
  | { ok: true; deployTx: `0x${string}`; quoteDeployedAtomic: bigint; pairedDeployedAtomic: bigint }
  | { ok: false; status: number; error: string; reason: Reason }

export async function deployGateway(opts: { supabase?: SupabaseClient; log?: Logger }): Promise<DeployOutcome> {
  const { log } = opts
  if (process.env.LP_GATEWAY_DEPLOY_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'gateway deploy is not enabled', reason: 'disabled' }
  }
  const cfg = gatewayConfig()
  if (!cfg || !cfg.staging) return { ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }

  const publicClient = gatewayPublicClient(cfg)
  const staged = (await publicClient.readContract({
    address: cfg.staging, abi: LP_STAGING_ABI, functionName: 'stagedAssets',
  })) as bigint

  const threshold = BigInt(process.env.LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC ?? '0')
  if (threshold === 0n || staged < threshold) {
    return { ok: false, status: 200, error: 'staged balance below deploy threshold', reason: 'below_threshold' }
  }

  let account
  try {
    account = await getOracleSigner('root')
  } catch (e) {
    log?.error('gateway.deploy', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'deploy_signer_unavailable', reason: 'signer' }
  }
  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(cfg.rpcUrl) })

  // Split the deployable amount: half stays quote, half zaps to the paired leg (balanced-range target).
  const quoteToDeploy = staged / 2n
  const zap = await swapQuoteToPaired({ cfg, account, wallet, publicClient, quoteAmount: staged - quoteToDeploy, log })
  if (zap.pairedOut <= 0n) {
    // Fail-closed: without the paired leg deploy() can't proceed. The seam is honest, not a bad swap.
    return { ok: false, status: 200, error: 'paired-leg zap not available', reason: 'zap_unwired' }
  }

  try {
    const deployTx = await wallet.writeContract({
      address: cfg.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deploy',
      args: [quoteToDeploy, zap.pairedOut, BigInt(Math.floor(Date.now() / 1000) + 600)],
      account, chain: publicClient.chain, gas: 1_200_000n,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx })
    if (receipt.status !== 'success') return { ok: false, status: 502, error: 'deploy_reverted', reason: 'tx' }
    return { ok: true, deployTx, quoteDeployedAtomic: quoteToDeploy, pairedDeployedAtomic: zap.pairedOut }
  } catch (e) {
    log?.error('gateway.deploy', 'deploy tx failed', { error: String(e) })
    return { ok: false, status: 502, error: 'deploy_failed', reason: 'tx' }
  }
}
