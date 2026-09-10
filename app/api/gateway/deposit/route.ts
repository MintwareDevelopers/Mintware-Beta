import { decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { bindSignedRecord } from '@/lib/gateway/recordAuth'

export const dynamic = 'force-dynamic'

// Non-custodial: the depositor's own wallet sends deposit() (mints shares in the position manager).
// This route VERIFIES that client tx on-chain and mirrors the result into gateway_positions so the
// harvest cron knows the depositor set + shares, and the dashboard has a cost basis. No custody.
//
// M-04 (security review 2026-09-06): auth is signed-message (action-bound) so ONLY the position owner
// can record their own tx (the on-chain Deposited event's user must equal the recovered signer), and
// the entry_nav cost-basis update is idempotent per tx_hash (gateway_deposit_events UNIQUE) so a
// replayed txHash can't inflate the basis.
// O-10 (round-2): the signed payload's txHash/pool are strict-compared to the body and a signature is
// single-use inside the freshness window (`bindSignedRecord`). O-2: pool resolution is strict (404 on a
// miss — never the env rig while the registry is populated).
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>
  // Trust the SIGNER (ctx.user), never a caller-supplied address — the recovered wallet is the only
  // identity allowed to record a position, and it must match the on-chain event's user below.
  const address = ctx.user!.address
  const bound = bindSignedRecord(body)
  if (!bound.ok) {
    if (bound.error === 'txHash_required') return ctx.json({ success: false, error: 'txHash_required' }, 400)
    if (bound.error === 'auth_replayed') return ctx.json({ success: false, error: 'auth_replayed' }, 409)
    return ctx.json({ success: false, error: 'auth_payload_mismatch' }, 401)
  }
  const { txHash, pool } = bound.bound

  const r = await resolveInstanceStrict(ctx.supabase, cfg, pool)
  if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
  const inst = r.inst

  const client = gatewayPublicClient(cfg)
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash })
  } catch {
    return ctx.json({ success: false, error: 'tx_not_found' }, 404)
  }
  if (receipt.status !== 'success') return ctx.json({ success: false, error: 'tx_reverted' }, 400)
  if (receipt.to?.toLowerCase() !== inst.positionManager.toLowerCase()) {
    return ctx.json({ success: false, error: 'wrong_contract' }, 400)
  }

  // The Deposited event, emitted by THIS position manager, for THIS user, is the trust anchor.
  let quoteIn = 0n
  let sharesMinted = 0n
  let found = false
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() !== inst.positionManager.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
      if (ev.eventName === 'Deposited' && String(ev.args.user).toLowerCase() === address) {
        quoteIn = ev.args.quoteIn as bigint
        sharesMinted = ev.args.sharesMinted as bigint
        found = true
        break
      }
    } catch {
      /* not a gateway event */
    }
  }
  if (!found) return ctx.json({ success: false, error: 'no_deposit_event' }, 400)

  const onChainShares = (await client.readContract({
    address: inst.positionManager,
    abi: LP_GATEWAY_ABI,
    functionName: 'sharesOf',
    args: [address as `0x${string}`],
  })) as bigint

  // Round-4 audit fix (Medium): the idempotency claim (gateway_deposit_events) and the cost-basis
  // increment (gateway_positions) used to be two separate round-trips — a crash between them silently
  // stranded the missed increment forever, and two concurrent calls for the same wallet+pool could lose
  // one's contribution to a lost-update race. One atomic RPC (supabase/migrations/
  // 20260909000001_gateway_position_atomic_writes.sql) did both under a single transaction.
  //
  // Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09): that RPC still applied its
  // delta against the row's value AT CALL TIME — correct only if recording calls arrive in the same
  // order their txs were mined, which nothing guaranteed (a withdraw's call could race ahead of an
  // earlier deposit's). Migration 20260909000004 moved the RPC to recompute entry_nav by REPLAYING this
  // identity's whole stored event history in ON-CHAIN block order — `p_block_number` (this tx's own
  // block, from the verified receipt) is what makes that replay order-independent of call arrival.
  //
  // Round-4 pass-2 manager-generation fix (independent Codex audit, 2026-09-09): `gateway_positions` was
  // keyed by (wallet, pool, chain) only — a pool that has outlived more than one PositionManager (V1-01
  // residual) co-mingled a depositor's basis across generations. `p_position_manager` (migration
  // 20260909000005) scopes the write to the EXACT generation this deposit went to — `inst.positionManager`
  // is already resolved on-chain (H-01), never a client-supplied claim.
  //
  // Same-block ordering fix (independent Codex audit, live watch, 2026-09-09): `p_block_number` alone
  // ties among two DIFFERENT transactions landing in the SAME block — `p_tx_index` (the receipt's own
  // `transactionIndex`, real on-chain position within the block) is the correct tiebreak, never the
  // recording call's own arrival time.
  //
  // Same-block VALUE fix (independent Codex audit, live watch, 2026-09-09): ordering alone wasn't enough
  // — `onChainShares` above is a BLOCK-END read, wrong for an earlier of two same-block txs by this same
  // user even once correctly ordered. `p_shares_minted` (this tx's OWN Deposited-event amount, already
  // read above — never a chain read) lets the RPC derive a running share total purely from replayed
  // mint/burn amounts instead, immune to same-block/cross-block/call-order ambiguity alike.
  const { data: rpcData, error: rpcErr } = await ctx.supabase.rpc('record_gateway_deposit_event', {
    p_tx_hash: txHash,
    p_address: address,
    p_pool_address: inst.poolAddress,
    p_chain_id: inst.chainId,
    p_quote_in: quoteIn.toString(),
    p_on_chain_shares: onChainShares.toString(),
    p_block_number: receipt.blockNumber.toString(),
    p_position_manager: inst.positionManager,
    p_tx_index: receipt.transactionIndex,
    p_shares_minted: sharesMinted.toString(),
  })
  if (rpcErr) {
    ctx.log.error('gateway.deposit', 'record_gateway_deposit_event failed', { error: rpcErr.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { cost_basis_atomic: string | number; already_recorded: boolean } | undefined
  const costBasis = row?.cost_basis_atomic != null ? BigInt(String(row.cost_basis_atomic)) : 0n
  const alreadyRecorded = row?.already_recorded ?? false

  return ctx.json({ success: true, sharesMinted, shares: onChainShares, costBasisAtomic: costBasis, idempotentReplay: alreadyRecorded })
}, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
