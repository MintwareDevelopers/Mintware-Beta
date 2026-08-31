// GET /api/vault/attribution-snapshot?vault_id=&wallet=
// Returns oracle-signed AttributionSnapshot for FeeVault epoch weighting.
//
// Auth: bearer-token (CRON_SECRET). This route makes the production oracle key
// sign an AttributionSnapshot, so it MUST NOT be publicly callable — an open
// endpoint is a free signing-oracle over the crown-jewel key (audit C3). The
// only callers are the server-side reward cron(s) that forward the bearer token
// (the weighted epoch-close rail); there is no client/wallet flow to preserve.

import { createHandler } from '@/lib/web2/routeHandler'
import { createWalletClient, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import {
  attributionMultiplierBps,
  durationMultiplierBps,
  combinedMultiplierBps,
  getAttributionPercentile,
} from '@/lib/rewards/vault/attributionSnapshot'

const CLAIM_EXPIRY_SECS = 90 * 24 * 60 * 60

const ATTESTATION_DOMAIN = { name: 'FeeVault', version: '1' } as const

const ATTESTATION_TYPES = {
  AttributionSnapshot: [
    { name: 'wallet',              type: 'address' },
    { name: 'liquidityPercentile', type: 'uint16'  },
    { name: 'sharingPercentile',   type: 'uint16'  },
    { name: 'epochNumber',         type: 'uint256' },
    { name: 'deadline',            type: 'uint256' },
  ],
} as const

export const GET = createHandler(async (req, ctx) => {
  const vault_id = req.nextUrl.searchParams.get('vault_id')
  const wallet   = req.nextUrl.searchParams.get('wallet')

  if (!vault_id || !wallet) return ctx.json({ error: 'Missing vault_id or wallet' }, 400)

  const walletAddr = wallet.toLowerCase() as `0x${string}`

  const { data: vault, error: vaultErr } = await ctx.supabase
    .from('social_vaults').select('id, chain_id').eq('id', vault_id).single()
  if (vaultErr || !vault) return ctx.json({ error: 'Vault not found' }, 404)

  let percentile = 0
  try {
    percentile = await getAttributionPercentile(walletAddr, { supabase: ctx.supabase })
  } catch { /* non-fatal */ }

  let durationBps = 10000
  try {
    const { data: deposit } = await ctx.supabase
      .from('lp_deposits').select('deposited_at')
      .eq('vault_id', vault_id).eq('wallet', walletAddr).eq('status', 'active')
      .order('deposited_at', { ascending: true }).limit(1).single()
    if (deposit) durationBps = durationMultiplierBps(deposit.deposited_at)
  } catch { /* non-fatal */ }

  const { data: epoch } = await ctx.supabase
    .from('vault_epochs').select('epoch_number, deadline, status')
    .eq('vault_id', vault_id).in('status', ['active', 'settling', 'published'])
    .order('epoch_number', { ascending: false }).limit(1).maybeSingle()

  const epochNumber = epoch?.epoch_number ?? 1
  const deadline = epoch?.deadline
    ? Math.floor(new Date(epoch.deadline).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + CLAIM_EXPIRY_SECS

  const attrBps = attributionMultiplierBps(percentile)
  const multBps = combinedMultiplierBps(attrBps, durationBps)

  // Weight role (audit C2) — separable from the root/merkle key via WEIGHT_ORACLE_PRIVATE_KEY.
  let account
  try {
    account = await getOracleSigner('weight')
  } catch (e) {
    ctx.log.error('attribution-snapshot', 'weight oracle key not configured', { error: String(e) })
    return ctx.json({ error: 'Oracle not configured' }, 500)
  }
  const chain   = vault.chain_id === 8453 ? base : baseSepolia

  let signature: `0x${string}`
  try {
    const client = createWalletClient({ account, chain, transport: http() })
    signature = await client.signTypedData({
      domain: { ...ATTESTATION_DOMAIN, chainId: chain.id },
      types: ATTESTATION_TYPES,
      primaryType: 'AttributionSnapshot',
      message: { wallet: walletAddr, liquidityPercentile: percentile, sharingPercentile: percentile, epochNumber: BigInt(epochNumber), deadline: BigInt(deadline) },
    })
  } catch (e) {
    ctx.log.error('attribution-snapshot', 'signing failed', { error: String(e) })
    return ctx.json({ error: 'Oracle signing failed' }, 500)
  }

  return ctx.json({
    vault_id, wallet: walletAddr, percentile,
    liquidity_percentile: percentile, sharing_percentile: percentile,
    attribution_multiplier_bps: attrBps, duration_multiplier_bps: durationBps,
    combined_multiplier_bps: multBps, combined_multiplier: (multBps / 10000).toFixed(4),
    epoch_number: epochNumber, deadline, oracle_signer: account.address, signature,
  })
}, { auth: 'bearer-token' })
