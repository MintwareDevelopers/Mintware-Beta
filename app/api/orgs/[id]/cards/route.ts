// Issue a sandbox Lithic virtual card to an active org member. This is the backend for the
// "+ Issue card" button on app/app/team/cards/page.tsx, which has shipped disabled since that page
// landed ("Card issuance needs the CPN card issuer — coming soon"). Sandbox only: real production
// issuance is a separate KYB-gated Lithic tier, not a config flip — see .claude/rules/payments-ypn.md
// for the honesty posture this repeats everywhere else.
//
// POST /api/orgs/:id/cards  { memberWallet }  — owner-only (issuing a card is treasury management,
//                                                same bucket as recording/funding the treasury).
// List lives at POST /api/orgs/:id/cards/list (see that route) — a separate file, not GET, because
// signed-message auth needs a body and a browser fetch() GET can't carry one (same convention the
// members roster route already uses).

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { issueSandboxVirtualCard, lithicConfigured } from '@/lib/cards/lithic'
import { policyForRole } from '@/lib/org/rolePresets'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[a-fA-F0-9]{40}$/

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

      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
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
          sandbox_pan: card.pan, // sandbox-only synthetic PAN — see migration 20260819000003 header
        })
        .select('id, last_four, state, card_type, created_at, activated_at')
        .single()
      if (insertErr) return ctx.json({ ok: false, error: 'card_row_insert_failed', detail: insertErr.message }, 500)

      return ctx.json({ ok: true, card: { ...row, memberWallet, provider: 'lithic' } })
    },
    { auth: 'signed-message', action: 'mintware-org-card-issue' },
  )(req)
}
