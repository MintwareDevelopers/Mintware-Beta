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
// Deploy-wiring: BRIDGE_USDC_ADDRESS (the USDC the card spends). The funding wallet's Privy wallet id
// is read from card_spend_buffers.privy_wallet_id (Privy keys wallets by id, not address).

import type { NextRequest } from 'next/server'
import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { rpcForChain } from '@/lib/org/treasuryReader'
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

    const { data: card } = await ctx.supabase
      .from('org_cards')
      .select('id, org_id, member_wallet, permit_max_daily_usdc, permit_deadline')
      .eq('id', cardId).eq('org_id', orgId).maybeSingle()
    if (!card) return ctx.json({ error: 'card not found' }, 404)

    const { data: buf } = await ctx.supabase
      .from('card_spend_buffers')
      .select('buffer_address, buffer_target_atomic, privy_wallet_id')
      .eq('org_card_id', cardId).maybeSingle()
    const fundingWallet = buf?.buffer_address as string | undefined
    if (!fundingWallet) return ctx.json({ error: 'funding (buffer) wallet not registered on-chain yet' }, 409)

    const { data: org } = await ctx.supabase
      .from('orgs').select('treasury_chain_id').eq('id', orgId).single()
    const chainId = org?.treasury_chain_id as number | undefined
    if (!chainId) return ctx.json({ error: 'org treasury chain not set' }, 409)

    const usdcAddress = process.env.BRIDGE_USDC_ADDRESS
    if (!usdcAddress) return ctx.json({ error: 'BRIDGE_USDC_ADDRESS not configured' }, 503)

    const rpcUrl = rpcForChain(chainId)
    if (!rpcUrl) return ctx.json({ error: 'unsupported chain' }, 400)
    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    const chainSlug = process.env.BRIDGE_CHAIN_SLUG ?? 'base'
    const now = () => new Date().toISOString()
    const nowSecs = Math.floor(Date.now() / 1000)

    // hard-stop helper: a persisted-state write that fails must not be silently ignored (else the
    // external effect and our record diverge, and a retry re-does the external call).
    const mustPersist = async (patch: Record<string, unknown>) => {
      const { error } = await ctx.supabase.from('org_cards').update(patch).eq('id', cardId)
      if (error) throw new Error(`persist failed: ${error.message}`)
    }

    const deps: OnboardDeps = {
      async loadState(): Promise<OnboardState> {
        const { data } = await ctx.supabase
          .from('org_cards')
          .select('bridge_card_id, activated_at, permit_deadline, bridge_approved_at, bridge_primed_at, bridge_live_at')
          .eq('id', cardId).single()
        // permitSigned reflects LIVE validity, not merely "was once signed": an expired permit routes
        // back to the member step instead of stalling later at prime.
        const permitLive = !!data?.activated_at &&
          (() => { try { return BigInt(data!.permit_deadline) > BigInt(nowSecs) } catch { return false } })()
        return {
          cardIssued: !!data?.bridge_card_id,
          permitSigned: permitLive,
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
        await mustPersist({ bridge_card_id: issued.bridgeCardId })
      },

      async grantApproval() {
        const privyWalletId = buf?.privy_wallet_id as string | undefined
        if (!privyWalletId) throw new Error('privy_wallet_id not set for funding wallet')
        const signer = privySignerFromEnv(privyWalletId, chainId)
        if (!signer) throw new Error('privy_signer_unavailable')
        const dailyCapAtomic = (() => { try { return BigInt(card.permit_max_daily_usdc) } catch { return 0n } })()
        if (dailyCapAtomic <= 0n) throw new Error('no daily cap (permit not signed?)')
        const bufferTargetAtomic = (() => { try { return BigInt(buf?.buffer_target_atomic ?? 0) } catch { return 0n } })()
        const res = await grantBridgeApproval({
          usdcAddress,
          dailyCapAtomic,
          bufferTargetAtomic,
          signer,
          // ok only once the approve MINED successfully — not merely broadcast (cold-decline guard).
          confirm: async (hash) => {
            const receipt = await publicClient.waitForTransactionReceipt({ hash })
            return { success: receipt.status === 'success' }
          },
        })
        if (!res.ok) throw new Error(`approval failed: ${res.reason}`)
        await mustPersist({ bridge_approved_at: now(), bridge_approval_tx: res.txHash })
      },

      async primeBuffer() {
        const res = await refillCardBuffer({ supabase: ctx.supabase, orgId, orgCardId: cardId, trigger: 'manual', log: ctx.log })
        // "primed" means the buffer holds >= its minimum. A confirmed refill OR "already at target"
        // both satisfy that — treat at_target as primed (else a pre-funded card stalls forever).
        if (res.ok || res.reason === 'at_target') await mustPersist({ bridge_primed_at: now() })
        else ctx.log.warn('cards.bridge', 'prime refill did not confirm', { reason: res.reason })
      },

      async goLive() {
        // idempotent: only claim go-live if not already live (guards concurrent onboarding runs from
        // double-provisioning once push-provisioning is wired in).
        await ctx.supabase.from('org_cards').update({ bridge_live_at: now(), state: 'live' })
          .eq('id', cardId).is('bridge_live_at', null)
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
