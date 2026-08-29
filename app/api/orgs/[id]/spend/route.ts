// Treasury spend feed — the unified activity/reporting read. Merges the treasury_spend_events ledger
// (vendor pay + payroll) with card_swipe_events (cards) into one normalized feed, applies filters,
// and returns the page + rollups (by category / member / type) + a grand total, so a team can see and
// report on every spend. POST (signed-message auth needs a body), org-scoped, read-only.
//
// Visibility: owner + roles that can move treasury money (canPayVendors / canManageTreasury) see ALL
// org spend; everyone else sees only their own rows. RLS is deny-all on both tables — this server
// route reads them on the service-role client, never the browser.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'

export const dynamic = 'force-dynamic'
const FETCH_CAP = 2000 // rollups + feed computed over this many matching rows (ample at testnet volume)

interface UnifiedRow {
  id: string
  source: 'ledger' | 'card'
  spendType: string
  status: 'recorded' | 'settled' | 'failed'
  initiatedBy: string | null
  recipient: string | null
  amountAtomic: string
  category: string | null
  memo: string | null
  settled: boolean
  settleTx: string | null
  createdAt: string
}

const money = (v: unknown) => { const s = typeof v === 'string' ? v : null; return s ?? '0' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)
      const { caller, isOwner, policy } = auth
      const seesAll = isOwner || policy.canPayVendors || policy.canManageTreasury

      const body = await r.clone().json().catch(() => ({}))
      const f = {
        from: typeof body.from === 'string' ? body.from : null,
        to: typeof body.to === 'string' ? body.to : null,
        member: seesAll && typeof body.member === 'string' ? body.member.toLowerCase() : (seesAll ? null : caller),
        category: typeof body.category === 'string' ? body.category : null,
        spendType: typeof body.spendType === 'string' ? body.spendType : null,
        status: typeof body.status === 'string' ? body.status : null,
        search: typeof body.search === 'string' ? body.search.trim().toLowerCase() : '',
        limit: Math.min(Math.max(Number(body.limit) || 100, 1), 500),
        offset: Math.max(Number(body.offset) || 0, 0),
      }

      // ── Ledger rows (vendor pay + payroll) ──
      let lq = ctx.supabase
        .from('treasury_spend_events')
        .select('id, spend_type, status, initiated_by, to_wallet, amount_atomic_usdc, category, memo, settled, settle_tx, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
        .limit(FETCH_CAP)
      if (f.member) lq = lq.eq('initiated_by', f.member)
      if (f.from) lq = lq.gte('created_at', f.from)
      if (f.to) lq = lq.lte('created_at', f.to)

      // ── Card rows ──
      let cq = ctx.supabase
        .from('card_swipe_events')
        .select('id, member_wallet, amount_atomic_usdc, merchant_descriptor, decision, decline_reason, settled, settle_tx, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
        .limit(FETCH_CAP)
      if (f.member) cq = cq.eq('member_wallet', f.member)
      if (f.from) cq = cq.gte('created_at', f.from)
      if (f.to) cq = cq.lte('created_at', f.to)

      const [ledger, cards] = await Promise.all([lq, cq])
      if (ledger.error || cards.error) return ctx.json({ error: 'query_failed' }, 500)

      const ledgerRows: UnifiedRow[] = (ledger.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        source: 'ledger',
        spendType: row.spend_type as string,
        status: (row.status as UnifiedRow['status']) ?? 'recorded',
        initiatedBy: (row.initiated_by as string | null) ?? null,
        recipient: (row.to_wallet as string | null) ?? null,
        amountAtomic: money(row.amount_atomic_usdc),
        category: (row.category as string | null) ?? null,
        memo: (row.memo as string | null) ?? null,
        settled: !!row.settled,
        settleTx: (row.settle_tx as string | null) ?? null,
        createdAt: row.created_at as string,
      }))

      const cardRows: UnifiedRow[] = (cards.data ?? []).map((row: Record<string, unknown>) => {
        const declined = row.decision !== 'approved'
        return {
          id: row.id as string,
          source: 'card',
          spendType: 'card_swipe',
          status: declined ? 'failed' : row.settled ? 'settled' : 'recorded',
          initiatedBy: (row.member_wallet as string | null) ?? null,
          recipient: (row.merchant_descriptor as string | null) ?? null,
          amountAtomic: money(row.amount_atomic_usdc),
          category: 'Card',
          memo: declined ? (row.decline_reason as string | null) ?? 'declined' : null,
          settled: !!row.settled,
          settleTx: (row.settle_tx as string | null) ?? null,
          createdAt: row.created_at as string,
        }
      })

      // Merge + JS-side filters (category / spendType / status / search).
      let all = [...ledgerRows, ...cardRows]
      if (f.category) all = all.filter((x) => (x.category ?? '').toLowerCase() === f.category!.toLowerCase())
      if (f.spendType) all = all.filter((x) => x.spendType === f.spendType)
      if (f.status) all = all.filter((x) => x.status === f.status)
      if (f.search) all = all.filter((x) =>
        (x.recipient ?? '').toLowerCase().includes(f.search) ||
        (x.memo ?? '').toLowerCase().includes(f.search) ||
        (x.category ?? '').toLowerCase().includes(f.search) ||
        (x.initiatedBy ?? '').toLowerCase().includes(f.search))
      all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

      // Rollups over the full filtered set (exclude failed from money totals).
      const add = (m: Map<string, bigint>, k: string, v: string) => {
        try { m.set(k, (m.get(k) ?? 0n) + BigInt(v)) } catch { /* skip bad amount */ }
      }
      const byCategory = new Map<string, bigint>()
      const byMember = new Map<string, bigint>()
      const byType = new Map<string, bigint>()
      let grand = 0n
      for (const x of all) {
        if (x.status === 'failed') continue
        add(byCategory, x.category ?? 'Uncategorized', x.amountAtomic)
        add(byMember, x.initiatedBy ?? 'unknown', x.amountAtomic)
        add(byType, x.spendType, x.amountAtomic)
        try { grand += BigInt(x.amountAtomic) } catch { /* skip */ }
      }
      const dump = (m: Map<string, bigint>) => Array.from(m.entries())
        .map(([k, v]) => ({ key: k, amountAtomic: v.toString() }))
        .sort((a, b) => (BigInt(a.amountAtomic) < BigInt(b.amountAtomic) ? 1 : -1))

      const page = all.slice(f.offset, f.offset + f.limit)
      return ctx.json({
        rows: page,
        total: { count: all.length, sumAtomic: grand.toString() },
        rollups: { byCategory: dump(byCategory), byMember: dump(byMember), byType: dump(byType) },
        seesAll,
      })
    },
    { auth: 'signed-message', action: 'mintware-org-spend' },
  )(req)
}
