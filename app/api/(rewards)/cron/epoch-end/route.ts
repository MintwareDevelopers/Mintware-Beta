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

import { createHandler } from '@/lib/web2/routeHandler'
import type { RouteContext } from '@/lib/web2/routeHandler'
import { getServiceClient } from '@/lib/web2/supabase'
import { processEpoch } from '@/lib/rewards/epochProcessor'
import { runMerkleBuilder } from '@/lib/rewards/merkleBuilder'
import { advanceEpochState } from '@/lib/rewards/merkleBuilder'
import { publishDistribution } from '@/lib/web3/onchainPublisher'
import type { Campaign, Participant } from '@/lib/rewards/types'

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
  ctx: RouteContext,
  epoch: EpochStateRow
): Promise<{ epoch_number: number; result: object } | { epoch_number: number; error: string }> {
  const { supabase, log } = ctx
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
      const now = new Date().toISOString()
      // No participants — mark complete without distribution
      await supabase
        .from('epoch_state')
        .update({ status: 'complete', updated_at: now })
        .eq('id', epoch.id)

      const advance = await advanceEpochState(
        supabase,
        campaign as Campaign,
        {
          campaign_id,
          epoch_number,
          epoch_pool_usd: epoch.epoch_pool_usd,
          epoch_end: epoch.epoch_end,
        },
        now
      )

      return {
        epoch_number,
        result: { skipped: true, reason: 'no_participants', ...advance },
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
      const now = new Date().toISOString()
      await supabase
        .from('epoch_state')
        .update({ status: 'complete', updated_at: now })
        .eq('id', epoch.id)

      const advance = await advanceEpochState(
        supabase,
        campaign as Campaign,
        {
          campaign_id,
          epoch_number,
          epoch_pool_usd: epoch.epoch_pool_usd,
          epoch_end: epoch.epoch_end,
        },
        now
      )

      return {
        epoch_number,
        result: {
          skipped: true,
          reason: 'all_participants_zero_points',
          wallets_excluded: processorResult.wallets_excluded_zero_points,
          ...advance,
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
        epoch_end: epoch.epoch_end,
      },
      processorResult
    )

    // ── BEFORE this point: distribution row exists with status='pending',
    //    oracle_signature=null. The root is NOT yet signed. Wallets cannot claim.
    //
    // ── Step 6: Oracle signs the Merkle root (zero gas) ──────────────────────
    //
    // publishDistribution() signs { campaignId, epochNumber, merkleRoot } with
    // DISTRIBUTOR_PRIVATE_KEY using EIP-712. No transaction, no gas.
    //
    // Then writes back to Supabase:
    //   distributions.oracle_signature = EIP-712 sig
    //   distributions.status           = 'published'
    //   distributions.published_at     = now()
    //
    // Without oracle_signature, /api/claim returns 500. Users cannot claim until
    // the root is signed.
    //
    // Requires: campaigns.contract_address (for EIP-712 verifyingContract),
    //           campaigns.chain (for EIP-712 chainId)
    // Requires env: DISTRIBUTOR_PRIVATE_KEY (the oracle signing key)
    // ---------------------------------------------------------------------------

    const typedCampaign = campaign as Campaign

    if (typedCampaign.contract_address && typedCampaign.chain) {
      try {
        const publishResult = await publishDistribution({
          distribution_db_id: summary.distribution_id,
          campaign_id_str:    summary.campaign_id,
          epoch_number:       summary.epoch_number,
          merkle_root:        summary.merkle_root,
          contract_address:   typedCampaign.contract_address,
          chain:              typedCampaign.chain,
          // treasury_claim is not passed for points campaigns (no fee logic).
          // Token pool fee settlement (future) passes treasury proof + amount.
        })

        log.info('epoch-end', 'Root signed', {
          campaign_id, epoch_number,
          distribution_id: summary.distribution_id,
          sig: publishResult.oracle_signature.slice(0, 12) + '...',
          treasury_claim_tx: publishResult.treasury_claim_tx ?? null,
        })

        return {
          epoch_number,
          result: { ...summary, oracle_signature: publishResult.oracle_signature.slice(0, 12) + '...' },
        }
      } catch (publishErr) {
        // Non-fatal to epoch processing — Merkle data is safely in DB.
        // Distribution stays 'pending' until operator retries (cron auto-retries hourly).
        const msg = publishErr instanceof Error ? publishErr.message : String(publishErr)
        log.error('epoch-end', 'Oracle signing failed — distribution pending, will retry next run', {
          distribution_id: summary.distribution_id, error: msg,
        })
        return { epoch_number, result: { ...summary, sign_error: msg } }
      }
    } else {
      // Campaign not wired to a contract yet — common during initial setup.
      // Operator sets contract_address + chain in Supabase after running deploy.ts.
      log.warn('epoch-end', 'Campaign has no contract_address/chain — distribution pending', {
        campaign_id, distribution_id: summary.distribution_id,
      })
      return { epoch_number, result: summary }
    }
    // ── AFTER this point: distribution row has status='published', oracle_signature set.
    //    Wallets call /api/claim?address=&distribution_id= to get proof + oracle_signature,
    //    then call MintwareDistributor.claim(campaignId, epochNumber, merkleRoot,
    //                                        oracleSignature, amount, proof).

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('epoch-end', 'Epoch processing failed', { campaign_id, epoch_number, error: message })

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
// activateDueCampaigns — transitions 'upcoming' → 'live' for campaigns whose
// start_date has passed. Runs at the top of epoch-end so campaigns go live
// before epoch processing begins.
// ---------------------------------------------------------------------------

async function activateDueCampaigns(ctx: RouteContext): Promise<number> {
  const { supabase, log } = ctx
  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'live' })
    .eq('status', 'upcoming')
    .lte('start_date', new Date().toISOString())
    .select('id')

  if (error) {
    log.error('epoch-end', 'activateDueCampaigns failed', { error: error.message })
    return 0
  }

  const count = data?.length ?? 0
  if (count > 0) {
    log.info('epoch-end', 'Campaigns activated', { count, ids: data!.map((c: { id: string }) => c.id) })
  }
  return count
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export const GET = createHandler(async (_req, ctx) => {
  const { supabase, log } = ctx
  const startedAt = Date.now()
  const now = new Date().toISOString()
  log.info('epoch-end', 'Cron started')

  // Activate any 'upcoming' campaigns whose start_date has passed
  const activated = await activateDueCampaigns(ctx)

  // Detect stuck-settling epochs (> 2 hours)
  const stuckThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: stuckEpochs } = await supabase
    .from('epoch_state')
    .select('id, campaign_id, epoch_number, updated_at')
    .eq('status', 'settling')
    .lt('updated_at', stuckThreshold)

  if (stuckEpochs && stuckEpochs.length > 0) {
    for (const e of stuckEpochs) {
      log.warn('epoch-end', 'Stuck epoch detected — manual investigation required', {
        campaign_id: e.campaign_id, epoch_number: e.epoch_number, stuck_since: e.updated_at,
      })
    }
  }

  // Detect distributions stuck in 'pending' (oracle signing failed > 30 min ago)
  const pendingSignThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: unsignedDists } = await supabase
    .from('distributions')
    .select('id, campaign_id, epoch_number, created_at')
    .eq('status', 'pending')
    .lt('created_at', pendingSignThreshold)

  if (unsignedDists && unsignedDists.length > 0) {
    for (const d of unsignedDists) {
      log.error('epoch-end', 'Unsigned distribution — wallets cannot claim until resolved', {
        distribution_id: d.id, campaign_id: d.campaign_id,
        epoch_number: d.epoch_number, created_at: d.created_at,
      })
    }
  }

  // Find all epochs that have ended and are still 'active'
  const { data: expiredEpochs, error: queryErr } = await supabase
    .from('epoch_state')
    .select('*')
    .eq('status', 'active')
    .lt('epoch_end', now)

  if (queryErr) {
    log.error('epoch-end', 'Query failed', { error: queryErr.message })
    return ctx.json({ success: false, error: queryErr.message }, 500)
  }

  const epochs: EpochStateRow[] = expiredEpochs ?? []

  if (epochs.length === 0) {
    return ctx.json({ ok: true, epochs_processed: 0, message: 'no expired epochs found', duration_ms: Date.now() - startedAt })
  }

  log.info('epoch-end', `Found ${epochs.length} expired epoch(s)`)

  // Process sequentially — parallelism risks Attribution API rate limits and DB contention
  const results = []
  for (const epoch of epochs) {
    log.info('epoch-end', 'Processing epoch', { campaign_id: epoch.campaign_id, epoch_number: epoch.epoch_number })
    results.push(await processExpiredEpoch(ctx, epoch))
  }

  const succeeded  = results.filter((r) => !('error' in r))
  const failed     = results.filter((r) => 'error' in r)
  const duration_ms = Date.now() - startedAt

  log.info('epoch-end', 'Cron complete', { succeeded: succeeded.length, failed: failed.length, duration_ms })

  return ctx.json({
    ok: failed.length === 0 && (unsignedDists?.length ?? 0) === 0,
    campaigns_activated:     activated,
    epochs_found:            epochs.length,
    epochs_succeeded:        succeeded.length,
    epochs_failed:           failed.length,
    unsigned_distributions:  unsignedDists?.length ?? 0,
    results,
    duration_ms,
  })
}, { auth: 'bearer-token' })
