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
import { pathToFileURL } from 'node:url'

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
 *  verified fields to write, or `resolved: false` with a reason — NEVER a guessed value either way.
 *  `configuredChainId`, when passed, guards against querying a receipt against the wrong chain's
 *  client: a row whose own `chain_id` doesn't match is reported `chain_mismatch` and never fetched. */
export async function planAttribution(orphanedRows, fetchReceipt, configuredChainId) {
  const plan = []
  for (const row of orphanedRows) {
    if (configuredChainId != null && row.chain_id != null && Number(row.chain_id) !== Number(configuredChainId)) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: `chain_mismatch: row is chain ${row.chain_id}, configured client is chain ${configuredChainId}` })
      continue
    }
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
    // Ordering metadata is REQUIRED, not optional — a row missing block_number/tx_index can't be placed
    // correctly in chain-order replay, so it must never be marked resolved just because the event itself
    // decoded (Codex, 01:43 UTC: "Completeness currently does not reject missing block_number/tx_index").
    if (receipt.blockNumber == null || receipt.transactionIndex == null) {
      plan.push({ id: row.id, tx_hash: row.tx_hash, resolved: false, reason: 'missing_ordering_metadata' })
      continue
    }
    plan.push({
      id: row.id,
      tx_hash: row.tx_hash,
      resolved: true,
      positionManager: receipt.to.toLowerCase(),
      blockNumber: receipt.blockNumber.toString(),
      txIndex: receipt.transactionIndex,
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

  // Verify the RPC endpoint itself is actually the configured chain — LP_GATEWAY_CHAIN_ID is a
  // human-set env var and LP_GATEWAY_RPC_URL is a separate one; nothing upstream guarantees they agree.
  // Fetching a receipt against the WRONG chain's RPC would silently attribute a row to a transaction
  // hash collision on a different network (Codex, 01:43 UTC: "neither verifies RPC chain ID"). Fail
  // closed rather than proceed on an unverified assumption.
  const actualChainId = await client.getChainId().catch((e) => { throw new Error(`Failed to verify RPC chain id: ${e instanceof Error ? e.message : String(e)}`) })
  if (actualChainId !== chainId) {
    console.error(`RPC chain id mismatch: LP_GATEWAY_CHAIN_ID=${chainId} but LP_GATEWAY_RPC_URL reports chain ${actualChainId}. Refusing to fetch any receipts.`)
    process.exit(1)
  }

  console.log(`${apply ? 'LIVE (--apply)' : 'DRY RUN'} — verify-gateway-pm-attribution, limit=${limit}`)
  if (!apply) console.log('No writes will be made. Pass --apply to actually resolve rows once you have reviewed this report.\n')

  const { data: orphaned, error } = await supabase
    .from('gateway_deposit_events')
    .select('id, tx_hash, address, kind, pool_address, chain_id')
    .is('position_manager', null)
    .limit(limit)
  if (error) { console.error('Failed to read gateway_deposit_events:', error.message); process.exit(1) }
  if (!orphaned || orphaned.length === 0) {
    console.log('No orphaned (position_manager IS NULL) rows found.')
    // Do NOT just return here when --apply is set: "no orphans left to resolve" is exactly the state a
    // PRIOR --apply run leaves behind when it updated every event row but crashed/was killed before its
    // own recompute step ran. Returning early would silently defeat this script's entire self-healing
    // design (Codex: "no-orphans early return defeats interrupted-apply repair") — always run the full
    // idempotent recompute sweep on --apply, even when there's nothing new to resolve this time.
    if (apply) await recomputeAllResolvedIdentities(supabase, new Set())
    else console.log('Nothing to do.')
    return
  }

  console.log(`Found ${orphaned.length} orphaned row(s). Fetching on-chain receipts...\n`)
  const plan = await planAttribution(orphaned, fetchReceipt, chainId)

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
  // Track any identity that had AT LEAST ONE row fail to update this run. If row A of an identity's
  // history updates but row B (same wallet/pool/chain/PM) fails, recomputing from the surviving subset
  // would silently replay an INCOMPLETE history and publish a wrong basis that looks fully resolved
  // (Codex, 01:43 UTC: "Partial batches or one failed event update can also publish a basis from
  // incomplete history"). So: skip recompute entirely for any identity touched by a failed update this
  // run — its history is known-incomplete until every one of its rows actually lands.
  const failedIdentities = new Set()
  for (const p of resolved) {
    const identityKey = `${p.address.toLowerCase()}:${p.poolAddress.toLowerCase()}:${p.chainId}:${p.positionManager}`
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
    if (updErr) {
      console.error(`  FAILED to update ${p.tx_hash}: ${updErr.message}`)
      failedIdentities.add(identityKey)
    }
  }

  // Recompute is a FULL, idempotent, unconditional pass over every distinct identity that currently has
  // a resolved position_manager — not just identities touched by THIS run's resolutions. This is what
  // makes an interrupted --apply run self-healing: if a prior invocation updated some events but crashed
  // (or was killed) before reaching this step, those rows' position_manager is already non-null, so the
  // orphan scan above will never find them again — but they'll still show up here every time, and get
  // recomputed again, until recompute_gateway_position actually succeeds for them.
  await recomputeAllResolvedIdentities(supabase, failedIdentities)
  console.log('\nDone. Unresolved rows remain untouched — re-run this script later if more historical data becomes recoverable.')
}

const PAGE_SIZE = 1000

/** Page through a PostgREST query with a deterministic `id ASC` order, advancing `from` by the ACTUAL
 *  number of rows each page returns rather than by a fixed PAGE_SIZE. This is deliberate, not merely
 *  defensive: PostgREST/Supabase can enforce a server-side max-rows cap lower than whatever range we
 *  request, and without a stable order there's no guarantee two range() calls even see a consistent
 *  slice of the same rows (Codex: "pagination still lacks deterministic ORDER BY and assumes the server
 *  cap is at least PAGE_SIZE=1000 — a lower configured cap returns a short first page and prematurely
 *  ends traversal"). Advancing by the real returned count and stopping only on a truly EMPTY page is
 *  correct regardless of what cap the server actually enforces. `queryFactory` must return a fresh
 *  PostgREST query (missing only `.order()`/`.range()`) — Supabase builders are single-use per chain. */
async function paginateAll(queryFactory, onRow) {
  for (let from = 0; ; ) {
    const { data: rows, error } = await queryFactory().order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) return { error }
    for (const row of rows ?? []) onRow(row)
    if (!rows || rows.length === 0) break
    from += rows.length
  }
  return {}
}

