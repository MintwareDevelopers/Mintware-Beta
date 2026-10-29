// List an org's cards + the EIP-712 domain a member needs to activate one (gateway address + chain
// id, read live off the vault). POST not GET — signed-message auth needs a body (see cards/route.ts
// header); same convention as POST /api/orgs/:id/members.

import type { NextRequest } from 'next/server'
import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { readCardFundingGateway } from '@/lib/org/cardFundingReader'
import { getStandingForWallet } from '@/lib/org/standing'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (_r, ctx) => {
      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)

      const { data, error } = await ctx.supabase
        .from('org_cards')
        .select('id, member_wallet, provider, last_four, card_type, state, created_at, activated_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
      if (error) return ctx.json({ error: 'query_failed' }, 500)

      // The gateway address + chain id are the EIP-712 domain a member signs to activate their card
      // (funding destination Gateway). Read live off the vault, not cached, so a
      // redeployed gateway never gets a stale domain silently signed against.
      let gateway: { address: string; chainId: number } | null = null
      if (auth.org.card_funding_vault_address && auth.org.card_funding_chain_id) {
        const rpcUrl = rpcForChain(auth.org.card_funding_chain_id)
        if (rpcUrl) {
          try {
            const publicClient = createPublicClient({ transport: http(rpcUrl) })
            const addr = await readCardFundingGateway(publicClient, auth.org.card_funding_vault_address as `0x${string}`, auth.org.treasury_vault_address)
            gateway = { address: addr, chainId: auth.org.card_funding_chain_id }
          } catch { /* leave null — activation UI shows "treasury not readable" rather than guessing */ }
        }
      }

      // Read-only Standing surface — each card carries its holder's tier, derived on-read from that
      // member's OWN settled spend (getStandingForWallet, spend-only, never a reputation score). This
      // is display-only: it does NOT gate the list and never affects a spend/authorize decision here.
      const cards = (data ?? []) as Array<Record<string, unknown>>
      const standings = await Promise.all(
        cards.map((c) => getStandingForWallet(ctx.supabase, c.member_wallet as string, id)),
      )
      const cardsWithStanding = cards.map((c, i) => ({
        ...c,
        standing: {
          tier: standings[i].tier,
          settledCount: standings[i].settledCount,
          distinctDays: standings[i].distinctDays,
          spanDays: standings[i].spanDays,
        },
      }))

      return ctx.json({ cards: cardsWithStanding, gateway })
    },
    { auth: 'signed-message', action: 'mintware-org-cards-list' },
  )(req)
}
