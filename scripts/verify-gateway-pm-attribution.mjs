// Historical PM attribution recovery (independent Codex audit, round-4 pass-2 to-do items 3/4, 2026-09-10).
//
// Migration 20260909000005 stopped GUESSING at pre-existing gateway_deposit_events rows that predate
// position_manager tracking (position_manager IS NULL) — no more migration-time "prefer the active PM"
// backfill, no more runtime "first write to name any PM adopts the whole history." Those rows now sit
// untouched and invisible to every generation's read/write path until something resolves them from real
// evidence. This script is that something: for each orphaned row, it fetches the ACTUAL on-chain receipt
// for its own stored tx_hash, decodes the real Deposited/Withdrawn event, and recovers:
//   - position_manager  = receipt.to        (the tx's REAL destination — never inferred, never guessed)
//   - shares_minted / shares_burned = the event's own reported amount (also needed by migration
//     20260909000004's same-block derived-shares fix, for rows old enough to predate that too)
//   - block_number / tx_index = the receipt's own block/position (needed for correct chain-order replay)
// A row whose tx_hash can't be resolved (pruned node, chain reorg, RPC error, event not found, or the
// decoded user doesn't match the row's own address) is reported as UNRESOLVED and left untouched —
// this script NEVER guesses; an honest "still unknown" beats a wrong number every time.
//
// Usage (dry-run is the default — no writes, ever, without --apply):
//   node --env-file=.env.local scripts/verify-gateway-pm-attribution.mjs                 # dry run, prints a report
//   node --env-file=.env.local scripts/verify-gateway-pm-attribution.mjs --apply         # actually resolves + recomputes
//   node --env-file=.env.local scripts/verify-gateway-pm-attribution.mjs --apply --limit 50
//
// Requires (same env this app already uses elsewhere): NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, LP_GATEWAY_RPC_URL. Never runs against real data without an operator
// explicitly reading the dry-run report first and choosing --apply themselves.

import { createServerClient } from '@supabase/ssr'
import { createPublicClient, http, decodeEventLog } from 'viem'

