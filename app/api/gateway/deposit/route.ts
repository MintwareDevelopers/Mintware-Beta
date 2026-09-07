import { isHex, decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'
import { nextDepositBasis } from '@/lib/gateway/basisMath'

export const dynamic = 'force-dynamic'

// Non-custodial: the depositor's own wallet sends deposit() (mints shares in the position manager).
// This route VERIFIES that client tx on-chain and mirrors the result into gateway_positions so the
// harvest cron knows the depositor set + shares, and the dashboard has a cost basis. No custody.
//
// M-04 (security review 2026-09-06): auth is signed-message (action-bound) so ONLY the position owner
// can record their own tx (the on-chain Deposited event's user must equal the recovered signer), and
// the entry_nav cost-basis update is idempotent per tx_hash (gateway_deposit_events UNIQUE) so a
// replayed txHash can't inflate the basis.
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.clone().json().catch(() => ({}))) as { txHash?: string; pool?: string }
  // Trust the SIGNER (ctx.user), never a caller-supplied address — the recovered wallet is the only
  // identity allowed to record a position, and it must match the on-chain event's user below.
  const address = ctx.user!.address
  const txHash = body.txHash
  if (!txHash || !isHex(txHash)) return ctx.json({ success: false, error: 'txHash_required' }, 400)

  const inst = await resolveRouteInstance(ctx.supabase, cfg, body.pool ?? null)
  if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

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

  // Idempotency gate: claim this tx in the event ledger BEFORE mutating the basis. A UNIQUE(tx_hash)
  // conflict (23505) means the tx was already recorded → the additive basis update is skipped so a
  // replay can't inflate entry_nav. Any other insert error is a hard failure.
  const { error: evErr } = await ctx.supabase.from('gateway_deposit_events').insert({
    tx_hash: txHash.toLowerCase(),
    address,
    kind: 'deposit',
    pool_address: inst.poolAddress,
    chain_id: inst.chainId,
    quote_in: quoteIn.toString(),
  })
  const alreadyRecorded = evErr?.code === '23505'
  if (evErr && !alreadyRecorded) {
    ctx.log.error('gateway.deposit', 'event insert failed', { error: evErr.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }

  const { data: existing } = await ctx.supabase
    .from('gateway_positions')
    .select('entry_nav')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .maybeSingle()
  const priorBasis = existing?.entry_nav != null ? BigInt(String(existing.entry_nav)) : 0n
  const costBasis = nextDepositBasis(priorBasis, quoteIn, alreadyRecorded)

  // Shares are always synced from the on-chain truth (idempotent regardless of replay).
  const { error } = await ctx.supabase.from('gateway_positions').upsert(
    {
      user_wallet: address,
      pool_address: inst.poolAddress,
      chain_id: inst.chainId,
      shares: onChainShares.toString(),
      entry_nav: costBasis.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_wallet,pool_address,chain_id' },
  )
  if (error) {
    ctx.log.error('gateway.deposit', 'upsert failed', { error: error.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }

  return ctx.json({ success: true, sharesMinted, shares: onChainShares, costBasisAtomic: costBasis, idempotentReplay: alreadyRecorded })
}, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
