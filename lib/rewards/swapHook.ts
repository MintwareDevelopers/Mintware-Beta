// =============================================================================
// swapHook.ts — Real-time trading attribution
// Ticket 2: Campaign Engine
//
// Called on every swap execution on Mintware.
// Pure backend logic — no UI, no client-side code.
//
// Flow:
//   1. Idempotency check (tx_hash + wallet + 'trade' in activity)
//   2. Load campaign config from Supabase
//   3. Validate campaign is live and not expired
//   4. Load participant, validate eligibility (joined_at, min_score)
//   5. Daily dedup for 'trade' action (once per calendar day per wallet)
//   6. Look up referrer from referral_records
//   7. Branch: token_pool → pending_rewards | points → points credit
//   8. Write activity row(s)
//
// NOTE: Molten router callback mechanism is unresolved.
// This module is called by POST /api/campaigns/swap-event (stub endpoint).
// Wire to Molten's actual callback once the mechanism is confirmed.
// =============================================================================

import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards/calc'
import { getTokenPrice, usdToWei } from '@/lib/rewards/priceFeed'
import type {
  SwapEvent,
  AttributionResult,
  Campaign,
  Participant,
  RewardType,
  PendingRewardStatus,
  SkipReason,
} from '@/lib/rewards/types'
import { getActionPoints } from '@/lib/rewards/types'
import { computeMultipliers } from '@/lib/rewards/epochProcessor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns midnight UTC for a given ISO timestamp string */
function utcDayStart(iso: string): string {
  const d = new Date(iso)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Returns end-of-day UTC for a given ISO timestamp string */
function utcDayEnd(iso: string): string {
  const d = new Date(iso)
  d.setUTCHours(23, 59, 59, 999)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// verifySwapTx — on-chain tx verification (re-implementation of MintGuard item 4)
//
// Verifies:
//   1. Tx exists on-chain and status === success (0x1)
//   2. Tx was FROM the claimed wallet (wallet spoofing protection)
//   3. Treasury address appears in calldata (fee enforcement)
//
// Fail-open on RPC errors — RPC flakiness should never block a legitimate user.
// Called after campaign + participant validation, before pool deduction.
// ---------------------------------------------------------------------------

async function jsonRpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(5000),  // 5s hard timeout
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    return data.result ?? null
  } catch {
    return null  // network errors → fail-open
  }
}

function getSwapRpcUrl(chain: string | null): string | null {
  if (!chain) return null
  switch (chain.toLowerCase()) {
    case 'base':         return process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL     ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL          ?? 'https://bsc-dataseed.binance.org'
    default:             return null
  }
}

// Known LI.FI router addresses — any tx that isn't routed through one of these
// should not earn rewards. Lowercased for case-insensitive comparison.
const LIFI_ROUTERS: ReadonlySet<string> = new Set([
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LI.FI Diamond (EVM)
])

