import { decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { bindSignedRecord } from '@/lib/gateway/recordAuth'

export const dynamic = 'force-dynamic'

// Principal withdrawal — separate from spend, and explicitly subject to the current pool price / IL:
// the client tx returns the depositor's pro-rata of BOTH legs, no par claim. This route verifies that
// client tx and syncs gateway_positions (shares from chain, cost basis reduced proportionally).
//
// M-04 (security review 2026-09-06): signed-message (action-bound) so only the owner records their own
// tx (the Withdrawn event's user must equal the recovered signer), and the proportional basis reduction
// is idempotent per tx_hash (gateway_deposit_events UNIQUE) so a replayed txHash can't deflate it twice.
// O-10 (round-2): signed txHash/pool strict-compared to the body; single-use signature (`bindSignedRecord`).
// O-2: strict pool resolution (404 on a miss while the registry is populated).
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>
  const address = ctx.user!.address
  const bound = bindSignedRecord(body)
  if (!bound.ok) {
    if (bound.error === 'txHash_required') return ctx.json({ success: false, error: 'txHash_required' }, 400)
    if (bound.error === 'auth_replayed') return ctx.json({ success: false, error: 'auth_replayed' }, 409)
    return ctx.json({ success: false, error: 'auth_payload_mismatch' }, 401)
  }
  const { txHash, pool } = bound.bound

  const client = gatewayPublicClient(cfg)
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash })
  } catch {
    return ctx.json({ success: false, error: 'tx_not_found' }, 404)
  }
  if (receipt.status !== 'success') return ctx.json({ success: false, error: 'tx_reverted' }, 400)

  // V1-01 fix: a retired (deactivated) instance must still resolve for withdrawal — a depositor's
  // shares don't stop existing when the operator retires the pool from new-deposit eligibility.
  //
  // V1-01 pass-2 residual fix (independent Codex audit, 2026-09-09): resolve by the EXACT PM the
  // receipt itself names (`receipt.to`), not just the pool. If this pool has since been re-registered
  // with a newer PM, a plain pool-only lookup would resolve to that NEW instance — and since the tx
  // actually went to the OLD one, the wrong_contract check below would then reject a completely
  // legitimate withdrawal from a real, still-registered (if retired) instance. Deriving the wanted PM
  // from the receipt itself (not a client-supplied param) means this can't be spoofed either — it's
  // exactly the contract this specific transaction targeted, verified on-chain, not a caller's claim.
  const r = await resolveInstanceStrict(ctx.supabase, cfg, pool, { includeInactive: true, positionManager: receipt.to })
  if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
  const inst = r.inst

  if (receipt.to?.toLowerCase() !== inst.positionManager.toLowerCase()) {
    return ctx.json({ success: false, error: 'wrong_contract' }, 400)
  }

  let sharesBurned = 0n
  let quoteOut = 0n
  let pairedOut = 0n
  let found = false
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() !== inst.positionManager.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
      if (ev.eventName === 'Withdrawn' && String(ev.args.user).toLowerCase() === address) {
        sharesBurned = ev.args.sharesBurned as bigint
        quoteOut = ev.args.quoteOut as bigint
        pairedOut = ev.args.pairedOut as bigint
        found = true
        break
      }
    } catch {
      /* not a gateway event */
    }
  }
  if (!found) return ctx.json({ success: false, error: 'no_withdraw_event' }, 400)

  // V1-04 fix (independent Codex audit, 2026-09-09): read at THIS WITHDRAWAL'S OWN BLOCK, not at
  // record time. record_gateway_withdraw_event's proportional-reduction formula
  // (entry_nav * p_on_chain_shares / (p_on_chain_shares + p_shares_burned)) needs `p_on_chain_shares` to
  // mean "this user's balance immediately after this specific withdrawal" — a live/current read instead
  // gives "balance as of whenever this recording call happens to run", which silently includes any OTHER
  // deposit/withdrawal that landed on-chain in between the withdrawal and its (possibly delayed, possibly
  // retried) recording. Pinning to `receipt.blockNumber` makes the value depend only on this withdrawal's
  // own chain history, never on recording timing or interleaved activity. (`sharesMinted` on the deposit
  // side does NOT need this — record_gateway_deposit_event's entry_nav math is purely additive on
  // `p_quote_in`, and `shares` there is an intentional live resync column, not a point-in-time value.)
  // Residual, accepted, NARROWED (independent Codex audit, live watch, 2026-09-09): two of the SAME
  // user's own transactions landing in the exact same block still both read this SAME post-block-end
  // `onChainShares` value here — that hasn't changed. What DID change: this value is no longer what
  // record_gateway_withdraw_event's basis math actually runs on. Migration 20260909000005 (same-block
  // VALUE fix) derives the replay's share count purely from each event's own sharesMinted/sharesBurned
  // instead of reading `on_chain_shares` from the stored row — so the cost-basis REPLAY is immune to this
  // same-block ambiguity now. `onChainShares` here still only matters for two things this call passes
  // through: `p_on_chain_shares` (still stored per-event, used only by the RPC's single-delta LEGACY
  // fallback path, and for `gateway_positions.shares` below) and the JSON response's own `shares` field.
  // Also accepted: `gateway_positions.shares` gets written from this SAME historical read, so it can be
  // briefly stale (vs. the user's true current on-chain balance) if another of their txs interleaves
  // before this one is recorded. That column is documented elsewhere as pure enrichment, never the
  // authoritative balance — every actual position read (`/api/gateway/position(s)`) re-reads `sharesOf`
  // live from chain regardless (O-1, chain-first) — so this self-corrects on the next real read; a
  // second live-tip read just to keep this cosmetic column perfectly fresh wasn't worth the complexity.
  const onChainShares = (await client.readContract({
    address: inst.positionManager,
    abi: LP_GATEWAY_ABI,
    functionName: 'sharesOf',
    args: [address as `0x${string}`],
    blockNumber: receipt.blockNumber,
  })) as bigint

  // Round-4 audit fix (Medium): same atomicity fix as the deposit route (see its comment) — one RPC
  // does the idempotency claim + proportional basis reduction under a single transaction.
  //
  // Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09): see the deposit route's
  // comment — the RPC now recomputes entry_nav by replaying this identity's whole event history in
  // on-chain block order, and `p_block_number` (this withdrawal's own block, already read above to pin
  // `onChainShares`) is what makes that replay immune to which order recording calls happen to arrive in.
  //
  // Round-4 pass-2 manager-generation fix (independent Codex audit, 2026-09-09): `p_position_manager`
  // scopes this write to the EXACT generation the withdrawal came from — `inst.positionManager` here is
  // already verified against `receipt.to` above (a wallet's own tx, never a client-supplied claim).
  //
  // Same-block ordering fix (independent Codex audit, live watch, 2026-09-09): `p_tx_index` (the
  // receipt's own `transactionIndex`) tiebreaks two DIFFERENT transactions landing in the same block by
  // their real on-chain order — see the deposit route's identical comment.
  const { data: rpcData, error: rpcErr } = await ctx.supabase.rpc('record_gateway_withdraw_event', {
    p_tx_hash: txHash,
    p_address: address,
    p_pool_address: inst.poolAddress,
    p_chain_id: inst.chainId,
    p_quote_out: quoteOut.toString(),
    p_on_chain_shares: onChainShares.toString(),
    p_shares_burned: sharesBurned.toString(),
    p_block_number: receipt.blockNumber.toString(),
    p_position_manager: inst.positionManager,
    p_tx_index: receipt.transactionIndex,
  })
  if (rpcErr) {
    ctx.log.error('gateway.withdraw', 'record_gateway_withdraw_event failed', { error: rpcErr.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { cost_basis_atomic: string | number | null; already_recorded: boolean; position_found: boolean } | undefined
  // No row ⇒ the deposit was never recorded (O-1 legacy) — the RPC deliberately does not synthesize one
  // (entry_nav defaults to 0, so a synthetic row would fabricate a "gain" equal to the whole position).
  // The Portfolio is chain-first and shows the position (basis unknown) regardless.
  const newBasis = row?.position_found && row.cost_basis_atomic != null ? BigInt(String(row.cost_basis_atomic)) : 0n
  const alreadyRecorded = row?.already_recorded ?? false

  return ctx.json({ success: true, sharesBurned, quoteOut, pairedOut, shares: onChainShares, costBasisAtomic: newBasis, idempotentReplay: alreadyRecorded })
}, { auth: 'signed-message', action: 'mintware-gateway-withdraw' })
