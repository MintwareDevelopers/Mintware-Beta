// Read-only production schema verification (user directive, 2026-09-10 — "release verification: deployed
// configuration and migrations checked").
//
// REWRITTEN same-day after Codex's live review caught two serious defects in the first version:
//   P1 — "claimed read-only verification actually writes." The original design checked function
//        existence by CALLING record_gateway_deposit_event/record_gateway_withdraw_event/
//        apply_gateway_pm_attribution with a "harmless dummy identity" — but these functions perform
//        REAL INSERTs (record_gateway_deposit_event genuinely does `INSERT INTO gateway_deposit_events
//        ... RETURNING id`, no dry-run mode). A dummy tx_hash/chain_id prevents a COLLISION with real
//        rows, not the INSERT itself. Reproduced live: this actually created 2 gateway_deposit_events
//        rows and 1 gateway_positions row against real migrations. This directly contradicted the
//        script's own "never mutates anything" claim.
//   P2 — "unrelated errors produce false FOUND." The original looksMissing() classified ANY error that
//        wasn't a recognized "not found" code as proof of existence — so an auth failure (expired JWT,
//        wrong key, revoked credential — PGRST301, 401, etc.) was silently reported as "✅ FOUND" for
//        every single check, meaning a completely broken connection could produce an all-green report.
//
// Fixed by switching to GENUINE schema introspection instead of execution: PostgREST serves a full
// OpenAPI (Swagger 2.0) description of the exposed schema on a single GET to the REST root — `paths`
// lists `/rpc/<function>` for every exposed function and `/<table>` for every exposed table;
// `definitions.<table>.properties` lists every column. This is ONE plain read (no execution of anything,
// ever) and turns every subsequent existence check into a pure, zero-risk JSON lookup — structurally
// eliminating the per-check ambiguous-error problem, not just special-casing it. The one network call
// that CAN fail (the initial schema fetch) is classified as `unknown` — distinct from both `present` and
// `missing` — and the whole script exits non-zero rather than printing a falsely reassuring report.
//
// Also corrected an overstated claim Codex flagged: an object being present in the schema proves it is
// EXPOSED to this role, not that its current body/constraints/RLS policy match what's in this repo today
// (a function can be redefined in place — this session did that repeatedly — without its name or
// PostgREST-visible signature changing). Report presence only; this is not proof of correct behavior
// (see costBasisRpc.pglite.test.ts / .concurrency.test.ts for that) or of a specific migration version.
//
// Usage:
//   node --env-file=.env.local scripts/verify-gateway-schema-state.mjs

import { pathToFileURL } from 'node:url'

/** ONE plain GET against the PostgREST root — the only network call this script ever makes, and the only
 *  point where anything can go wrong (auth, network, an unparsable response). Never executes a function,
 *  never selects a row. Returns `{ ok: true, schema }` or `{ ok: false, reason }` — callers must treat
 *  `ok: false` as "verification impossible," never as "everything is missing." */
export async function fetchOpenApiSchema(url, key, fetchImpl = fetch) {
  let res
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    })
  } catch (e) {
    return { ok: false, reason: `network error: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status} ${res.statusText} — likely an auth/permission failure, not evidence of a missing object` }
  }
  let schema
  try {
    schema = await res.json()
  } catch (e) {
    return { ok: false, reason: `response was not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!schema || typeof schema !== 'object' || !schema.paths) {
    return { ok: false, reason: 'response did not look like a PostgREST OpenAPI document (missing "paths")' }
  }
  return { ok: true, schema }
}

/** Pure, zero-risk lookups against an already-fetched schema — no network, no execution, cannot fail. */
export function hasFunction(schema, name) {
  return Object.prototype.hasOwnProperty.call(schema.paths ?? {}, `/rpc/${name}`)
}
export function hasTable(schema, table) {
  return Object.prototype.hasOwnProperty.call(schema.definitions ?? {}, table)
    || Object.prototype.hasOwnProperty.call(schema.paths ?? {}, `/${table}`)
}
export function hasColumn(schema, table, column) {
  const props = schema.definitions?.[table]?.properties
  return !!props && Object.prototype.hasOwnProperty.call(props, column)
}

const CHECKS = [
  { migration: '_004', kind: 'column', table: 'gateway_deposit_events', name: 'block_number' },
  { migration: '_004', kind: 'column', table: 'gateway_deposit_events', name: 'shares_burned' },
  { migration: '_005', kind: 'column', table: 'gateway_deposit_events', name: 'position_manager' },
  { migration: '_005', kind: 'column', table: 'gateway_deposit_events', name: 'tx_index' },
  { migration: '_005', kind: 'column', table: 'gateway_deposit_events', name: 'shares_minted' },
  { migration: '_005', kind: 'column', table: 'gateway_positions', name: 'position_manager' },
  { migration: '_005', kind: 'function', name: 'record_gateway_deposit_event' },
  { migration: '_005', kind: 'function', name: 'record_gateway_withdraw_event' },
  { migration: '_006', kind: 'function', name: 'recompute_gateway_position' },
  { migration: '_007', kind: 'function', name: 'apply_gateway_pm_attribution' },
  { migration: '_007', kind: 'table', name: 'gateway_position_recompute_issues' },
]

/** Runs every check against an already-fetched schema — exported so the report-building logic is
 *  testable without a network call at all (only fetchOpenApiSchema needs a live/fake fetch). */
export function runChecks(schema) {
  return CHECKS.map((c) => {
    const present = c.kind === 'function' ? hasFunction(schema, c.name)
      : c.kind === 'table' ? hasTable(schema, c.name)
        : hasColumn(schema, c.table, c.name)
    const label = c.kind === 'column' ? `${c.table}.${c.name}` : c.name
    return { ...c, label, present }
  })
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them (e.g. via --env-file=.env.local) and re-run.')
    process.exit(1)
  }

  console.log('Read-only LP-gateway schema verification (genuine schema introspection — no execution, no writes)\n')
  const fetched = await fetchOpenApiSchema(url, key)
  if (!fetched.ok) {
    console.error(`Could NOT verify: ${fetched.reason}`)
    console.error('This is a verification failure, not evidence that anything is missing — fix the connection/credential and re-run.')
    process.exit(1)
  }

  const results = runChecks(fetched.schema)
  console.log('Result'.padEnd(10), 'Migration'.padEnd(11), 'Object')
  console.log('-'.repeat(10), '-'.repeat(11), '-'.repeat(45))
  for (const r of results) {
    console.log((r.present ? '✅ FOUND' : '❌ MISSING').padEnd(10), r.migration.padEnd(11), r.label)
  }

  const missing = results.filter((r) => !r.present)
  console.log(`\n${results.length - missing.length} / ${results.length} present.`)
  if (missing.length) {
    console.log(`\nMigration(s) likely NOT applied to this project: ${[...new Set(missing.map((m) => m.migration))].join(', ')}`)
    for (const m of missing) console.log(`  - ${m.label}`)
    console.log('\nApply the missing migration(s) via the Supabase SQL editor — see .claude/rules/lp-gateway.md for the full list and deploy-ordering notes.')
    process.exit(1)
  }
  console.log('\nEvery checked object is exposed in this project\'s schema. This confirms PRESENCE, not correctness or an exact')
  console.log('migration version — a function can be redefined in place without its name/signature changing, and this check')
  console.log('cannot see RLS policies, constraints, or a function\'s actual body. It does not prove the SQL logic is correct')
  console.log('(see lib/gateway/costBasisRpc.pglite.test.ts / .concurrency.test.ts for that).')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
