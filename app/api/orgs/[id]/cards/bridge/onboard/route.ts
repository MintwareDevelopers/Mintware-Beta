// Bridge card onboarding driver — advances one card through issue → (member permit) → approve →
// prime → go_live, idempotently, by running the state machine (lib/cards/onboard.ts) over real
// effects. Safe to call repeatedly: it resumes from wherever the card is, and pauses (does not fail)
// when it needs the member to sign their standing permit.
//
// Gating: bearer-admin (an operator/automation triggers onboarding) AND CARD_BRIDGE_ENABLED +
// Bridge configured (fail-closed 503 otherwise). The member's own consent to move funds is enforced
// downstream — refillBuffer requires their signed permit — so this route can't drain a member who
// hasn't opted in even though it's admin-triggered.
//
// Deploy-wiring points (both required before a live run; the flow itself is unit-tested with fakes in
// lib/cards/bridgeFlow.test.ts): BRIDGE_USDC_ADDRESS (the USDC the card spends), and resolving the
// funding wallet's PRIVY WALLET ID for the approve signer (Privy keys wallets by id, not address).

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { bridgeConfigured } from '@/lib/cards/bridge'
import { issueBridgeCard } from '@/lib/cards/bridgeClient'
import { grantBridgeApproval } from '@/lib/org/bridgeApprove'
import { runOnboarding, type OnboardDeps } from '@/lib/org/bridgeOnboard'
import { privySignerFromEnv } from '@/lib/org/walletSigner'
import { refillCardBuffer } from '@/lib/org/bufferRefill'
import type { OnboardState } from '@/lib/cards/onboard'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  return createHandler(async (r, ctx) => {
    if (!bridgeConfigured()) return ctx.json({ error: 'bridge_rail_unconfigured' }, 503)

    const body = await r.clone().json().catch(() => ({}))
    const cardId = String(body.cardId ?? '')
    if (!cardId) return ctx.json({ error: 'cardId required' }, 400)

    // Card + funding wallet + chain.
    const { data: card } = await ctx.supabase
      .from('org_cards')
      .select('id, org_id, member_wallet, permit_max_daily_usdc')
      .eq('id', cardId).eq('org_id', orgId).maybeSingle()
    if (!card) return ctx.json({ error: 'card not found' }, 404)

    const { data: buf } = await ctx.supabase
      .from('card_spend_buffers').select('buffer_address').eq('org_card_id', cardId).maybeSingle()
    const fundingWallet = buf?.buffer_address as string | undefined
    if (!fundingWallet) return ctx.json({ error: 'funding (buffer) wallet not registered on-chain yet' }, 409)

    const { data: org } = await ctx.supabase
      .from('orgs').select('treasury_chain_id').eq('id', orgId).single()
    const chainId = org?.treasury_chain_id as number | undefined
    if (!chainId) return ctx.json({ error: 'org treasury chain not set' }, 409)

    const usdcAddress = process.env.BRIDGE_USDC_ADDRESS
    if (!usdcAddress) return ctx.json({ error: 'BRIDGE_USDC_ADDRESS not configured' }, 503)

    const chainSlug = process.env.BRIDGE_CHAIN_SLUG ?? 'base'
    const now = () => new Date().toISOString()

    const deps: OnboardDeps = {
      async loadState(): Promise<OnboardState> {
        const { data } = await ctx.supabase
          .from('org_cards')
          .select('bridge_card_id, activated_at, bridge_approved_at, bridge_primed_at, bridge_live_at')
          .eq('id', cardId).single()
        return {
          cardIssued: !!data?.bridge_card_id,
          permitSigned: !!data?.activated_at, // member signed their standing DelegatedSpendPermit
          approvalGranted: !!data?.bridge_approved_at,
          bufferPrimed: !!data?.bridge_primed_at,
          liveProvisioned: !!data?.bridge_live_at,
        }
      },

      async issueCard() {
        const issued = await issueBridgeCard({
          memberWallet: card.member_wallet,
          fundingWallet,
          chain: chainSlug,
          idempotencyKey: `bridge-issue-${cardId}`,
        })
        await ctx.supabase.from('org_cards').update({ bridge_card_id: issued.bridgeCardId }).eq('id', cardId)
      },

      async grantApproval() {
        // Privy signs the capped approve from the funding wallet. NOTE: Privy keys wallets by id;
        // resolving the member's Privy wallet id from `fundingWallet` is a deploy-wiring point.
        const signer = privySignerFromEnv(fundingWallet, chainId)
        if (!signer) throw new Error('privy_signer_unavailable')
        const dailyCapAtomic = (() => { try { return BigInt(card.permit_max_daily_usdc) } catch { return 0n } })()
        if (dailyCapAtomic <= 0n) throw new Error('no daily cap (permit not signed?)')
        const res = await grantBridgeApproval({ usdcAddress, dailyCapAtomic, signer })
        if (!res.ok) throw new Error(`approval failed: ${res.reason}`)
        await ctx.supabase
          .from('org_cards')
          .update({ bridge_approved_at: now(), bridge_approval_tx: res.txHash })
          .eq('id', cardId)
      },

      async primeBuffer() {
        // manual (onboarding) trigger; refillCardBuffer stays fail-closed behind CARD_BUFFER_REFILL_ENABLED
        // and requires the member's permit (which precedes this step).
        const res = await refillCardBuffer({ supabase: ctx.supabase, orgId, orgCardId: cardId, trigger: 'manual', log: ctx.log })
        if (res.ok) await ctx.supabase.from('org_cards').update({ bridge_primed_at: now() }).eq('id', cardId)
        else ctx.log.warn('cards.bridge', 'prime refill did not confirm', { reason: res.reason })
        // if it didn't confirm, loadState still shows bufferPrimed=false → runOnboarding stops cleanly
      },

      async goLive() {
        await ctx.supabase.from('org_cards').update({ bridge_live_at: now(), state: 'live' }).eq('id', cardId)
      },

      log: (m, meta) => ctx.log.info('cards.bridge', m, meta),
    }

    const result = await runOnboarding(deps)
    return ctx.json({
      ok: true,
      complete: result.complete,
      ran: result.ran,
      awaitingMember: result.awaitingMember ?? null,
      stopped: result.stopped ?? null,
      state: result.finalState,
    })
  }, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })(req)
}
