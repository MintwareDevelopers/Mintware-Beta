// Shared card spend-buffer REFILL core — redeems a slice of the member's own single-asset Earn shares into their
// registered buffer wallet by submitting MintwarePaymentGateway.refill via the oracle/Privy
// signer in the RELAYER_ROLE seat (getOracleSigner('root')). Extracted so the Bridge transaction
// webhook and the steady-state cron run identical refill accounting. No auth here — the CALLER gates. Spec: docs/developers/
// card-spend-buffer-spec.md (Option A, §5).
//
// DARK-LAUNCHED: fail-closed and OFF by default. `refillCardBuffer` no-ops unless
// CARD_BUFFER_REFILL_ENABLED === 'true', the card has auto_refill_enabled, an accepted destination, a registered
// buffer, and the oracle signer + gateway resolve. It moves real on-chain funds only once all of that
// is true — every gate below returns before the write otherwise.

import { createPublicClient, createWalletClient, http, keccak256, toBytes, isHex } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { explorerTxUrl } from '@/lib/web3/explorer'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'
import { PAYMENT_GATEWAY_ABI } from '@/lib/web3/artifacts/mintwarePaymentGateway'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { bufferTargetAtomic, type BufferSizingParams } from '@/lib/cards/bufferSizing'
import { refillPlan } from '@/lib/cards/bufferPolicy'
import { readCardFundingGateway } from '@/lib/org/cardFundingReader'

type Reason =
  | 'disabled' | 'not_found' | 'not_enabled' | 'no_buffer' | 'at_target' | 'rate_capped' | 'breaker' | 'in_flight' | 'paused'
  | 'not_activated' | 'permit_expired' | 'permit_malformed' | 'config' | 'chain' | 'read' | 'signer' | 'tx'

export type RefillOutcome =
  | { ok: true; txHash?: `0x${string}`; explorerUrl?: string; refilledAtomic: bigint; breakerTripped: boolean }
  | { ok: false; status: number; error: string; reason: Reason; detail?: string }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

const nowSecs = () => Math.floor(Date.now() / 1000)
const big = (v: unknown) => BigInt(String(v ?? '0'))

/** Top one card's spend buffer back toward its computed target, bounded by the refill-rate breaker.
 *  The attempt's bytes32 refillId is derived before the DB claim, which atomically opens its durable
 *  card_buffer_refills row. The Gateway's refillDone[refillId] guard makes a duplicate submit a no-op.
 *
 *  `trigger` is recorded on the ledger row: 'reactive' (provider webhook) | 'cron' | 'manual'. */
