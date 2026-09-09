// ROUND-3 EXPLOIT REPLAY — Supabase RLS with the PUBLIC anon key (the key every browser visitor holds).
// Incident class: "Supabase RLS not enabled / view bypasses RLS" leaks (Spoutible 2024, dozens of
// indie-app disclosures in 2023-25). Live, READ-ONLY probe against the real project. Inserts are attempted
// ONLY because RLS must reject them — that rejection is the assertion. Self-skips unless AUDIT_LIVE=1 and
// the two public env vars are present. Never prints the URL or the key.
//
// 2026-09-08 result (recorded in docs/developers/audits/round3/exploit-replay-offchain.md):
//   every gateway TABLE: SELECT → 200 with 0 rows, INSERT → 401 42501 (RLS) — deny-all holds
//   gateway_fee_balances / gateway_fee_ledger_reconciliation VIEWS: SELECT → 200 (queryable by anon; empty today)
//   record_gateway_harvest RPC: callable by anon (EXECUTE granted to PUBLIC), insert inside → 401 42501
//   gateway_alerts, card_spend_buffers: 404 PGRST205 (tables absent in prod — migration not applied)
//   storage: anon list avatars → 200 [], anon upload → 403 RLS
//
// 2026-09-09 re-probe (round-4 audit, docs/developers/audits/round4/) — CONFIRMED STILL LIVE: the fix for
// this (supabase/migrations/20260908000003_gateway_ledger_view_security.sql — security_invoker + REVOKE on
// the two views, REVOKE EXECUTE on record_gateway_harvest) is correct and merged to main (commit debe2c73)
// but was NEVER EXECUTED against the production database — same live result as 2026-09-08, re-confirmed.
// The two tests below used to assert the VULNERABLE state (200 / anon-callable) as the expected PASSING
// result — i.e. they would keep passing even after the fix regressed. FLIPPED to assert the FIXED state
// instead: they will genuinely FAIL until an operator actually applies the migration to prod (`supabase db
// push`, or paste its ALTER VIEW/REVOKE statements into the Supabase SQL editor), which is the correct
// signal — a red test here means the fix is not live, not a broken test.
import { describe, it, expect } from 'vitest'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const LIVE = process.env.AUDIT_LIVE === '1' && !!URL_ && !!ANON

const TABLES = [
  'gateway_instances', 'gateway_instance_history', 'gateway_positions', 'gateway_deposit_events', 'gateway_deploy_events',
  'harvest_events', 'gateway_pool_requests', 'gateway_position_snapshots', 'gateway_harvest_logs', 'gateway_fee_credits',
  'gateway_fee_payouts', 'gateway_known_depositors', 'gateway_index_cursors',
]
const VIEWS = ['gateway_fee_balances', 'gateway_fee_ledger_reconciliation']

describe.skipIf(!LIVE)('anon-key RLS probe (live, read-only)', () => {
  const H = { apikey: ANON!, authorization: `Bearer ${ANON}` }

  it('every gateway table: SELECT yields zero rows and INSERT is refused by RLS (42501)', async () => {
    for (const t of TABLES) {
      const s = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=3`, { headers: { ...H, prefer: 'count=exact' } })
      expect([200, 404]).toContain(s.status)
      if (s.status === 200) expect(((await s.json()) as unknown[]).length).toBe(0)
      const i = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ chain_id: 46630 }) })
      expect([401, 403, 404]).toContain(i.status)
    }
  })

  it('FIXED (once the migration is applied): the two ledger views must be unreadable by anon (security_invoker + grants revoked)', async () => {
    for (const v of VIEWS) {
      const s = await fetch(`${URL_}/rest/v1/${v}?select=*&limit=3`, { headers: H })
      // Pre-fix (live today, 2026-09-09): 200 — the vulnerable state. This assertion is intentionally the
      // FIXED expectation, not the observed one — it fails until an operator applies the migration.
      expect([401, 403]).toContain(s.status)
    }
  })

  it('FIXED (once the migration is applied): record_gateway_harvest must be refused at the EXECUTE-grant level, not just RLS inside it', async () => {
    const p_log = { chain_id: 46630, tx_hash: '0x' + 'ab'.repeat(32), log_index: 0, block_number: 1, position_manager: '0x' + '11'.repeat(20), pool_address: '0x' + '22'.repeat(32), quote_fees_atomic: '1', paired_fees_atomic: '0', recipient: '0x' + '33'.repeat(20), total_shares_at_block: '1', perf_fee_bps: 0, fee_skimmed_atomic: '0', net_quote_atomic: '1' }
    const r = await fetch(`${URL_}/rest/v1/rpc/record_gateway_harvest`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ p_log, p_credits: [], p_settlement: 'pending' }) })
    // Pre-fix (live today): 401 with a row-level-security message — the function EXECUTED and only the
    // table's RLS stopped the write. Post-fix: EXECUTE itself is revoked, so this should fail BEFORE the
    // function body ever runs, with a "permission denied for function" message instead.
    expect([401, 403]).toContain(r.status)
    expect(await r.text()).toMatch(/permission denied for function/)
  })

  it('storage: anon cannot upload into avatars', async () => {
    const up = await fetch(`${URL_}/storage/v1/object/avatars/0x${'00'.repeat(20)}/audit-probe.png`, { method: 'POST', headers: { ...H, 'content-type': 'image/png' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) })
    expect([400, 403]).toContain(up.status)
  })
})