/** Every `wallet:pool:chainId` combination that STILL has at least one orphaned (position_manager IS
 *  NULL) row right now — used to gate recompute on a genuinely complete history, not just "nothing
 *  failed to update this run." Returns null on a read failure (caller must fail closed, never proceed
 *  without this check). */
async function fetchOrphanedWalletKeys(supabase) {
  const keys = new Set()
  const { error } = await paginateAll(
    () => supabase.from('gateway_deposit_events').select('id, address, pool_address, chain_id').is('position_manager', null),
    (row) => keys.add(`${row.address.toLowerCase()}:${row.pool_address.toLowerCase()}:${row.chain_id}`),
  )
  if (error) { console.error('Failed to check remaining orphaned rows:', error.message); return null }
  return keys
}

/** Full, idempotent sweep: recompute EVERY distinct (address, pool_address, chain_id, position_manager)
 *  combination currently present in gateway_deposit_events with a non-null position_manager — regardless
 *  of whether this invocation resolved it or a prior (possibly interrupted) one did. Safe to call any
 *  number of times; recompute_gateway_position itself just replays that identity's full event history.
 *
 *  Before recomputing, gates each identity on a genuinely COMPLETE history: if the same
 *  wallet/pool/chain still has ANY orphaned (position_manager IS NULL) row — whether from a receipt
 *  that failed to resolve, one that fell outside a prior run's --limit batch, or one this run's own
 *  UPDATE failed to write — that identity is skipped rather than recomputed, because an unresolved
 *  sibling event could genuinely belong to this exact position manager and its absence would silently
 *  publish an incomplete basis (Codex: "recompute enumeration... [must] gate publication on complete
 *  identity recovery"). This single check subsumes and generalizes the narrower "did my own UPDATE
 *  fail this run" tracking — an UPDATE failure always leaves that row NULL in the DB, so it's always
 *  caught here too. `skipIdentities` (optional Set of `address:pool:chainId:pm` keys) is additive —
 *  callers may still pass extra identities to skip for other reasons. */
export async function recomputeAllResolvedIdentities(supabase, skipIdentities) {
  const orphanedWalletKeys = await fetchOrphanedWalletKeys(supabase)
  if (orphanedWalletKeys === null) {
    console.error('Aborting recompute sweep: could not verify whether any wallet/pool/chain still has unresolved orphaned rows, so completeness cannot be guaranteed.')
    return
  }

  const identities = new Map() // key -> {address, poolAddress, chainId, positionManager}
  const { error } = await paginateAll(
    () => supabase.from('gateway_deposit_events').select('id, address, pool_address, chain_id, position_manager').not('position_manager', 'is', null),
    (row) => {
      const key = `${row.address.toLowerCase()}:${row.pool_address.toLowerCase()}:${row.chain_id}:${row.position_manager.toLowerCase()}`
      if (!identities.has(key)) {
        identities.set(key, { address: row.address, poolAddress: row.pool_address, chainId: row.chain_id, positionManager: row.position_manager })
      }
    },
  )
  if (error) { console.error('Failed to list resolved identities for recompute:', error.message); return }

  const skip = new Map() // key -> reason
  for (const key of skipIdentities ?? []) skip.set(key, "a sibling row's update failed this run")
  for (const [key, id] of identities) {
    const walletKey = `${id.address.toLowerCase()}:${id.poolAddress.toLowerCase()}:${id.chainId}`
    if (orphanedWalletKeys.has(walletKey) && !skip.has(key)) {
      skip.set(key, 'orphaned (position_manager IS NULL) row(s) still exist for this wallet/pool/chain — history may be incomplete')
    }
  }

  if (skip.size) {
    console.log(`\nSkipping recompute for ${skip.size} identity(ies) with a known-incomplete history — re-run once every sibling row resolves:`)
    for (const [key, reason] of skip) console.log(`  SKIPPED: ${key} — ${reason}`)
  }

  console.log(`\nRecomputing ${Math.max(0, identities.size - skip.size)} resolved position(s) (full idempotent pass, self-healing any interrupted prior run)...`)
  for (const [key, id] of identities) {
    if (skip.has(key)) continue
    const { data, error: rpcErr } = await supabase.rpc('recompute_gateway_position', {
      p_address: id.address, p_pool_address: id.poolAddress, p_chain_id: id.chainId, p_position_manager: id.positionManager,
    })
    if (rpcErr) {
      console.error(`  FAILED to recompute ${key}: ${rpcErr.message} — this identity's history may still have gaps; re-run once resolved further.`)
      continue
    }
    console.log(`  ${key} → basis=${data?.[0]?.cost_basis_atomic} shares=${data?.[0]?.shares_atomic} (${data?.[0]?.event_count} events)`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