async function verifySwapTx(
  txHash: string,
  wallet: string,
  chain: string | null,
): Promise<{ ok: boolean; skip_reason?: SkipReason }> {
  const rpcUrl = getSwapRpcUrl(chain)
  if (!rpcUrl) return { ok: true }  // unknown chain — fail-open

  const treasuryRaw     = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase().replace('0x', '')
  // ABI-encoded address params are zero-padded to 32 bytes (64 hex chars).
  // Match both the raw 40-char form and the padded 64-char ABI form.
  const treasuryAddress    = treasuryRaw
  const treasuryAddressPad = treasuryRaw.padStart(64, '0')

  try {
    const [receipt, tx] = await Promise.all([
      jsonRpcCall<{ status: string; from: string }>(rpcUrl, 'eth_getTransactionReceipt', [txHash]),
      jsonRpcCall<{ to: string | null; input: string }>(rpcUrl, 'eth_getTransactionByHash', [txHash]),
    ])

    // Not found yet (pending tx) — fail-open
    if (!receipt || !tx) {
      console.warn(`[swapHook] verifySwapTx: tx ${txHash} not found on chain ${chain} — fail-open`)
      return { ok: true }
    }

    // 1. Tx must have succeeded
    if (receipt.status !== '0x1') {
      return { ok: false, skip_reason: 'tx_failed' }
    }

    // 2. Tx must be FROM the claimed wallet
    if (receipt.from?.toLowerCase() !== wallet.toLowerCase()) {
      return { ok: false, skip_reason: 'wallet_mismatch' }
    }

    // 2b. tx.to must be a known LI.FI router
    if (tx.to && !LIFI_ROUTERS.has(tx.to.toLowerCase())) {
      console.warn(
        `[swapHook] verifySwapTx: tx.to=${tx.to} is not a known LI.FI router for tx ${txHash} ` +
        `(chain=${chain}) — reward denied (router_mismatch)`
      )
      return { ok: false, skip_reason: 'router_mismatch' }
    }

    // 3. Treasury address must appear in calldata (fee enforcement)
    //    Only enforced when MINTWARE_TREASURY_ADDRESS is configured.
    if (treasuryAddress) {
      const input = (tx.input ?? '').toLowerCase()
      if (!input.includes(treasuryAddress) && !input.includes(treasuryAddressPad)) {
        console.warn(
          `[swapHook] verifySwapTx: treasury not in calldata for tx ${txHash} ` +
          `(chain=${chain}) — reward denied (fee_not_paid)`
        )
        return { ok: false, skip_reason: 'fee_not_paid' }
      }
    }

    return { ok: true }
  } catch (err) {
    // RPC error — fail-open, log warning
    console.warn(
      `[swapHook] verifySwapTx RPC error for tx ${txHash} (chain=${chain}) — fail-open:`,
      err instanceof Error ? err.message : err
    )
    return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// Token pool branch
//
// Computes buyer, referrer, and platform fee rewards in USD.
// Fees are deducted from the pool at the percentages set at campaign creation —
// they come out of the pool, not on top of it.
// Atomically deducts total from pool via deduct_token_pool_reward() RPC.
// Writes up to three rows to pending_rewards (buyer, referrer if exists, fee).
// Platform fee row goes to MINTWARE_TREASURY_ADDRESS, not the buyer wallet.
// amount_wei is 0 — resolved by price oracle / claim contract step (TBD).
// ---------------------------------------------------------------------------
async function processTokenPool(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  event: SwapEvent,
  campaign: Campaign,
  referrer: string | null
): Promise<AttributionResult> {
  // Treasury wallet for platform fee — set at campaign creation, taken from pool
  const treasuryWallet = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()
  if (!treasuryWallet) {
    console.warn('[swapHook] MINTWARE_TREASURY_ADDRESS not set — platform fee row will have empty wallet')
  }

  const buyer_reward_usd = calcBuyerReward(event.amount_usd, campaign.buyer_reward_pct ?? 0)
  const referral_reward_usd = referrer
    ? calcReferrerReward(event.amount_usd, campaign.referral_reward_pct ?? 0)
    : 0
  // Platform fee is ONLY taken on successful referrals — no referrer, no Mintware cut.
  // Fee comes out of the pool at the percentage set at campaign creation, not added on top.
  const platform_fee_usd = referrer
    ? (event.amount_usd * (campaign.platform_fee_pct ?? 0)) / 100
    : 0

  const total_deduction = buyer_reward_usd + referral_reward_usd + platform_fee_usd

  // ---------------------------------------------------------------------------
  // Daily wallet cap — cap on how much one wallet can earn per day from this campaign
  // Only checked when campaign.daily_wallet_cap_usd > 0.
  // Sums buyer reward_usd from pending_rewards created today for this wallet.
  // ---------------------------------------------------------------------------
  const walletCapUsd = Number(campaign.daily_wallet_cap_usd ?? 0)
  if (walletCapUsd > 0) {
    const dayStartW = utcDayStart(event.timestamp)
    const dayEndW   = utcDayEnd(event.timestamp)
    const { data: walletRows, error: walletCapErr } = await supabase
      .from('pending_rewards')
      .select('reward_usd')
      .eq('campaign_id', campaign.id)
      .eq('wallet', event.wallet)
      .eq('reward_type', 'buyer')
      .gte('created_at', dayStartW)
      .lte('created_at', dayEndW)
    if (walletCapErr) {
      console.error('[swapHook] daily_wallet_cap query error:', walletCapErr)
      return { credited: false, skip_reason: 'db_error' }
    }
    const walletTodayUsd = (walletRows ?? []).reduce((s, r) => s + Number(r.reward_usd), 0)
    if (walletTodayUsd + buyer_reward_usd > walletCapUsd) {
      return { credited: false, skip_reason: 'daily_wallet_cap_reached', campaign_type: 'token_pool' }
    }
  }

  // ---------------------------------------------------------------------------
  // Daily pool cap — cap on total rewards the campaign can pay out per day
  // Only checked when campaign.daily_pool_cap_usd > 0.
  // Sums all reward_usd from pending_rewards created today for this campaign.
  // ---------------------------------------------------------------------------
  const poolCapUsd = Number(campaign.daily_pool_cap_usd ?? 0)
  if (poolCapUsd > 0) {
    const dayStartP = utcDayStart(event.timestamp)
    const dayEndP   = utcDayEnd(event.timestamp)
    const { data: poolRows, error: poolCapErr } = await supabase
      .from('pending_rewards')
      .select('reward_usd')
      .eq('campaign_id', campaign.id)
      .gte('created_at', dayStartP)
      .lte('created_at', dayEndP)
    if (poolCapErr) {
      console.error('[swapHook] daily_pool_cap query error:', poolCapErr)
      return { credited: false, skip_reason: 'db_error' }
    }
    const poolTodayUsd = (poolRows ?? []).reduce((s, r) => s + Number(r.reward_usd), 0)
    if (poolTodayUsd + total_deduction > poolCapUsd) {
      return { credited: false, skip_reason: 'daily_pool_cap_reached', campaign_type: 'token_pool' }
    }
  }

  // Atomic pool check-and-decrement (Postgres row lock)
  const { data: deducted, error: deductErr } = await supabase.rpc(
    'deduct_token_pool_reward',
    { p_campaign_id: campaign.id, p_required_usd: total_deduction }
  )
  if (deductErr) {
    console.error('[swapHook] deduct_token_pool_reward error:', deductErr)
    return { credited: false, skip_reason: 'db_error' }
  }
  if (!deducted) {
    return { credited: false, skip_reason: 'pool_insufficient', campaign_type: 'token_pool' }
  }

  const claimable_at = new Date(
    Date.now() + (campaign.claim_duration_mins ?? 0) * 60_000
  ).toISOString()

  // Resolve token price now to lock amount_wei at the swap-time price.
  // If price fetch fails, fall back to '0' — claim resolution will handle it.
  // Non-blocking: a price failure doesn't cancel the reward credit.
  const decimals = campaign.token_decimals ?? 18
  let tokenPriceUsd = 0
  try {
    tokenPriceUsd = await getTokenPrice(campaign.token_symbol ?? '')
  } catch (priceErr) {
    console.warn(
      `[swapHook] price fetch failed for ${campaign.token_symbol} — amount_wei will be 0 for tx ${event.tx_hash}:`,
      priceErr instanceof Error ? priceErr.message : priceErr
    )
  }

  function resolveWei(rewardUsd: number): string {
    if (tokenPriceUsd <= 0 || rewardUsd <= 0) return '0'
    return usdToWei(rewardUsd, tokenPriceUsd, decimals).toString()
  }

  // Build pending_reward rows
  type RewardRow = {
    campaign_id: string; wallet: string; referrer: string | null
    reward_type: RewardType; token_contract: string; amount_wei: string
    reward_usd: number; purchase_amount_usd: number; tx_hash: string
    claimable_at: string; status: PendingRewardStatus
  }
  const rewardRows: RewardRow[] = [
    {
      campaign_id: campaign.id,
      wallet: event.wallet,
      referrer,
      reward_type: 'buyer' as const,
      token_contract: campaign.token_contract ?? '',
      amount_wei: resolveWei(buyer_reward_usd),  // price-locked at swap time
      reward_usd: buyer_reward_usd,
      purchase_amount_usd: event.amount_usd,
      tx_hash: event.tx_hash,
      claimable_at,
      status: 'locked' as const,
    },
  ]

  if (referrer && referral_reward_usd > 0) {
    rewardRows.push({
      campaign_id: campaign.id,
      wallet: referrer,
      referrer,
      reward_type: 'referrer' as const,
      token_contract: campaign.token_contract ?? '',
      amount_wei: resolveWei(referral_reward_usd),  // price-locked at swap time
      reward_usd: referral_reward_usd,
      purchase_amount_usd: event.amount_usd,
      tx_hash: event.tx_hash,
      claimable_at,
      status: 'locked' as const,
    })
    // Platform fee: only on successful referrals, goes to Mintware treasury
    if (platform_fee_usd > 0 && treasuryWallet) {
      rewardRows.push({
        campaign_id: campaign.id,
        wallet: treasuryWallet,
        referrer: null,
        reward_type: 'platform_fee' as const,
        token_contract: campaign.token_contract ?? '',
        amount_wei: resolveWei(platform_fee_usd),  // price-locked at swap time
        reward_usd: platform_fee_usd,
        purchase_amount_usd: event.amount_usd,
        tx_hash: event.tx_hash,
        claimable_at,
        status: 'locked' as const,
      })
    }
  }

  const { error: rewardErr } = await supabase
    .from('pending_rewards')
    .upsert(rewardRows, { onConflict: 'campaign_id,tx_hash,reward_type', ignoreDuplicates: true })

  if (rewardErr) {
    console.error('[swapHook] pending_rewards insert error:', rewardErr)
    return { credited: false, skip_reason: 'db_error' }
  }

  // Activity row for this wallet's trade
  await supabase.from('activity').insert({
    campaign_id:  campaign.id,
    wallet:       event.wallet,
    action_type:  'trade',
    points_earned: 0,             // token_pool rewards are in USD, not points
    tx_hash:      event.tx_hash,
    referred_by:  referrer,
    recorded_at:  event.timestamp,
  })

  return {
    credited: true,
    campaign_type: 'token_pool',
    buyer_reward_usd,
    referral_reward_usd,
    platform_fee_usd,
    referrer,
  }
}

// ---------------------------------------------------------------------------
// Points campaign branch
//
// Credits trade points to the swapping wallet and referral_trade points to
// the referrer (if one exists). Both must be active participants.
// Daily dedup is enforced upstream (only one 'trade' credit per calendar day).
// Updates epoch_state.total_points atomically.
// ---------------------------------------------------------------------------
async function processPoints(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  event: SwapEvent,
  campaign: Campaign,
  participant: Participant,
  referrer: string | null
): Promise<AttributionResult> {
  const actions = campaign.actions ?? {}
  const base_trade_points = getActionPoints(actions['trade'], 8)
  const base_referral_trade_points = getActionPoints(actions['referral_trade'], 8)

  // Apply score multipliers at point-credit time (design decision: multipliers live here,
  // not at epoch payout time). Only applied when campaign.use_score_multiplier === true.
  // Uses attribution_score as a proxy percentile (score/925 * 100) to avoid a live API call
  // on every swap event. Fails open at 1.0× if scoring data is unavailable.
  let multiplierCombined = 1.0
  if (campaign.use_score_multiplier) {
    const att_pct = Math.min(100, (participant.attribution_score / 925) * 100)
    const multipliers = computeMultipliers(att_pct, participant.sharing_score ?? 0)
    multiplierCombined = multipliers.combined
  }

  const trade_points          = Math.round(base_trade_points * multiplierCombined)
  const referral_trade_points = Math.round(base_referral_trade_points * multiplierCombined)

  // Credit trade points to the swapping wallet — atomic increment (no race condition)
  const { error: ptsErr } = await supabase.rpc('increment_participant_points', {
    p_campaign_id: campaign.id,
    p_wallet:      event.wallet,
    p_delta:       trade_points,
  })

  if (ptsErr) {
    console.error('[swapHook] participant points update error:', ptsErr)
    return { credited: false, skip_reason: 'db_error' }
  }

  // Activity row — swapper trade credit
  await supabase.from('activity').insert({
    campaign_id:   campaign.id,
    wallet:        event.wallet,
    action_type:   'trade',
    points_earned: trade_points,
    tx_hash:       event.tx_hash,
    referred_by:   referrer,
    recorded_at:   event.timestamp,
  })

  // Credit referral_trade points to referrer (if they are also a participant)
  let credited_referral_points = 0
  if (referrer) {
    const { data: referrerParticipant } = await supabase
      .from('participants')
      .select('id')
      .eq('campaign_id', campaign.id)
      .eq('wallet', referrer)
      .single()

    if (referrerParticipant) {
      // Atomic increment — no read-modify-write race condition
      const { error: refPtsErr } = await supabase.rpc('increment_participant_points', {
        p_campaign_id: campaign.id,
        p_wallet:      referrer,
        p_delta:       referral_trade_points,
      })
      if (refPtsErr) {
        console.error('[swapHook] referrer points increment error:', refPtsErr)
        // Non-fatal: activity row is still written below; referrer points will be out of sync.
        // This is logged for manual reconciliation — do not abort the swapper's credit.
      }

      // Activity row — referrer trade credit
      await supabase.from('activity').insert({
        campaign_id:   campaign.id,
        wallet:        referrer,
        action_type:   'referral_trade',
        points_earned: referral_trade_points,
        tx_hash:       event.tx_hash,
        referred_by:   referrer,
        recorded_at:   event.timestamp,
      })

      credited_referral_points = referral_trade_points
    }
  }

  // Increment epoch total_points — covers both swapper and referrer points
  const epoch_delta = trade_points + credited_referral_points
  await supabase.rpc('increment_epoch_points', {
    p_campaign_id: campaign.id,
    p_delta: epoch_delta,
  })

  return {
    credited: true,
    campaign_type: 'points',
    trade_points,
    referral_trade_points: credited_referral_points,
    referrer,
  }
}

// ---------------------------------------------------------------------------
// processSwapEvent — main entry point
// ---------------------------------------------------------------------------
export async function processSwapEvent(event: SwapEvent): Promise<AttributionResult> {
  const wallet = event.wallet.toLowerCase()
  const normalised: SwapEvent = { ...event, wallet }

  const supabase = createSupabaseServiceClient()

  // 1. Idempotency — has this wallet already been credited a 'trade' for this tx?
  const { data: existing } = await supabase
    .from('activity')
    .select('id')
    .eq('tx_hash', normalised.tx_hash)
    .eq('wallet', normalised.wallet)
    .eq('action_type', 'trade')
    .maybeSingle()

  if (existing) {
    return { credited: false, skip_reason: 'tx_already_credited' }
  }

  // 2. Load campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', normalised.campaign_id)
    .single()

  if (campaignErr || !campaign) {
    return { credited: false, skip_reason: 'campaign_not_found' }
  }

  // 3. Validate campaign is live
  if (campaign.status !== 'live') {
    return { credited: false, skip_reason: 'campaign_not_live' }
  }
  // Belt-and-suspenders: also check the closed flag.
  // closeCampaign() sets this directly; it may arrive before the status sync
  // from the on-chain event listener updates campaign.status → 'ended'.
  if ((campaign as Campaign & { closed?: boolean }).closed) {
    return { credited: false, skip_reason: 'campaign_not_live' }
  }
  if (campaign.end_date && new Date(campaign.end_date) < new Date(normalised.timestamp)) {
    return { credited: false, skip_reason: 'campaign_ended' }
  }

  // 3b. On-chain tx verification (MintGuard item 4)
  // Verifies: tx succeeded, from correct wallet, treasury in calldata.
  // Fail-open on RPC errors — never punish users for infra issues.
  const txVerify = await verifySwapTx(normalised.tx_hash, normalised.wallet, campaign.chain)
  if (!txVerify.ok) {
    return { credited: false, skip_reason: txVerify.skip_reason }
  }

  // 4. Load participant
  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('campaign_id', normalised.campaign_id)
    .eq('wallet', normalised.wallet)
    .maybeSingle()

  if (!participant) {
    return { credited: false, skip_reason: 'wallet_not_participant' }
  }

  // Actions before the wallet joined are never credited
  if (new Date(participant.joined_at) > new Date(normalised.timestamp)) {
    return { credited: false, skip_reason: 'action_before_join' }
  }

  // min_score check (Points campaigns only — token pool is open access)
  if (
    campaign.campaign_type === 'points' &&
    campaign.min_score > 0 &&
    participant.attribution_score < campaign.min_score
  ) {
    return { credited: false, skip_reason: 'score_below_minimum' }
  }

  // 5. Daily dedup for 'trade' (once per calendar day per wallet per campaign)
  const dayStart = utcDayStart(normalised.timestamp)
  const dayEnd = utcDayEnd(normalised.timestamp)

  const { data: todayCredit } = await supabase
    .from('activity')
    .select('id')
    .eq('campaign_id', normalised.campaign_id)
    .eq('wallet', normalised.wallet)
    .eq('action_type', 'trade')
    .gte('recorded_at', dayStart)
    .lte('recorded_at', dayEnd)
    .limit(1)
    .maybeSingle()

  if (todayCredit) {
    return { credited: false, skip_reason: 'already_traded_today' }
  }

  // 6. Look up referrer from universal referral graph
  const { data: referralRecord } = await supabase
    .from('referral_records')
    .select('referrer')
    .eq('referred', normalised.wallet)
    .eq('status', 'active')   // only confirmed referrals earn rewards
    .maybeSingle()

  const referrer = referralRecord?.referrer ?? null

  // 7. Branch on campaign type
  if (campaign.campaign_type === 'token_pool') {
    return processTokenPool(supabase, normalised, campaign as Campaign, referrer)
  } else if (campaign.campaign_type === 'points') {
    return processPoints(supabase, normalised, campaign as Campaign, participant, referrer)
  } else {
    console.error(
      `[swapHook] unknown campaign_type="${campaign.campaign_type}" for campaign ${campaign.id} — skipping`
    )
    return { credited: false, skip_reason: 'campaign_not_found' }
  }
}