export async function refillCardBuffer(opts: {
  supabase: SupabaseClient
  orgId: string
  orgCardId: string
  trigger?: 'reactive' | 'cron' | 'manual'
  log?: Logger
}): Promise<RefillOutcome> {
  const { supabase, orgId, orgCardId, log } = opts
  const trigger = opts.trigger ?? 'reactive'

  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .select('card_funding_vault_address, card_funding_chain_id, treasury_vault_address')
    .eq('id', orgId)
    .maybeSingle()
  if (orgError) {
    log?.error('cards.refill', 'card funding source lookup failed; refusing refill', { orgId, orgCardId, error: orgError.message })
    return { ok: false, status: 503, error: 'card_funding_lookup_failed', reason: 'config' }
  }
  if (!org?.card_funding_vault_address || !org.card_funding_chain_id ||
      org.card_funding_vault_address.toLowerCase() === org.treasury_vault_address?.toLowerCase()) {
    return { ok: false, status: 409, error: 'separate card funding vault is not configured', reason: 'config' }
  }

  const { data: buf, error: bufferError } = await supabase
    .from('card_spend_buffers')
    .select('*')
    .eq('org_card_id', orgCardId)
    .maybeSingle()
  if (bufferError) {
    log?.error('cards.refill', 'buffer lookup failed; refusing refill', { orgCardId, error: bufferError.message })
    return { ok: false, status: 503, error: 'buffer_lookup_failed', reason: 'config' }
  }
  if (!buf) return { ok: false, status: 404, error: 'no buffer configured for this card', reason: 'not_found' }

  // The DB address is only a mirror. Resolve registration and balance from Gateway before
  // enablement, reconciliation, or planning so every refill caller shares one authority and cache refresh.
  const initialSync = await syncBufferBalance({ supabase, orgId, orgCardId, log })
  if (!initialSync.ok) {
    if (initialSync.reason === 'no_buffer') {
      return { ok: false, status: 409, error: 'card buffer wallet not registered on-chain', reason: 'no_buffer' }
    }
    log?.error('cards.refill', 'pre-refill member-wallet balance sync failed; refusing refill planning', {
      orgCardId, reason: initialSync.reason,
    })
    return { ok: false, status: 503, error: 'pre_refill_buffer_sync_failed', reason: 'read' }
  }
  // Keep balance reconciliation active for spend events even when this global execution gate is off.
  if (process.env.CARD_BUFFER_REFILL_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'card buffer refill is not enabled', reason: 'disabled' }
  }
  if (!buf.auto_refill_enabled) return { ok: false, status: 409, error: 'auto-refill disabled for this card', reason: 'not_enabled' }

  // Never submit a new refill while an earlier attempt has an ambiguous chain outcome. In particular,
  // a receipt timeout after broadcast must not mint a fresh refillId and redeem a second vault slice.
  const { data: unresolvedRows, error: unresolvedError } = await supabase.from('card_buffer_refills')
    .select('refill_id, tx_hash, status, amount_atomic').eq('org_card_id', orgCardId)
    .in('status', ['pending', 'submitted']).order('created_at', { ascending: false }).limit(2)
  if (unresolvedError) {
    log?.error('cards.refill', 'unresolved refill lookup failed; refusing another submission', { orgCardId, error: unresolvedError.message })
    return { ok: false, status: 503, error: 'refill_attempt_reconciliation_unavailable', reason: 'config' }
  }
  const unresolved = unresolvedRows?.[0]
  if ((unresolvedRows?.length ?? 0) > 1) {
    log?.error('cards.refill', 'multiple unresolved refill attempts require operator reconciliation', {
      orgCardId, refillIds: unresolvedRows?.map((row: { refill_id: string }) => row.refill_id),
    })
    return { ok: false, status: 503, error: 'multiple_refill_attempts_require_reconciliation', reason: 'tx' }
  }
  if (unresolved?.status === 'submitted' && unresolved.tx_hash && isHex(unresolved.tx_hash)) {
    const rpcUrl = rpcForChain(org.card_funding_chain_id)
    const chain = viemChainFor(org.card_funding_chain_id)
    if (!rpcUrl || !chain) {
      return { ok: false, status: 503, error: 'refill_receipt_chain_unavailable', reason: 'chain', detail: unresolved.tx_hash }
    }
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    let receipt
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: unresolved.tx_hash as `0x${string}` })
    } catch (e) {
      log?.warn('cards.refill', 'submitted refill has no readable receipt yet', { orgCardId, refillId: unresolved.refill_id, txHash: unresolved.tx_hash, error: String(e) })
      return { ok: false, status: 503, error: 'refill_attempt_still_pending', reason: 'tx', detail: unresolved.tx_hash }
    }
    if (receipt.status === 'reverted') {
      const { data: failedRow, error: failedError } = await supabase.from('card_buffer_refills')
        .update({ status: 'failed', reason: 'reverted on-chain' })
        .eq('org_card_id', orgCardId).eq('refill_id', unresolved.refill_id).eq('status', 'submitted')
        .select('refill_id').maybeSingle()
      if (failedError || !failedRow) {
        log?.error('cards.refill', 'reverted refill could not be reconciled in the ledger', { orgCardId, refillId: unresolved.refill_id, txHash: unresolved.tx_hash, error: failedError?.message })
        return { ok: false, status: 503, error: 'refill_reverted_ledger_reconciliation_required', reason: 'tx', detail: unresolved.tx_hash }
      }
      // This attempt's rate room remains conservatively counted until its window resets.
    } else {
      // The transaction may have mined after the caller's pre-refill sync. Refresh from chain before
      // completing the retry so the durable `confirmed` state cannot coexist with a stale balance
      // cache. If sync/persistence fails, leave the attempt submitted and retry this receipt path.
      const synced = await syncBufferBalance({ supabase, orgId, orgCardId, log })
      if (!synced.ok) {
        log?.error('cards.refill', 'mined refill balance could not be reconciled before completion', {
          orgCardId, refillId: unresolved.refill_id, txHash: unresolved.tx_hash, reason: synced.reason,
        })
        return { ok: false, status: 503, error: 'refill_mined_balance_reconciliation_required', reason: 'read', detail: unresolved.tx_hash }
      }
      const { data: confirmedRow, error: confirmationError } = await supabase.from('card_buffer_refills')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('org_card_id', orgCardId).eq('refill_id', unresolved.refill_id).eq('status', 'submitted')
        .select('refill_id').maybeSingle()
      if (confirmationError || !confirmedRow) {
        log?.error('cards.refill', 'successful refill receipt could not be reconciled in the ledger', { orgCardId, refillId: unresolved.refill_id, txHash: unresolved.tx_hash, error: confirmationError?.message })
        return { ok: false, status: 503, error: 'refill_mined_ledger_reconciliation_required', reason: 'tx', detail: unresolved.tx_hash }
      }
      const explorerUrl = explorerTxUrl(org.card_funding_chain_id, unresolved.tx_hash) ?? ''
      return {
        ok: true, txHash: unresolved.tx_hash as `0x${string}`, explorerUrl,
        refilledAtomic: big(unresolved.amount_atomic), breakerTripped: false,
      }
    }
  } else if (unresolved && !unresolved.tx_hash && /^0x[0-9a-f]{64}$/i.test(unresolved.refill_id)) {
    // If the RPC accepted a submission but lost its response, the transaction hash may be absent
    // even though the Gateway committed the refill. The contract's idempotency bit is set in the
    // same transaction as the vault redemption and rolls back on any revert, so `true` is proof the
    // attempt completed. `false` is not proof of failure: a pending transaction may still mine, so
    // keep blocking new refill IDs and let a later retry check again.
    const rpcUrl = rpcForChain(org.card_funding_chain_id)
    const chain = viemChainFor(org.card_funding_chain_id)
    if (!rpcUrl || !chain) {
      return { ok: false, status: 503, error: 'refill_reconciliation_chain_unavailable', reason: 'chain', detail: unresolved.refill_id }
    }
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    let gateway: `0x${string}`
    let completed: boolean
    try {
      gateway = await readCardFundingGateway(publicClient, org.card_funding_vault_address as `0x${string}`, org.treasury_vault_address)
      completed = await publicClient.readContract({
        address: gateway, abi: PAYMENT_GATEWAY_ABI, functionName: 'refillDone',
        args: [unresolved.refill_id as `0x${string}`],
      })
    } catch (e) {
      log?.warn('cards.refill', 'hashless refill state could not be read; keeping attempt unresolved', {
        orgCardId, refillId: unresolved.refill_id, error: String(e),
      })
      return { ok: false, status: 503, error: 'hashless_refill_state_unavailable', reason: 'read', detail: unresolved.refill_id }
    }
    if (!completed) {
      log?.warn('cards.refill', 'hashless refill is not yet committed; keeping attempt unresolved', {
        orgCardId, refillId: unresolved.refill_id, status: unresolved.status,
      })
      return { ok: false, status: 503, error: 'refill_attempt_still_pending', reason: 'tx', detail: unresolved.refill_id }
    }

    // Reconcile the authoritative wallet balance before making the durable attempt terminal. If
    // either write fails, leave the attempt retryable; the next call will prove completion again.
    const synced = await syncBufferBalance({ supabase, orgId, orgCardId, log })
    if (!synced.ok) {
      return { ok: false, status: 503, error: 'hashless_refill_balance_reconciliation_required', reason: 'read', detail: unresolved.refill_id }
    }
    const { data: recoveredRow, error: recoveryError } = await supabase.from('card_buffer_refills')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), reason: 'confirmed from Gateway refillDone state; transaction hash unavailable' })
      .eq('org_card_id', orgCardId).eq('refill_id', unresolved.refill_id)
      .in('status', ['pending', 'submitted']).is('tx_hash', null)
      .select('refill_id').maybeSingle()
    if (recoveryError || !recoveredRow) {
      log?.error('cards.refill', 'committed hashless refill could not be reconciled in the ledger', {
        orgCardId, refillId: unresolved.refill_id, error: recoveryError?.message ?? 'attempt_row_missing',
      })
      return { ok: false, status: 503, error: 'hashless_refill_ledger_reconciliation_required', reason: 'config', detail: unresolved.refill_id }
    }
    log?.info('cards.refill', 'reconciled a committed refill without a transaction hash', {
      orgCardId, refillId: unresolved.refill_id,
    })
    return {
      ok: true, refilledAtomic: big(unresolved.amount_atomic), breakerTripped: false,
    }
  } else if (unresolved) {
    log?.error('cards.refill', 'refill attempt has no usable transaction hash; operator reconciliation required', {
      orgCardId, refillId: unresolved.refill_id, status: unresolved.status, txHash: unresolved.tx_hash,
    })
    return {
      ok: false, status: 503, error: 'refill_attempt_requires_reconciliation', reason: 'tx',
      detail: `${unresolved.status}:${unresolved.refill_id}:${unresolved.tx_hash ?? 'transaction_hash_unknown'}`,
    }
  }

  // ── compute the target from the (agent-tuned) sizing inputs, then the refill deficit ──
  const sizing: BufferSizingParams = {
    meanDemandLeadTimeAtomic: big(buf.mean_demand_leadtime_atomic),
    demandStdevAtomic: big(buf.demand_stdev_atomic),
    sigmaPeriodSecs: Number(buf.sigma_period_secs),
    leadTimeSecs: Number(buf.lead_time_secs),
    serviceLevelBps: Number(buf.service_level_bps),
  }
  const target = bufferTargetAtomic(sizing)

  const plan = refillPlan({
    bufferBalanceAtomic: initialSync.balanceAtomic,
    targetAtomic: target,
    minRefillAtomic: big(buf.min_refill_atomic),
  })
  // persist the freshly-computed target regardless (cheap, keeps the row honest)
  const { data: targetRow, error: targetError } = await supabase.from('card_spend_buffers')
    .update({ buffer_target_atomic: target.toString(), updated_at: new Date().toISOString() })
    .eq('id', buf.id).select('id').maybeSingle()
  if (targetError || !targetRow) {
    log?.error('cards.refill', 'computed buffer target could not be persisted', { orgCardId, error: targetError?.message })
    return { ok: false, status: 503, error: 'buffer_target_persist_failed', reason: 'config' }
  }
  if (!plan.shouldRefill) return { ok: false, status: 200, error: 'buffer already at or above target', reason: 'at_target' }

  // ── atomic refill-rate breaker + in-flight claim (audit fix M1) ──
  // begin_card_refill rolls the window, enforces the breaker + rate cap, claims the 300s lease, and
  // inserts the durable attempt in one transaction under the buffer-row lock. It also rejects an
  // unresolved attempt even if this invocation passed the earlier lookup before that attempt existed.
  // A second balance sync is still required because the initial deficit predates the claim. The token
  // fences release so an expired worker cannot clear a newer attempt's lease.
  const leaseToken = crypto.randomUUID()
  const refillId = keccak256(toBytes(`refill:${orgCardId}:${leaseToken}`))
  const { data: beginRaw, error: beginError } = await supabase.rpc('begin_card_refill', {
    p_org_card_id: orgCardId,
    p_amount: plan.refillAmountAtomic.toString(),
    p_now_secs: nowSecs(),
    p_lease_token: leaseToken,
    p_refill_id: refillId,
    p_member_wallet: buf.member_wallet,
    p_trigger: trigger,
  })
  if (beginError) {
    log?.error('cards.refill', 'refill lock claim failed; refusing submission', { orgCardId, error: beginError.message })
    // The RPC may have committed its claim even though the response was lost. Release only this
    // attempt's token, and keep the rate reservation: without the response, its exact allowed amount
    // is unknown and must not be refunded from the shared window counter.
    try {
      const { data: released, error: releaseError } = await supabase.rpc('end_card_refill', {
        p_org_card_id: orgCardId,
        p_lease_token: leaseToken,
        p_refund: '0',
      })
      if (releaseError) {
        log?.warn('cards.refill', 'ambiguous refill claim could not be released; lease will expire', { orgCardId, error: releaseError.message })
      } else if (released !== true) {
        log?.info('cards.refill', 'ambiguous refill claim was not owned by this attempt', { orgCardId })
      }
    } catch (releaseError) {
      log?.warn('cards.refill', 'ambiguous refill claim release threw; lease will expire', { orgCardId, error: String(releaseError) })
    }
    return { ok: false, status: 503, error: 'refill_lock_unavailable', reason: 'config' }
  }
  const begin = (beginRaw ?? { status: 'no_buffer', allowed: '0' }) as { status: string; allowed: string }
  const allowed = big(begin.allowed)
  if (begin.status !== 'ok' || allowed <= 0n) {
    const rateLimited = begin.status === 'breaker' || begin.status === 'rate_capped'
    const { error: skipLedgerError } = await supabase.from('card_buffer_refills').insert({
      org_card_id: orgCardId, member_wallet: buf.member_wallet,
      refill_id: 'skip:' + keccak256(toBytes(`${buf.id}:${nowSecs()}:${begin.status}`)),
      amount_atomic: plan.refillAmountAtomic.toString(), status: rateLimited ? 'rate_capped' : 'skipped',
      breaker_tripped: begin.status === 'breaker' || begin.status === 'rate_capped', trigger, reason: begin.status,
    })
    if (skipLedgerError) {
      // This row is observability only: preserve the authoritative breaker/skip outcome, but make
      // the missing audit record visible instead of silently reporting a fully recorded decision.
      log?.error('cards.refill', 'skip outcome could not be recorded in refill ledger', {
        orgCardId, status: begin.status, error: skipLedgerError.message,
      })
    }
    if (begin.status === 'in_flight') {
      return { ok: false, status: 409, error: 'another refill attempt is unresolved', reason: 'in_flight' }
    }
    if (begin.status === 'breaker') {
      return { ok: false, status: 409, error: 'refill breaker is open', reason: 'breaker' }
    }
    if (begin.status === 'rate_capped') {
      return { ok: false, status: 429, error: 'refill rate cap reached', reason: 'rate_capped' }
    }
    if (begin.status === 'nothing') {
      return { ok: false, status: 200, error: 'no refill amount available', reason: 'at_target' }
    }
    return { ok: false, status: 503, error: `refill not permitted (${begin.status})`, reason: 'config' }
  }

  // From here the in-flight slot is HELD — release it on every exit path via finally. Ambiguous chain
  // submissions keep their rate-cap claim; only pre-submit failures and reverted receipts refund it.
  let retainRateCap = false
  let rateCapUsed = 0n
  let refillAmount = 0n
  try {
    // Source configuration may have changed between the initial lookup and the durable lease claim.
    // The database trigger blocks later changes while this pending attempt exists; this read closes
    // the opposite ordering, where a source update commits just before begin_card_refill inserts it.
    const { data: claimedOrg, error: claimedOrgError } = await supabase.from('orgs')
      .select('card_funding_vault_address, card_funding_chain_id')
      .eq('id', orgId).maybeSingle()
    if (claimedOrgError || !claimedOrg ||
        claimedOrg.card_funding_vault_address?.toLowerCase() !== org.card_funding_vault_address.toLowerCase() ||
        Number(claimedOrg.card_funding_chain_id) !== Number(org.card_funding_chain_id)) {
      log?.warn('cards.refill', 'card funding source changed before refill lease claim; refusing the stale source', {
        orgCardId, error: claimedOrgError?.message,
      })
      return { ok: false, status: 409, error: 'card_funding_source_changed_retry', reason: 'config' }
    }

    // Re-read the authoritative balance after acquiring the per-card refill slot. The earlier sync and
    // deficit calculation happen before this lock; another caller may have completed a refill in
    // between, leaving this request with a stale full-deficit amount. Keep the serialized breaker
    // reservation, but only submit the remaining deficit.
    const lockedSync = await syncBufferBalance({ supabase, orgId, orgCardId, log })
    if (!lockedSync.ok) {
      log?.error('cards.refill', 'post-lock buffer sync failed; refusing stale-amount refill', {
        orgCardId, reason: lockedSync.reason,
      })
      return { ok: false, status: 503, error: 'post_lock_buffer_sync_failed', reason: 'read' }
    }
    const lockedPlan = refillPlan({
      bufferBalanceAtomic: lockedSync.balanceAtomic,
      targetAtomic: target,
      minRefillAtomic: big(buf.min_refill_atomic),
    })
    if (!lockedPlan.shouldRefill) {
      return { ok: false, status: 200, error: 'buffer already at or above target', reason: 'at_target' }
    }
    refillAmount = lockedPlan.refillAmountAtomic < allowed ? lockedPlan.refillAmountAtomic : allowed
    if (refillAmount <= 0n) {
      return { ok: false, status: 200, error: 'buffer already at or above target', reason: 'at_target' }
    }

    // ── card funding configuration ──
    const { data: card, error: cardError } = await supabase
      .from('org_cards')
      .select('member_wallet, provider, state')
      .eq('id', orgCardId).maybeSingle()
    if (cardError) {
      log?.error('cards.refill', 'card lookup failed; refusing refill', { orgCardId, error: cardError.message })
      return { ok: false, status: 503, error: 'card_lookup_failed', reason: 'config' }
    }
    if (!card) return { ok: false, status: 404, error: 'card not found', reason: 'not_found' }
    if (card.provider !== 'bridge' || card.member_wallet?.toLowerCase() !== buf.member_wallet.toLowerCase()) {
      return { ok: false, status: 409, error: 'card funding wallet binding is inconsistent', reason: 'config' }
    }
    // Onboarding primes a newly issued, still-paused card through the internal manual trigger. The
    // reactive webhook and scheduled backstop must only replenish a live card; otherwise a canceled
    // card can keep redeeming the member's Earn shares into a wallet no active card uses.
    if (card.state === 'CLOSED' || (trigger !== 'manual' && card.state !== 'OPEN')) {
      return { ok: false, status: 409, error: 'card is not active for automatic refill', reason: 'not_enabled' }
    }

    const rpcUrl = rpcForChain(org.card_funding_chain_id)
    const chain = viemChainFor(org.card_funding_chain_id)
    if (!rpcUrl || !chain) return { ok: false, status: 400, error: 'unsupported chain', reason: 'chain' }

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    let gateway: `0x${string}`
    try {
      gateway = await readCardFundingGateway(publicClient, org.card_funding_vault_address as `0x${string}`, org.treasury_vault_address)
    } catch {
      return { ok: false, status: 502, error: 'card_funding_vault_read_failed', reason: 'read' }
    }

    // The Gateway pays refill to its current bufferOf[user]. Bridge, however, pulls from the
    // wallet linked when the card was issued. A user may rotate bufferOf onchain after issuance, so
    // prove the destination still equals the card's immutable funding wallet before burning shares.
    let refillDestination: `0x${string}`
    try {
      refillDestination = (await publicClient.readContract({
        address: gateway, abi: PAYMENT_GATEWAY_ABI, functionName: 'bufferOf', args: [buf.member_wallet as `0x${string}`],
      })) as `0x${string}`
    } catch {
      return { ok: false, status: 502, error: 'refill_destination_read_failed', reason: 'read' }
    }
    if (refillDestination.toLowerCase() !== buf.member_wallet.toLowerCase()) {
      log?.error('cards.refill', 'Gateway refill destination differs from the Bridge funding wallet; refusing share redemption', {
        orgCardId, memberWallet: buf.member_wallet, gatewayBuffer: refillDestination,
      })
      return { ok: false, status: 409, error: 'refill_destination_does_not_match_bridge_funding_wallet', reason: 'config' }
    }

    let account
    try {
      account = await getOracleSigner('root')
    } catch (e) {
      log?.error('cards.refill', 'oracle signer unavailable', { error: String(e) })
      return { ok: false, status: 503, error: 'refill_signer_unavailable', reason: 'signer' }
    }
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

    // Persist the final bounded amount before submission; the durable attempt row was opened
    // immediately after the lock claim above.
    const { data: amountRow, error: amountError } = await supabase.from('card_buffer_refills')
      .update({ amount_atomic: refillAmount.toString() })
      .eq('org_card_id', orgCardId).eq('refill_id', refillId).eq('status', 'pending')
      .select('refill_id').maybeSingle()
    if (amountError || !amountRow) {
      log?.error('cards.refill', 'refill amount could not be persisted; refusing submission', {
        orgCardId, refillId, error: amountError?.message ?? 'attempt_row_missing',
      })
      return { ok: false, status: 503, error: 'refill_attempt_amount_persist_failed', reason: 'config' }
    }

    let shares: bigint
    try {
      shares = await publicClient.readContract({
        address: org.card_funding_vault_address as `0x${string}`,
        abi: YIELD_VAULT_ABI,
        functionName: 'previewWithdraw',
        args: [refillAmount],
      })
    } catch (e) {
      log?.error('cards.refill', 'vault share quote failed; refusing refill', { orgCardId, error: String(e) })
      return { ok: false, status: 502, error: 'refill_share_quote_failed', reason: 'read' }
    }

    let txHash: `0x${string}` | undefined
    try {
      // Once submission starts, the RPC outcome may be ambiguous even if the request throws. Retain
      // the claimed rate room unless an actual reverted receipt proves no refill occurred.
      retainRateCap = true
      rateCapUsed = refillAmount
      txHash = await walletClient.writeContract({
        address: gateway, abi: PAYMENT_GATEWAY_ABI, functionName: 'refill',
        args: [refillId, buf.member_wallet as `0x${string}`, shares],
        account, chain, gas: 700_000n,
      })
      const { data: submittedRow, error: submittedError } = await supabase.from('card_buffer_refills')
        .update({ status: 'submitted', tx_hash: txHash })
        .eq('refill_id', refillId).select('refill_id').maybeSingle()
      if (submittedError || !submittedRow) {
        log?.error('cards.refill', 'refill broadcast but submission hash could not be persisted', { orgCardId, refillId, txHash, error: submittedError?.message })
        return { ok: false, status: 503, error: 'refill_submitted_hash_reconciliation_required', reason: 'tx', detail: txHash }
      }
      // A mined tx is not a successful tx — refill can revert (status 0) and still be included.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status === 'reverted') {
        const { error: failedError } = await supabase.from('card_buffer_refills')
          .update({ status: 'failed', tx_hash: txHash, reason: 'reverted on-chain' }).eq('refill_id', refillId)
        if (failedError) log?.error('cards.refill', 'reverted refill status could not be persisted', { orgCardId, refillId, txHash, error: failedError.message })
        retainRateCap = false
        return { ok: false, status: 502, error: 'refill_reverted', reason: 'tx', detail: txHash }
      }
    } catch (e) {
      // Keep the pending/submitted row and reserved rate room: without a confirmed reverted receipt,
      // treating a send/receipt error as failure could permit a second, distinct onchain refill.
      log?.error('cards.refill', 'refill outcome is ambiguous; leaving attempt for reconciliation', { orgCardId, refillId, txHash, error: String(e) })
      return { ok: false, status: 503, error: 'refill_outcome_requires_reconciliation', reason: 'tx', detail: txHash ?? String(e) }
    }

    // Capture the post-transaction balance from chain before making the attempt terminal. Provider
    // pulls can race the preflight read, so `old cache + refill amount` is not authoritative.
    const postRefillSync = await syncBufferBalance({ supabase, orgId, orgCardId, log })
    if (!postRefillSync.ok) {
      log?.error('cards.refill', 'mined refill balance could not be reconciled', {
        orgCardId, refillId, txHash, reason: postRefillSync.reason,
      })
      return { ok: false, status: 503, error: 'refill_mined_balance_reconciliation_required', reason: 'read', detail: txHash }
    }

    // The chain moved funds, so keep the rate-window room even if accounting persistence fails.
    retainRateCap = true
    // Do not report success until the durable attempt ledger records the mined transaction.
    const { data: confirmedRow, error: ledgerError } = await supabase.from('card_buffer_refills')
      .update({ status: 'confirmed', tx_hash: txHash, confirmed_at: new Date().toISOString() })
      .eq('refill_id', refillId).select('refill_id').maybeSingle()
    if (ledgerError || !confirmedRow) {
      log?.error('cards.refill', 'refill mined but ledger confirmation failed', { orgCardId, refillId, txHash, error: ledgerError?.message })
      return { ok: false, status: 503, error: 'refill_mined_ledger_reconciliation_required', reason: 'config', detail: txHash }
    }
    // syncBufferBalance already persisted the exact chain balance above; only stamp the activity time.
    const { data: balanceRow, error: balanceError } = await supabase.from('card_spend_buffers').update({
      last_refill_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', buf.id).select('id').maybeSingle()
    if (balanceError || !balanceRow) {
      log?.error('cards.refill', 'refill mined but balance cache update failed', { orgCardId, refillId, txHash, error: balanceError?.message })
      return { ok: false, status: 503, error: 'refill_mined_balance_reconciliation_required', reason: 'config', detail: txHash }
    }

    const explorerUrl = explorerTxUrl(org.card_funding_chain_id, txHash) ?? ''
    return { ok: true, txHash, explorerUrl, refilledAtomic: refillAmount, breakerTripped: false }
  } finally {
    // A known pre-submit exit is safe to mark failed, allowing a later attempt. If this process died
    // before finally ran, the pending row remains and future workers fail closed for reconciliation.
    if (!retainRateCap) {
      const { error: preSubmitError } = await supabase.from('card_buffer_refills')
        .update({ status: 'failed', reason: 'refill did not submit a transaction' })
        .eq('org_card_id', orgCardId).eq('refill_id', refillId).eq('status', 'pending')
      if (preSubmitError) {
        log?.error('cards.refill', 'pre-submit refill attempt could not be closed; it remains unresolved', {
          orgCardId, refillId, error: preSubmitError.message,
        })
      }
    }
    // Always release the in-flight slot. Refund window room only when submission never began or an
    // onchain reverted receipt proves no refill occurred; ambiguous outcomes keep the claim reserved.
    const { data: released, error: endError } = await supabase.rpc('end_card_refill', {
      p_org_card_id: orgCardId,
      p_lease_token: leaseToken,
      p_refund: retainRateCap ? (allowed - rateCapUsed).toString() : allowed.toString(),
    })
    if (endError) log?.error('cards.refill', 'refill lock release failed; lease will expire', { orgCardId, error: endError.message })
    else if (released !== true) log?.warn('cards.refill', 'refill lease was already replaced or released; leaving current lease untouched', { orgCardId })
  }
}
