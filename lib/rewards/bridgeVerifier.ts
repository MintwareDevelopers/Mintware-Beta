// =============================================================================
// bridgeVerifier.ts — Daily bridge activity verification
// Ticket 3: Campaign Engine
//
// Runs once daily at 00:00 UTC via Vercel Cron.
// Points campaigns only — bridge is a one-time action per wallet per campaign.
//
// Strategy:
//   1. Load all live points campaigns with bridge action enabled
//   2. Load all participants who have NOT yet received a bridge credit
//   3. Fetch their referrers from referral_records
//   4. One eth_getLogs batch call per chain covers all wallets simultaneously
//   5. Match returned logs to participants, verify timestamp > joined_at
//   6. Dedup against activity table (tx_hash + wallet + 'bridge')
//   7. Credit bridge_points to participant, referral_bridge_points to referrer
//   8. Write to activity (two rows per credited wallet if referrer exists)
//   9. Update participants.total_points
//
// Scope: Points campaigns only.
//        Token pool campaigns have no bridge action (per campaign logic model).
//        Epoch end / Merkle tree logic is Ticket 4.
// =============================================================================

import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { fetchBridgeTransfers } from '@/lib/web3/chainRpc'
import type { Campaign, Participant } from '@/lib/rewards/types'
import { getActionPoints } from '@/lib/rewards/types'

// Bridge verification is Core DAO only in this ticket.
// Extend SUPPORTED_CHAINS as Mintware adds more chains.
const SUPPORTED_CHAINS = ['core_dao'] as const
type SupportedChain = typeof SUPPORTED_CHAINS[number]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParticipantWithReferrer extends Participant {
  referrer: string | null   // from referral_records.referrer
}

export interface BridgeCreditResult {
  campaign_id: string
  wallet: string
  tx_hash: string
  bridge_points: number
  referrer: string | null
  referral_bridge_points: number
}

