// =============================================================================
// GET /api/cron/epoch-end
//
// Epoch end processing cron. Runs every hour at :00.
// Catches any epoch whose end_date has passed within the last hour.
//
// vercel.json schedule: "0 * * * *"
//
// Authorization: Bearer <CRON_SECRET> (same secret as bridge-verify)
//
// Per-epoch flow:
//   1. Mark epoch_state.status = 'settling' (prevents double-processing)
//   2. Load all participants for the campaign
//   3. Call processEpoch() → distribution list with USD payouts
//   4. Call runMerkleBuilder() → builds tree, writes distributions + daily_payouts
//   5. epoch_state advances to 'complete', next epoch created (or campaign ended)
//
// On error:
//   - Revert epoch_state to 'active' for hourly retry
//   - After 3 consecutive failures (checked via error count on epoch), mark 'error'
//     and alert (future: webhook/Slack notification)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { processEpoch } from '@/lib/campaigns/epochProcessor'
import { runMerkleBuilder } from '@/lib/campaigns/merkleBuilder'
import { publishDistribution } from '@/lib/campaigns/onchainPublisher'
import type { Campaign, Participant } from '@/lib/campaigns/types'

export const maxDuration = 300   // 5 min — Vercel Pro cron max

// ---------------------------------------------------------------------------
// Epoch row from Supabase (superset of EpochState used in epochProcessor)
// ---------------------------------------------------------------------------
interface EpochStateRow {
  id: string
  campaign_id: string
  epoch_number: number
  epoch_start: string
  epoch_end: string
  epoch_pool_usd: number
  total_points: number
  status: string
}

// ---------------------------------------------------------------------------
// processExpiredEpoch — processes a single expired epoch end-to-end
// ---------------------------------------------------------------------------

