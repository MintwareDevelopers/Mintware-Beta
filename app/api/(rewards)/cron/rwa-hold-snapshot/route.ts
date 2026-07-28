// =============================================================================
// GET /api/cron/rwa-hold-snapshot
//
// RWA Incentive Layer · R4 (hold-snapshot credit) + R5 (duration-match bonus).
// Runs weekly (Monday 00:00 UTC) — vercel.json: "0 0 * * 1". Bearer <CRON_SECRET>.
//
// For each LIVE, hold-configured RWA campaign:
//   1. Resolve linked deal → social_vault → on-chain vRWA share token.
//   2. Read balanceOf(wallet) for every participant (permissionless — plain ERC-20).
//   3. Credit hold points = rate × balance × 7d × attribution × duration-match,
//      via the pure engine in lib/rewards/holdSnapshot.ts.
//
// Weekly cadence → durationDays = 7 (crediting the week of holding). Idempotent:
// the snapshot's synthetic tx_hash collides on re-run, so a second pass never
// double-credits. Permissionless by construction — NO eligibility check (§3.0).
//
// Honest degradation: a campaign whose vault has no on-chain token yet is skipped
// with reason 'no_vault_token' (the math + credit path are proven; they light up
// the moment a real vRWA/USDC vault is deployed). Lock durations are not yet read
// on-chain, so the R5 duration-match bonus stays inert (lockDays = 0) until a lock
// source is wired — flagged per campaign in the response.
// =============================================================================

import { createPublicClient, http, parseAbi, getAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { processHoldSnapshot, type HoldInput } from '@/lib/rewards/holdSnapshot'
import type { Campaign } from '@/lib/rewards/types'

export const maxDuration = 300  // 5 min

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

function rpcUrlForChain(chainId: number): string {
  switch (chainId) {
    case 84532: return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 8453:
    default:    return process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
  }
}

/** UTC YYYY-MM-DD — the snapshot's idempotency date. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CampaignResult {
  campaign_id: string
  name?: string
  skipped?: string
  credited?: number
  wallets?: number
  total_points?: number
  duration_match_active?: boolean
}

export const GET = createHandler(async (_req, ctx) => {
  const startedAt = Date.now()
  const { supabase, log } = ctx
  const snapshotDate = todayUtc()

  log.info('rwa-hold-snapshot', 'Cron started', { snapshotDate })

  // Live RWA campaigns only. Hold credit is opt-in: campaigns without an
  // `actions.hold` config are volume/referral campaigns and are left alone.
  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('surface', 'rwa')
    .eq('status', 'live')

  if (cErr) {
    log.error('rwa-hold-snapshot', 'Campaign query failed', { error: cErr.message })
    return ctx.json({ success: false, error: cErr.message }, 500)
  }

  const results: CampaignResult[] = []

  for (const raw of campaigns ?? []) {
    const campaign = raw as Campaign
    const name = campaign.name

    if (!campaign.actions || campaign.actions['hold'] == null) {
      results.push({ campaign_id: campaign.id, name, skipped: 'hold_not_configured' })
      continue
    }
    if (!campaign.linked_deal_id) {
      results.push({ campaign_id: campaign.id, name, skipped: 'no_linked_deal' })
      continue
    }

    // linked deal → vault (on-chain share token + chain)
    const { data: deal } = await supabase
      .from('vault_deals')
      .select('vault_id, social_vaults(contract_address, chain_id, status)')
      .eq('id', campaign.linked_deal_id)
      .maybeSingle()

    const vault = deal?.social_vaults as { contract_address?: string; chain_id?: number; status?: string } | null
    const tokenAddr = vault?.contract_address
    if (!tokenAddr || !tokenAddr.startsWith('0x')) {
      results.push({ campaign_id: campaign.id, name, skipped: 'no_vault_token' })
      continue
    }

    // participants → wallets + their attribution/sharing (no live API call needed)
    const { data: participants } = await supabase
      .from('participants')
      .select('wallet, attribution_score, sharing_score')
      .eq('campaign_id', campaign.id)

    const holders = participants ?? []
    if (holders.length === 0) {
      results.push({ campaign_id: campaign.id, name, skipped: 'no_participants' })
      continue
    }

    try {
      const client = createPublicClient({ transport: http(rpcUrlForChain(vault?.chain_id ?? 8453)) })
      const token = getAddress(tokenAddr)

      const decimals = await client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' })
        .catch(() => 18) as number
      const scale = 10 ** Number(decimals)

      const balances = await Promise.all(holders.map(async (p: Record<string, unknown>) => {
        const wallet = String(p.wallet)
        let balance = 0
        try {
          const raw = await client.readContract({
            address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(wallet)],
          }) as bigint
          balance = Number(raw) / scale
        } catch {
          balance = 0  // unreadable balance → no credit this snapshot
        }
        return {
          wallet,
          balance,
          attribution_score: Number(p.attribution_score ?? 0),
          sharing_score: Number(p.sharing_score ?? 0),
          lockDays: 0,  // R5: on-chain lock source not yet wired — bonus stays inert
        } as HoldInput
      }))

      // Epoch number from the active epoch_state. If there is NO active epoch,
      // increment_epoch_points would no-op (it targets status='active'), desyncing
      // participant points from the epoch total — so skip crediting entirely.
      const { data: epochRow } = await supabase
        .from('epoch_state')
        .select('epoch_number')
        .eq('campaign_id', campaign.id)
        .eq('status', 'active')
        .maybeSingle()
      if (!epochRow) {
        results.push({ campaign_id: campaign.id, name, skipped: 'no_active_epoch' })
        continue
      }
      const epochNumber = Number(epochRow.epoch_number)

      const res = await processHoldSnapshot(supabase, campaign, epochNumber, snapshotDate, balances)

      log.info('rwa-hold-snapshot', 'Snapshot credited', {
        campaign_id: campaign.id, credited: res.credited, total_points: res.totalPoints,
      })
      results.push({
        campaign_id: campaign.id, name,
        credited: res.credited, wallets: holders.length, total_points: res.totalPoints,
        duration_match_active: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('rwa-hold-snapshot', 'Snapshot failed', { campaign_id: campaign.id, error: message })
      results.push({ campaign_id: campaign.id, name, skipped: `error: ${message}` })
    }
  }

  const credited = results.filter((r) => (r.credited ?? 0) > 0).length
  return ctx.json({
    ok: true,
    snapshot_date: snapshotDate,
    campaigns_found: (campaigns ?? []).length,
    campaigns_credited: credited,
    results,
    duration_ms: Date.now() - startedAt,
  })
}, { auth: 'bearer-token' })