export interface VerifierSummary {
  campaigns_checked: number
  wallets_checked: number
  credits_issued: number
  referral_credits_issued: number
  skipped_already_credited: number
  skipped_timestamp: number   // tx was before joined_at
  errors: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Set of wallet addresses already credited for 'bridge' in this campaign */
async function loadCreditedWallets(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  campaignId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('activity')
    .select('wallet')
    .eq('campaign_id', campaignId)
    .eq('action', 'bridge')

  if (error) {
    console.error('[bridgeVerifier] loadCreditedWallets error:', error)
    return new Set()
  }
  return new Set((data ?? []).map((r: { wallet: string }) => r.wallet.toLowerCase()))
}

/** Fetch referrers for a list of wallets in one query */
async function loadReferrers(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  wallets: string[]
): Promise<Map<string, string>> {
  if (wallets.length === 0) return new Map()

  const { data, error } = await supabase
    .from('referral_records')
    .select('referred, referrer')
    .in('referred', wallets)

  if (error) {
    console.error('[bridgeVerifier] loadReferrers error:', error)
    return new Map()
  }

  const map = new Map<string, string>()
  for (const row of data ?? []) {
    map.set(row.referred.toLowerCase(), row.referrer.toLowerCase())
  }
  return map
}

// ---------------------------------------------------------------------------
// verifyCampaign — processes one Points campaign
//
// Returns the credits issued for this campaign.
// ---------------------------------------------------------------------------

async function verifyCampaign(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  campaign: Campaign,
  chain: SupportedChain,
  summary: VerifierSummary
): Promise<BridgeCreditResult[]> {
  const bridge_points = getActionPoints(campaign.actions?.bridge, 15)             // spec default: 15 pts
  const referral_bridge_points = getActionPoints(campaign.actions?.referral_bridge, 60)  // spec default: 60 pts
  const credits: BridgeCreditResult[] = []

  // 1. Load participants for this campaign
  const { data: participants, error: pErr } = await supabase
    .from('participants')
    .select('*')
    .eq('campaign_id', campaign.id)

  if (pErr || !participants?.length) {
    if (pErr) summary.errors.push(`[${campaign.id}] load participants: ${pErr.message}`)
    return credits
  }

  // 2. Filter out already-credited wallets (bridge is one_time per campaign)
  const creditedWallets = await loadCreditedWallets(supabase, campaign.id)
  const uncredited = participants.filter(
    (p: Participant) => !creditedWallets.has(p.wallet.toLowerCase())
  )

  if (uncredited.length === 0) return credits

  summary.wallets_checked += uncredited.length

  // 3. Load referrers for uncredited participants in one query
  const walletList = uncredited.map((p: Participant) => p.wallet.toLowerCase())
  const referrerMap = await loadReferrers(supabase, walletList)

  // 4. Determine search window — earliest joined_at across uncredited participants
  const minJoinedAt = uncredited.reduce((earliest: string, p: Participant) =>
    p.joined_at < earliest ? p.joined_at : earliest,
    uncredited[0].joined_at
  )

  // 5. Single eth_getLogs batch call — covers all uncredited wallets
  let bridgeTxs
  try {
    bridgeTxs = await fetchBridgeTransfers(chain, walletList, minJoinedAt)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    summary.errors.push(`[${campaign.id}] fetchBridgeTransfers: ${msg}`)
    return credits
  }

  if (bridgeTxs.length === 0) return credits

  // Build participant lookup by wallet
  const participantMap = new Map<string, Participant>()
  for (const p of uncredited) {
    participantMap.set(p.wallet.toLowerCase(), p)
  }

  // Build activity rows
  const activityRows: object[] = []
  const now = new Date().toISOString()

  // Track wallets already processed in this batch (one bridge credit per wallet per campaign)
  const processedThisBatch = new Set<string>()

  for (const tx of bridgeTxs) {
    const wallet = tx.wallet.toLowerCase()

    // Skip if already processed in this batch
    if (processedThisBatch.has(wallet)) continue

    const participant = participantMap.get(wallet)
    if (!participant) continue

    // 6. Verify tx timestamp > participant.joined_at
    const joinedAtSecs = Math.floor(new Date(participant.joined_at).getTime() / 1000)
    if (tx.timestamp_secs === 0) {
      // Block timestamp resolution failed — skip rather than credit with bad data
      summary.errors.push(`[${campaign.id}] block timestamp not resolved for tx ${tx.tx_hash}`)
      continue
    }
    if (tx.timestamp_secs <= joinedAtSecs) {
      summary.skipped_timestamp++
      continue
    }

    processedThisBatch.add(wallet)
    const referrer = referrerMap.get(wallet) ?? null

    // Activity row for the participant (bridge credit)
    activityRows.push({
      campaign_id: campaign.id,
      wallet,
      action: 'bridge',
      points: bridge_points,
      reward_usd: null,
      tx_hash: tx.tx_hash,
      referrer,
      credited_at: now,
    })

    // Referral bridge credit — only if referrer is also a participant in this campaign
    if (referrer) {
      const referrerParticipant = participantMap.get(referrer)
      if (referrerParticipant) {
        // Check referrer not already getting a referral_bridge credit for this tx
        const refTxKey = `ref:${tx.tx_hash}:${referrer}`
        if (!processedThisBatch.has(refTxKey)) {
          processedThisBatch.add(refTxKey)

          activityRows.push({
            campaign_id: campaign.id,
            wallet: referrer,
            action: 'referral_bridge',
            points: referral_bridge_points,
            reward_usd: null,
            tx_hash: tx.tx_hash,
            referrer,
            credited_at: now,
          })

          credits.push({
            campaign_id: campaign.id,
            wallet,
            tx_hash: tx.tx_hash,
            bridge_points,
            referrer,
            referral_bridge_points,
          })
          summary.referral_credits_issued++
        }
      } else {
        // Referrer exists in referral graph but not a participant — credit bridge only
        credits.push({
          campaign_id: campaign.id,
          wallet,
          tx_hash: tx.tx_hash,
          bridge_points,
          referrer,
          referral_bridge_points: 0,
        })
      }
    } else {
      credits.push({
        campaign_id: campaign.id,
        wallet,
        tx_hash: tx.tx_hash,
        bridge_points,
        referrer: null,
        referral_bridge_points: 0,
      })
    }

    summary.credits_issued++
  }

  // 7. Write activity rows (ignoreDuplicates = safe retry if cron fires twice)
  if (activityRows.length > 0) {
    const { error: actErr } = await supabase
      .from('activity')
      .upsert(activityRows, { onConflict: 'tx_hash,wallet,action', ignoreDuplicates: true })

    if (actErr) {
      summary.errors.push(`[${campaign.id}] activity upsert: ${actErr.message}`)
    }
  }

  // 8. Atomically increment participant total_points (no race condition)
  const walletsToIncrement = new Map<string, number>() // wallet → total delta
  for (const row of activityRows as Array<{ wallet: string; points: number | null }>) {
    if (row.points && row.points > 0) {
      walletsToIncrement.set(row.wallet, (walletsToIncrement.get(row.wallet) ?? 0) + row.points)
    }
  }
  for (const [w, delta] of walletsToIncrement) {
    const { error: ptErr } = await supabase.rpc('increment_participant_points', {
      p_campaign_id: campaign.id,
      p_wallet:      w,
      p_delta:       delta,
    })
    if (ptErr) {
      summary.errors.push(`[${campaign.id}] increment_participant_points ${w}: ${ptErr.message}`)
    }
  }

  // 9. Increment epoch total_points atomically
  const totalPointsDelta = activityRows.reduce((sum: number, row: any) => {
    return sum + (typeof row.points === 'number' ? row.points : 0)
  }, 0)

  if (totalPointsDelta > 0) {
    await supabase.rpc('increment_epoch_points', {
      p_campaign_id: campaign.id,
      p_delta: totalPointsDelta,
    })
  }

  return credits
}

// ---------------------------------------------------------------------------
// runBridgeVerifier — main entry point called by the cron route
// ---------------------------------------------------------------------------

export async function runBridgeVerifier(): Promise<VerifierSummary> {
  const summary: VerifierSummary = {
    campaigns_checked: 0,
    wallets_checked: 0,
    credits_issued: 0,
    referral_credits_issued: 0,
    skipped_already_credited: 0,
    skipped_timestamp: 0,
    errors: [],
  }

  const supabase = createSupabaseServiceClient()

  // Load all live Points campaigns that have the bridge action configured
  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('campaign_type', 'points')
    .eq('status', 'live')

  if (cErr) {
    summary.errors.push(`load campaigns: ${cErr.message}`)
    return summary
  }

  // Filter to campaigns that have a bridge action defined
  const bridgeCampaigns = (campaigns ?? []).filter(
    (c: Campaign) => c.actions && 'bridge' in c.actions
  )

  summary.campaigns_checked = bridgeCampaigns.length

  if (bridgeCampaigns.length === 0) return summary

  // Process each campaign — currently all on Core DAO
  // When multi-chain support is added, derive chain from campaign config
  for (const campaign of bridgeCampaigns) {
    try {
      await verifyCampaign(supabase, campaign as Campaign, 'core_dao', summary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.errors.push(`[${campaign.id}] unhandled: ${msg}`)
    }
  }

  return summary
}