// Minimal ABI fragment — just the two events this script needs to decode (mirrors
// lib/web3/artifacts/lpGateway.ts's Deposited/Withdrawn definitions; duplicated here because this is a
// plain .mjs script, not a Next.js module, and doesn't import project TS at runtime).
const LP_GATEWAY_EVENTS_ABI = [
  { type: 'event', name: 'Deposited', inputs: [
    { name: 'user', type: 'address', indexed: true },
    { name: 'quoteIn', type: 'uint256', indexed: false },
    { name: 'sharesMinted', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'Withdrawn', inputs: [
    { name: 'user', type: 'address', indexed: true },
    { name: 'sharesBurned', type: 'uint256', indexed: false },
    { name: 'quoteOut', type: 'uint256', indexed: false },
    { name: 'pairedOut', type: 'uint256', indexed: false },
  ] },
]

/** Core decision logic — pure w.r.t. its inputs (an injected `fetchReceipt`), so it's unit-testable
 *  without a live chain connection. Returns one plan entry per input row: `resolved: true` with the
 *  verified fields to write, or `resolved: false` with a reason — NEVER a guessed value either way. */
export async function planAttribution(orphanedRows, fetchReceipt) {
  const plan = []
  for (const row of orphanedRows) {
    let receipt
    try {
      receipt = await fetchReceipt(row.tx_hash)
    } catch (e) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: `receipt_fetch_failed: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    if (!receipt) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: 'receipt_not_found' })
      continue
    }
    if (receipt.status !== 'success') {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: 'tx_reverted' })
      continue
    }
    if (!receipt.to) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: 'no_receipt_to' })
      continue
    }
    let decoded = null
    for (const log of receipt.logs ?? []) {
      if (log.address?.toLowerCase() !== receipt.to.toLowerCase()) continue
      try {
        const ev = decodeEventLog({ abi: LP_GATEWAY_EVENTS_ABI, data: log.data, topics: log.topics })
        const wantEvent = row.kind === 'deposit' ? 'Deposited' : 'Withdrawn'
        if (ev.eventName !== wantEvent) continue
        if (String(ev.args.user).toLowerCase() !== String(row.address).toLowerCase()) continue // not this row's own event
        decoded = ev
        break
      } catch {
        // not decodable with this ABI — keep scanning other logs
      }
    }
    if (!decoded) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: 'event_not_found_or_user_mismatch' })
      continue
    }
    plan.push({
      id: row.id,
      tx_hash: row.tx_hash,
      resolved: true,
      positionManager: receipt.to.toLowerCase(),
      blockNumber: receipt.blockNumber != null ? receipt.blockNumber.toString() : null,
      txIndex: receipt.transactionIndex ?? null,
      sharesMinted: row.kind === 'deposit' ? decoded.args.sharesMinted.toString() : null,
      sharesBurned: row.kind === 'withdraw' ? decoded.args.sharesBurned.toString() : null,
      address: row.address,
      poolAddress: row.pool_address,
      chainId: row.chain_id,
    })
  }
  return plan
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 500

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const rpcUrl = process.env.LP_GATEWAY_RPC_URL
  const chainId = Number(process.env.LP_GATEWAY_CHAIN_ID ?? '0')
  if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
  if (!rpcUrl || !chainId) { console.error('Missing LP_GATEWAY_RPC_URL / LP_GATEWAY_CHAIN_ID'); process.exit(1) }

  const supabase = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } })
  const client = createPublicClient({ transport: http(rpcUrl) })
  const fetchReceipt = (txHash) => client.getTransactionReceipt({ hash: txHash }).catch(() => null)

  console.log(`${apply ? 'LIVE (--apply)' : 'DRY RUN'} — verify-gateway-pm-attribution, limit=${limit}`)
  if (!apply) console.log('No writes will be made. Pass --apply to actually resolve rows once you have reviewed this report.\n')

  const { data: orphaned, error } = await supabase
    .from('gateway_deposit_events')
    .select('id, tx_hash, address, kind, pool_address, chain_id')
    .is('position_manager', null)
    .limit(limit)
  if (error) { console.error('Failed to read gateway_deposit_events:', error.message); process.exit(1) }
  if (!orphaned || orphaned.length === 0) { console.log('No orphaned (position_manager IS NULL) rows found. Nothing to do.'); return }

  console.log(`Found ${orphaned.length} orphaned row(s). Fetching on-chain receipts...\n`)
  const plan = await planAttribution(orphaned, fetchReceipt)

  const resolved = plan.filter((p) => p.resolved)
  const unresolved = plan.filter((p) => !p.resolved)

  console.log(`Resolved: ${resolved.length} / ${plan.length}`)
  for (const p of resolved) {
    console.log(`  ${p.tx_hash} → position_manager=${p.positionManager} block=${p.blockNumber} txIndex=${p.txIndex}`)
  }
  if (unresolved.length) {
    console.log(`\nUnresolved (left untouched — never guessed): ${unresolved.length}`)
    for (const p of unresolved) console.log(`  ${p.tx_hash} — ${p.reason}`)
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write these changes and recompute affected positions.')
    return
  }

  console.log('\nApplying resolved rows...')
  const identities = new Set() // `${address}:${pool}:${chainId}:${pm}` — recompute each exactly once
  for (const p of resolved) {
    const { error: updErr } = await supabase
      .from('gateway_deposit_events')
      .update({
        position_manager: p.positionManager,
        block_number: p.blockNumber,
        tx_index: p.txIndex,
        ...(p.sharesMinted != null ? { shares_minted: p.sharesMinted } : {}),
        ...(p.sharesBurned != null ? { shares_burned: p.sharesBurned } : {}),
      })
      .eq('id', p.id)
    if (updErr) { console.error(`  FAILED to update ${p.tx_hash}: ${updErr.message}`); continue }
    identities.add(`${p.address.toLowerCase()}:${p.poolAddress.toLowerCase()}:${p.chainId}:${p.positionManager}`)
  }

  console.log(`\nRecomputing ${identities.size} affected position(s)...`)
  for (const key of identities) {
    const [address, poolAddress, chainIdStr, positionManager] = key.split(':')
    const { data, error: rpcErr } = await supabase.rpc('recompute_gateway_position', {
      p_address: address, p_pool_address: poolAddress, p_chain_id: Number(chainIdStr), p_position_manager: positionManager,
    })
    if (rpcErr) {
      console.error(`  FAILED to recompute ${key}: ${rpcErr.message} — this identity's history may still have gaps; re-run once resolved further.`)
      continue
    }
    console.log(`  ${key} → basis=${data?.[0]?.cost_basis_atomic} shares=${data?.[0]?.shares_atomic} (${data?.[0]?.event_count} events)`)
  }
  console.log('\nDone. Unresolved rows remain untouched — re-run this script later if more historical data becomes recoverable.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
