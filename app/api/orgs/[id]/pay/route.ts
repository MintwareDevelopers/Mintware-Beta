// Pay from the org treasury (#4 pay-a-vendor + #5 batch payroll — one route, one or many payments).
// Validates the caller's role cap (belt) + the treasury's on-chain headroom (suspenders), then settles
// via the relayer if configured, else returns 503 with the validated plan (relayer is deploy-gated —
// same posture as the x402 settle route). NOT a netting/clearing engine — one settlement of N legs.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { makeTreasuryReader, rpcForChain } from '@/lib/org/treasuryReader'
import { policyForRole, withinDailyCap } from '@/lib/org/rolePresets'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[a-fA-F0-9]{40}$/

interface Leg { to: string; amountUsdc: string; chainId?: number }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const body = await r.clone().json().catch(() => ({}))
      const legs: Leg[] = Array.isArray(body.payments) ? body.payments : []
      if (legs.length === 0) return ctx.json({ error: 'payments[] required' }, 400)
      if (legs.length > 500) return ctx.json({ error: 'max 500 legs per batch' }, 400)

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
      const policy = policyForRole(isOwner ? 'owner' : mem?.role)
      if (!isOwner && (!mem || mem.status !== 'active')) return ctx.json({ error: 'not an active member of this org' }, 403)
      if (!policy.canPayVendors) return ctx.json({ error: `role "${policy.label}" cannot pay from the treasury` }, 403)

      // Belt: caller's daily cap. (A production system also tracks spentToday; MVP checks this batch total.)
      if (!withinDailyCap(policy, total)) {
        return ctx.json({ error: 'over your daily cap', cap: policy.dailyCapUsdc?.toString() ?? null, requested: total.toString() }, 403)
      }

      // Suspenders: the treasury must actually hold enough (on-chain NAV headroom).
      const reader = makeTreasuryReader({ rpcUrl: rpcForChain(org.treasury_chain_id)!, vault: org.treasury_vault_address })
      let navUsdc: bigint
      try { navUsdc = (await reader.snapshot()).navUsdc } catch { return ctx.json({ error: 'treasury_read_failed' }, 502) }
      if (total > navUsdc) return ctx.json({ error: 'insufficient treasury balance', available: navUsdc.toString(), requested: total.toString() }, 409)

      const plan = {
        vault: org.treasury_vault_address,
        chainId: org.treasury_chain_id,
        legs: legs.map((l) => ({ to: l.to.toLowerCase(), amountUsdc: BigInt(l.amountUsdc).toString(), chainId: l.chainId ?? org.treasury_chain_id })),
        totalUsdc: total.toString(),
      }

      // Live settle is gated on the relayer HTTP surface (deploy-gated). When unset, return the validated
      // plan with 503 so the UI can show "ready to settle — relayer not configured on testnet".
      if (!process.env.X402_RELAYER_URL || !process.env.X402_RELAYER_SECRET) {
        return ctx.json({ ok: false, gated: 'relayer_not_configured', message: 'Payment validated. Live settlement needs the relayer (deploy-gated on testnet).', plan }, 503)
      }

      try {
        const res = await fetch(`${process.env.X402_RELAYER_URL.replace(/\/$/, '')}/settle-batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.X402_RELAYER_SECRET}` },
          body: JSON.stringify(plan),
        })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) return ctx.json({ ok: false, gated: 'relayer_error', detail: out }, 502)
        return ctx.json({ ok: true, plan, result: out })
      } catch (e) {
        return ctx.json({ ok: false, gated: 'relayer_unreachable', detail: String(e) }, 502)
      }
    },
    { auth: 'signed-message', action: 'mintware-org-pay' },
  )(req)
}
