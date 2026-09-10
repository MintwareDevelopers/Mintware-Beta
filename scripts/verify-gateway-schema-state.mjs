// Read-only production schema verification (user directive, 2026-09-10 — "release verification: deployed
// configuration and migrations checked"). Confirms whether the LP-gateway RPCs/tables this session's work
// depends on (migrations 20260909000004 through 20260909000007) actually exist in a real Supabase project,
// WITHOUT ever mutating anything and without this script (or the session that wrote it) ever seeing the
// credential's value — it reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment
// the OPERATOR runs it in, exactly like every other script in this repo (scripts/verify-gateway-pm-attribution.mjs,
// scripts/deploy-lp-gateway-*.mjs) — never hardcoded, never logged, never printed.
//
// How it checks existence without a raw Postgres connection (this script only has the same REST/PostgREST
// access the app itself has — no direct DB credential, no information_schema access): it calls each RPC
// with a harmless probe payload (a dummy chain id / null-shaped args that can never match a real row) and
// a table select with `.limit(0)` (fetches zero rows, no data ever leaves the database), then classifies
// PostgREST's own error code — `PGRST202`/`PGRST205`-style "function/relation not found in schema cache"
// means MISSING; any other error (or a clean empty success) means the function/table/column DOES exist.
// Never writes, never deletes, never reads real row contents beyond the harmless existence probe.
//
// Usage:
//   node --env-file=.env.local scripts/verify-gateway-schema-state.mjs

import { createServerClient } from '@supabase/ssr'
import { pathToFileURL } from 'node:url'

// A PostgREST "missing" signature — function/relation genuinely not found in the schema cache. Anything
// else (a type-mismatch error, a real data error, or a clean success) proves the object DOES exist, even
// if this specific probe call itself doesn't succeed cleanly. Exported (mirrors
// scripts/verify-gateway-pm-attribution.mjs's own pattern) so this classification is unit-testable
// without a live Supabase project — a wrong classification here would silently invert this whole report.
export function looksMissing(error) {
  if (!error) return false
  const code = String(error.code ?? '')
  const msg = String(error.message ?? '').toLowerCase()
  return code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01'
    || msg.includes('could not find the function') || msg.includes('does not exist') || msg.includes('schema cache')
}

export async function checkFunction(supabase, name, args) {
  const { error } = await supabase.rpc(name, args)
  const missing = looksMissing(error)
  return { name, kind: 'function', present: !missing, detail: error ? `${error.code ?? ''} ${error.message ?? ''}`.trim() : 'callable (no error)' }
}

export async function checkColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(0)
  const missing = looksMissing(error)
  return { name: `${table}.${column}`, kind: 'column', present: !missing, detail: error ? `${error.code ?? ''} ${error.message ?? ''}`.trim() : 'selectable (no error)' }
}

// Dummy identity that can never collide with a real row — chain_id 999999999 is the exact convention this
// repo's own probe scripts already use elsewhere (see the round-4 audit memory's live-verification notes).
const PROBE = { address: '0x0000000000000000000000000000000000000000dead', pool: '0x' + 'de'.repeat(32), chain: 999999999 }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them (e.g. via --env-file=.env.local) and re-run.')
    process.exit(1)
  }
  const supabase = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } })

  console.log('Read-only LP-gateway schema verification — checking migrations 20260909000004 through 20260909000007\n')
  const results = []

  // _004: derived-shares columns on gateway_deposit_events
  results.push(await checkColumn(supabase, 'gateway_deposit_events', 'block_number'))
  results.push(await checkColumn(supabase, 'gateway_deposit_events', 'shares_burned'))

  // _005: manager-generation columns + the two record RPCs (current 10-arg signatures)
  results.push(await checkColumn(supabase, 'gateway_deposit_events', 'position_manager'))
  results.push(await checkColumn(supabase, 'gateway_deposit_events', 'tx_index'))
  results.push(await checkColumn(supabase, 'gateway_deposit_events', 'shares_minted'))
  results.push(await checkColumn(supabase, 'gateway_positions', 'position_manager'))
  results.push(await checkFunction(supabase, 'record_gateway_deposit_event', {
    p_tx_hash: 'schema-probe-deposit', p_address: PROBE.address, p_pool_address: PROBE.pool, p_chain_id: PROBE.chain,
    p_quote_in: 0, p_on_chain_shares: 0, p_block_number: null, p_position_manager: null, p_tx_index: null, p_shares_minted: null,
  }))
  results.push(await checkFunction(supabase, 'record_gateway_withdraw_event', {
    p_tx_hash: 'schema-probe-withdraw', p_address: PROBE.address, p_pool_address: PROBE.pool, p_chain_id: PROBE.chain,
    p_quote_out: 0, p_on_chain_shares: 0, p_shares_burned: 0, p_block_number: null, p_position_manager: null, p_tx_index: null,
  }))

  // _006: recompute_gateway_position
  results.push(await checkFunction(supabase, 'recompute_gateway_position', {
    p_address: PROBE.address, p_pool_address: PROBE.pool, p_chain_id: PROBE.chain, p_position_manager: '0x' + 'ee'.repeat(20),
  }))

  // _007: apply_gateway_pm_attribution + the new issues table
  results.push(await checkFunction(supabase, 'apply_gateway_pm_attribution', {
    p_event_id: '00000000-0000-0000-0000-000000000000', p_position_manager: '0x' + 'ee'.repeat(20),
    p_block_number: 0, p_tx_index: 0, p_shares_minted: null, p_shares_burned: null,
  }))
  results.push(await checkColumn(supabase, 'gateway_position_recompute_issues', 'reason'))

  console.log('Result'.padEnd(10), 'Object'.padEnd(45), 'Detail')
  console.log('-'.repeat(10), '-'.repeat(45), '-'.repeat(30))
  for (const r of results) {
    console.log((r.present ? '✅ FOUND' : '❌ MISSING').padEnd(10), r.name.padEnd(45), r.detail)
  }

  const missing = results.filter((r) => !r.present)
  console.log(`\n${results.length - missing.length} / ${results.length} present.`)
  if (missing.length) {
    console.log(`\n${missing.length} object(s) not found — the corresponding migration(s) are likely NOT applied to this project yet:`)
    for (const m of missing) console.log(`  - ${m.name}`)
    console.log('\nCross-reference against .claude/rules/lp-gateway.md\'s migration list to see which numbered migration(s) each missing object belongs to, and apply them via the Supabase SQL editor before relying on that functionality in production.')
  } else {
    console.log('\nEverything checked is present. This does not prove the SQL logic is CORRECT (see costBasisRpc.pglite.test.ts / .concurrency.test.ts for that) — only that these migrations have been applied to this specific project.')
  }
}

// pathToFileURL, not a naive `file://${...}` template — this repo's own absolute path contains spaces
// ("Mintware Phase 1 app Build"), which broke an earlier script's identical check this same session
// (scripts/verify-gateway-pm-attribution.mjs) in exactly this way; use the fixed pattern from day one here.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
