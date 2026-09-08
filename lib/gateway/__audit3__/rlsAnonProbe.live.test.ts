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

  it('FINDING: the two ledger views are queryable by anon (no security_invoker) — they will expose the fee ledger once populated', async () => {
    for (const v of VIEWS) {
      const s = await fetch(`${URL_}/rest/v1/${v}?select=*&limit=3`, { headers: H })
      expect(s.status).toBe(200) // ← should be 401/403 or the view should be security_invoker + grants revoked
    }
  })

  it('record_gateway_harvest is anon-callable; RLS inside stops the write (defense in depth holds, exposure is unnecessary)', async () => {
    const p_log = { chain_id: 46630, tx_hash: '0x' + 'ab'.repeat(32), log_index: 0, block_number: 1, position_manager: '0x' + '11'.repeat(20), pool_address: '0x' + '22'.repeat(32), quote_fees_atomic: '1', paired_fees_atomic: '0', recipient: '0x' + '33'.repeat(20), total_shares_at_block: '1', perf_fee_bps: 0, fee_skimmed_atomic: '0', net_quote_atomic: '1' }
    const r = await fetch(`${URL_}/rest/v1/rpc/record_gateway_harvest`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ p_log, p_credits: [], p_settlement: 'pending' }) })
    expect([401, 403]).toContain(r.status)
    expect(await r.text()).toMatch(/row-level security/)
  })

  it('storage: anon cannot upload into avatars', async () => {
    const up = await fetch(`${URL_}/storage/v1/object/avatars/0x${'00'.repeat(20)}/audit-probe.png`, { method: 'POST', headers: { ...H, 'content-type': 'image/png' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) })
    expect([400, 403]).toContain(up.status)
  })
})
