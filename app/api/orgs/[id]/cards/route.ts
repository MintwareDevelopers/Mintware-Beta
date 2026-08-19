// Org cards — issue a sandbox Lithic virtual card to an active org member, or list the org's cards.
// This is the backend for the "+ Issue card" button on app/app/team/cards/page.tsx, which has
// shipped disabled since that page landed ("Card issuance needs the CPN card issuer — coming
// soon"). Sandbox only: real production issuance is a separate KYB-gated Lithic tier, not a config
// flip — see .claude/rules/payments-ypn.md for the honesty posture this repeats everywhere else.
//
// POST /api/orgs/:id/cards  { memberWallet }  — owner-only (issuing a card is treasury management,
//                                                same bucket as recording/funding the treasury).
// GET  /api/orgs/:id/cards                     — any active member (own org's card list only).

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { issueSandboxVirtualCard, lithicConfigured } from '@/lib/cards/lithic'
import { policyForRole } from '@/lib/org/rolePresets'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[a-fA-F0-9]{40}$/

async function requireActiveCaller(ctx: { supabase: any; user?: { address: string } }, orgId: string) {
  const caller = ctx.user!.address.toLowerCase()
  const { data: org } = await ctx.supabase.from('orgs').select('id, owner_wallet').eq('id', orgId).single()
  if (!org) return { error: 'org not found' as const, status: 404 as const }
  const isOwner = org.owner_wallet.toLowerCase() === caller
  if (isOwner) return { org, caller, isOwner, policy: policyForRole('owner') }
  const { data: mem } = await ctx.supabase
    .from('org_members').select('role, status').eq('org_id', orgId).eq('wallet', caller).maybeSingle()
  if (!mem || mem.status !== 'active') return { error: 'not an active member of this org' as const, status: 403 as const }
  return { org, caller, isOwner, policy: policyForRole(mem.role) }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      if (!lithicConfigured()) {
        return ctx.json({ ok: false, gated: 'lithic_unconfigured', message: 'LITHIC_API_KEY not set.' }, 503)
      }
      const body = await r.clone().json().catch(() => ({}))
      const memberWallet = String(body.memberWallet ?? '').toLowerCase()
      if (!EVM_RE.test(memberWallet)) return ctx.json({ error: 'valid memberWallet required' }, 400)

      const auth = await requireActiveCaller(ctx, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)
      if (!auth.policy.canManageTreasury) {
        return ctx.json({ error: `role "${auth.policy.label}" cannot issue cards — owner only` }, 403)
      }

      // The card's holder must themselves be an active member with spend capability (a card issued
      // to a vendor/receive-only role can never authorize — decideCardSwipe would decline every
      // swipe anyway, but reject at issuance time so the UI doesn't show a card that can't spend).
      const { data: holder } = await ctx.supabase
        .from('org_members').select('role, status').eq('org_id', id).eq('wallet', memberWallet).maybeSingle()
      const holderIsOwner = auth.org.owner_wallet.toLowerCase() === memberWallet
      if (!holderIsOwner) {
        if (!holder || holder.status !== 'active') return ctx.json({ error: 'memberWallet is not an active member' }, 404)
        if (policyForRole(holder.role).dailyCapUsdc === 0n) {
          return ctx.json({ error: 'this role is receive-only and cannot hold a spend card' }, 422)
        }
      }

      let card
      try {
        card = await issueSandboxVirtualCard({ memo: `${auth.org.id.slice(0, 8)}:${memberWallet.slice(0, 8)}` })
      } catch (e) {
        ctx.log.error('cards.lithic', 'issuance failed', { error: String(e) })
        return ctx.json({ ok: false, error: 'card_issuance_failed' }, 502)
      }

      const { data: row, error: insertErr } = await ctx.supabase
        .from('org_cards')
        .insert({
          org_id: id,
          member_wallet: memberWallet,
          provider: 'lithic',
          provider_card_token: card.token,
          last_four: card.lastFour,
          card_type: 'VIRTUAL',
          state: card.state,
          issued_by: auth.caller,
        })
        .select('id, last_four, state, card_type, created_at')
        .single()
      if (insertErr) return ctx.json({ ok: false, error: 'card_row_insert_failed', detail: insertErr.message }, 500)

      return ctx.json({ ok: true, card: { ...row, memberWallet, provider: 'lithic' } })
    },
    { auth: 'signed-message', action: 'mintware-org-card-issue' },
  )(req)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (_r, ctx) => {
      const auth = await requireActiveCaller(ctx, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)

      const { data, error } = await ctx.supabase
        .from('org_cards')
        .select('id, member_wallet, provider, last_four, card_type, state, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
      if (error) return ctx.json({ error: 'query_failed' }, 500)
      return ctx.json({ cards: data ?? [] })
    },
    { auth: 'signed-message', action: 'mintware-org-cards-list' },
  )(req)
}
