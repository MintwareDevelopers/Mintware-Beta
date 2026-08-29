// Pay from the org treasury (#4 pay-a-vendor + #5 batch payroll — one route, one or many legs).
// Validates the caller's role cap (belt, now CUMULATIVE per day) + the treasury's on-chain headroom
// (suspenders), RECORDS every leg to the unified spend ledger (treasury_spend_events), then returns
// the recorded plan. Teams can see + report on every payment from the ledger.
//
// NOTE (settlement): the on-chain per-recipient settlement of these legs — burning treasury shares to
// each vendor via settleSpend — is the NEXT milestone (money-movement, needs the treasury spend-permit
// design + external audit; deploy-gated). Until then, legs are recorded with status 'recorded'
// (initiated, settlement pending); a later settle path stamps them 'settled' on receipt.status===success
// (see lib/treasury/spendLog.ts#markSpendSettled). The previous version POSTed these legs to the
// relayer's /settle-batch, which is an ETH-collateral batch swap (batchSettleEth) that never pays the
// recipients — that incorrect wiring is removed here.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { makeTreasuryReader, rpcForChain } from '@/lib/org/treasuryReader'
import { policyForRole, withinDailyCap } from '@/lib/org/rolePresets'
import { recordSpendEvents, spentTodayAtomic, type SpendRow } from '@/lib/treasury/spendLog'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[a-fA-F0-9]{40}$/
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) || null : null)

interface Leg { to: string; amountUsdc: string; chainId?: number; category?: string; memo?: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const body = await r.clone().json().catch(() => ({}))
      const legs: Leg[] = Array.isArray(body.payments) ? body.payments : []
      if (legs.length === 0) return ctx.json({ error: 'payments[] required' }, 400)
      if (legs.length > 500) return ctx.json({ error: 'max 500 legs per batch' }, 400)
      // Batch-level category/memo (applied to every leg unless the leg overrides).
      const batchCategory = clip(body.category, 80)
      const batchMemo = clip(body.memo, 280)

      // Parse + validate legs.
      let total = 0n
      for (const [i, leg] of legs.entries()) {
        if (!EVM_RE.test(String(leg.to ?? ''))) return ctx.json({ error: `leg ${i}: invalid recipient` }, 400)
        let amt: bigint
        try { amt = BigInt(leg.amountUsdc) } catch { return ctx.json({ error: `leg ${i}: invalid amountUsdc (atomic 6dp)` }, 400) }
        if (amt <= 0n) return ctx.json({ error: `leg ${i}: amount must be > 0` }, 400)
        total += amt
      }

      // Org + caller membership.
      const { data: org } = await ctx.supabase
        .from('orgs').select('id, owner_wallet, treasury_vault_address, treasury_chain_id').eq('id', id).single()
      if (!org) return ctx.json({ error: 'org not found' }, 404)
      if (!org.treasury_vault_address || !org.treasury_chain_id) return ctx.json({ error: 'treasury not set up yet' }, 409)

      const caller = ctx.user!.address.toLowerCase()
      const isOwner = org.owner_wallet.toLowerCase() === caller
      const { data: mem } = await ctx.supabase
        .from('org_members').select('role, status').eq('org_id', id).eq('wallet', caller).maybeSingle()
      const role = isOwner ? 'owner' : (mem?.role ?? null)
      const policy = policyForRole(role)
      if (!isOwner && (!mem || mem.status !== 'active')) return ctx.json({ error: 'not an active member of this org' }, 403)
      if (!policy.canPayVendors) return ctx.json({ error: `role "${policy.label}" cannot pay from the treasury` }, 403)

      // Belt: CUMULATIVE daily cap — this batch's total PLUS what the caller already spent today
      // (from the ledger) must fit under the cap. Owner (null cap) always passes.
      const spentToday = await spentTodayAtomic(org.id, caller)
      if (!withinDailyCap(policy, total, spentToday)) {
        return ctx.json({
          error: 'over your daily cap', cap: policy.dailyCapUsdc?.toString() ?? null,
          spentToday: spentToday.toString(), requested: total.toString(),
        }, 403)
      }

      // Suspenders: the treasury must actually hold enough (on-chain NAV headroom).
      const reader = makeTreasuryReader({ rpcUrl: rpcForChain(org.treasury_chain_id)!, vault: org.treasury_vault_address })
      let navUsdc: bigint
      try { navUsdc = (await reader.snapshot()).navUsdc } catch { return ctx.json({ error: 'treasury_read_failed' }, 502) }
      if (total > navUsdc) return ctx.json({ error: 'insufficient treasury balance', available: navUsdc.toString(), requested: total.toString() }, 409)

      // Record every leg to the unified ledger. Payroll (>1 leg) shares a batch_id; single pay = one row.
      const isPayroll = legs.length > 1
      const batchId = isPayroll ? crypto.randomUUID() : null
      const rows: SpendRow[] = legs.map((l) => ({
        orgId: org.id,
        spendType: isPayroll ? 'payroll' : 'vendor_pay',
        toWallet: l.to,
        amountAtomicUsdc: BigInt(l.amountUsdc).toString(),
        provider: 'treasury',
        batchId,
        initiatedBy: caller,
        initiatorRole: role,
        fromWallet: org.treasury_vault_address,
        chainId: l.chainId ?? org.treasury_chain_id,
        category: clip(l.category, 80) ?? batchCategory,
        memo: clip(l.memo, 280) ?? batchMemo,
        status: 'recorded',
      }))
      const recorded = await recordSpendEvents(rows)

      const plan = {
        vault: org.treasury_vault_address,
        chainId: org.treasury_chain_id,
        batchId,
        legs: rows.map((row) => ({ to: row.toWallet, amountUsdc: row.amountAtomicUsdc, chainId: row.chainId })),
        totalUsdc: total.toString(),
      }

      // Recorded. On-chain settlement (per-recipient settleSpend) is the next milestone — see file header.
      return ctx.json({
        ok: true,
        status: 'recorded',
        settlement: 'pending',
        recorded,
        count: rows.length,
        plan,
        message: isPayroll
          ? `Recorded ${rows.length} payments. On-chain settlement is enabled with the treasury settle path (coming with mainnet).`
          : 'Recorded. On-chain settlement is enabled with the treasury settle path (coming with mainnet).',
      })
    },
    { auth: 'signed-message', action: 'mintware-org-pay' },
  )(req)
}