async function processExpiredEpoch(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  epoch: EpochStateRow
): Promise<{ epoch_number: number; result: object } | { epoch_number: number; error: string }> {
  const { campaign_id, epoch_number } = epoch

  // 1. Atomically claim this epoch for processing: active → settling
  // If another cron instance already claimed it, this update matches 0 rows.
  const { data: claimed, error: claimErr } = await supabase
    .from('epoch_state')
    .update({ status: 'settling', updated_at: new Date().toISOString() })
    .eq('id', epoch.id)
    .eq('status', 'active')  // ← only update if still 'active' — prevents double-processing
    .select('id')
    .maybeSingle()

  if (claimErr) {
    return { epoch_number, error: `claim failed: ${claimErr.message}` }
  }
  if (!claimed) {
    // Another instance already claimed it — skip
    return { epoch_number, error: 'already claimed by another instance' }
  }

  try {
    // 2. Load campaign config
    const { data: campaign, error: cErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single()

    if (cErr || !campaign) {
      throw new Error(`campaign not found: ${cErr?.message}`)
    }

    // 3. Load all participants for this campaign
    const { data: participants, error: pErr } = await supabase
      .from('participants')
      .select('*')
      .eq('campaign_id', campaign_id)

    if (pErr) {
      throw new Error(`participants load failed: ${pErr.message}`)
    }

    const participantList: Participant[] = participants ?? []

    if (participantList.length === 0) {
      // No participants — mark complete without distribution
      await supabase
        .from('epoch_state')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', epoch.id)

      return {
        epoch_number,
        result: { skipped: true, reason: 'no_participants' },
      }
    }

    // 4. Compute distribution via epoch processor
    const processorResult = await processEpoch(
      campaign as Campaign,
      {
        id: epoch.id,
        campaign_id,
        epoch_number,
        epoch_pool_usd: epoch.epoch_pool_usd,
        total_points: epoch.total_points,
      },
      participantList
    )

    // Edge: all participants had 0 points — nothing to distribute
    if (processorResult.entries.length === 0) {
      await supabase
        .from('epoch_state')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', epoch.id)

      return {
        epoch_number,
        result: {
          skipped: true,
          reason: 'all_participants_zero_points',
          wallets_excluded: processorResult.wallets_excluded_zero_points,
        },
      }
    }

    // 5. Build Merkle tree and commit to DB
    // Writes distributions row (status='pending') + daily_payouts rows
    const summary = await runMerkleBuilder(
      campaign as Campaign,
      {
        id: epoch.id,
        campaign_id,
        epoch_number,
        epoch_pool_usd: epoch.epoch_pool_usd,
      },
      processorResult
    )

    // ── BEFORE this point: distribution row exists with status='pending',
    //    onchain_id=null. The Merkle root is NOT on-chain. Wallets cannot claim.
    //
    // ── Step 6: Publish Merkle root on-chain ─────────────────────────────────
    //
    // Calls MintwareDistributor.createDistribution(root, token, totalAmount):
    //   • Pulls tokens from DISTRIBUTOR_PRIVATE_KEY wallet into contract
    //   • Emits DistributionCreated(uint256 distributionId, ...)
    //
    // Then writes back to Supabase:
    //   distributions.onchain_id  = distributionId (uint256 from event)
    //   distributions.status      = 'published'
    //   distributions.tx_hash     = transaction hash
    //   distributions.published_at = now()
    //
    // Without onchain_id, the claim API returns null and claim() reverts on-chain.
    //
    // Requires: campaigns.contract_address, campaigns.chain, campaigns.token_contract
    // Requires env: DISTRIBUTOR_PRIVATE_KEY (wallet must hold reward tokens)
    // ---------------------------------------------------------------------------

    const typedCampaign = campaign as Campaign

    if (
      typedCampaign.contract_address &&
      typedCampaign.chain &&
      typedCampaign.token_contract
    ) {
      try {
        const publishResult = await publishDistribution({
          distribution_db_id: summary.distribution_id,
          merkle_root:        summary.merkle_root,
          token_address:      typedCampaign.token_contract,
          total_amount_wei:   summary.total_amount_wei,
          contract_address:   typedCampaign.contract_address,
          chain:              typedCampaign.chain,
        })

        console.log(
          `[epoch-end] ✓ on-chain publish: campaign=${campaign_id} ` +
          `epoch=${epoch_number} distribution=${summary.distribution_id} ` +
          `onchain_id=${publishResult.onchain_id} tx=${publishResult.tx_hash}`
        )

        return {
          epoch_number,
          result: { ...summary, onchain_id: publishResult.onchain_id, tx_hash: publishResult.tx_hash },
        }
      } catch (publishErr) {
        // Non-fatal to epoch processing — Merkle data is safely in DB.
        // The distribution stays 'pending' until the operator re-publishes manually
        // (e.g. runs the deploy script with --distribution-id flag, or retries via admin endpoint).
        const msg = publishErr instanceof Error ? publishErr.message : String(publishErr)
        console.error(
          `[epoch-end] ⚠ on-chain publish failed for distribution ${summary.distribution_id}: ${msg}. ` +
          `Distribution is in DB (status='pending') and can be published manually via scripts/deploy.ts.`
        )
        // Return success for the epoch — the Merkle data is committed.
        // Operator must monitor for 'pending' distributions older than expected.
        return { epoch_number, result: { ...summary, publish_error: msg } }
      }
    } else {
      // Campaign not wired to a contract yet — common during initial setup.
      // Operator sets contract_address + chain in Supabase after running deploy.ts.
      console.warn(
        `[epoch-end] campaign ${campaign_id} has no contract_address/chain/token_contract — ` +
        `distribution ${summary.distribution_id} written as status='pending'. ` +
        `Set campaigns.contract_address and campaigns.chain in Supabase to enable auto-publish.`
      )
      return { epoch_number, result: summary }
    }
    // ── AFTER this point: distribution row has status='published', onchain_id set.
    //    Wallets can call /api/claim?address=&distribution_id= to get their proof
    //    and then call MintwareDistributor.claim(onchain_id, amount, proof).

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[epoch-end] epoch ${campaign_id}#${epoch_number} failed:`, message)

    // Revert to 'active' so the next hourly run retries
    await supabase
      .from('epoch_state')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', epoch.id)
      .eq('status', 'settling')  // only revert if still 'settling'

    return { epoch_number, error: message }
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Auth
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — refusing to run in production without auth' },
      { status: 500 }
    )
  }

  const startedAt = Date.now()
  const now = new Date().toISOString()
  console.log('[epoch-end] cron started at', now)

  const supabase = createSupabaseServiceClient()

  // Find all epochs that have ended and are still 'active'
  // 'settling' epochs may be retries from a previous failed run — skip them here
  // (they'll be caught next hour if they're stuck — manual intervention for persistent failures)
  const { data: expiredEpochs, error: queryErr } = await supabase
    .from('epoch_state')
    .select('*')
    .eq('status', 'active')
    .lt('epoch_end', now)   // epoch_end < NOW()

  if (queryErr) {
    console.error('[epoch-end] query failed:', queryErr.message)
    return NextResponse.json({ ok: false, error: queryErr.message }, { status: 500 })
  }

  const epochs: EpochStateRow[] = expiredEpochs ?? []

  if (epochs.length === 0) {
    return NextResponse.json({
      ok: true,
      epochs_processed: 0,
      message: 'no expired epochs found',
      duration_ms: Date.now() - startedAt,
    })
  }

  console.log(`[epoch-end] found ${epochs.length} expired epoch(s)`)

  // Process each expired epoch sequentially
  // Sequential rather than parallel: epoch processing makes multiple DB writes
  // and hits the Attribution API — parallelism risks rate limits and DB contention
  const results = []
  for (const epoch of epochs) {
    console.log(`[epoch-end] processing campaign ${epoch.campaign_id} epoch #${epoch.epoch_number}`)
    const result = await processExpiredEpoch(supabase, epoch)
    results.push(result)
  }

  const succeeded = results.filter((r) => !('error' in r))
  const failed = results.filter((r) => 'error' in r)

  const durationMs = Date.now() - startedAt
  console.log(`[epoch-end] complete: ${succeeded.length} ok, ${failed.length} failed, ${durationMs}ms`)

  return NextResponse.json({
    ok: failed.length === 0,
    epochs_found: epochs.length,
    epochs_succeeded: succeeded.length,
    epochs_failed: failed.length,
    results,
    duration_ms: durationMs,
  })
}

export async function POST() {
  return NextResponse.json({ error: 'method not allowed — use GET' }, { status: 405 })
}
