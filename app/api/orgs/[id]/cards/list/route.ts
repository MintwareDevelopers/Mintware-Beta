// List an org's cards + the EIP-712 domain a member needs to activate one (gateway address + chain
// id, read live off the vault). POST not GET — signed-message auth needs a body (see cards/route.ts
// header); same convention as POST /api/orgs/:id/members.

import type { NextRequest } from 'next/server'
import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { VAULT_ABI } from '@/lib/web3/artifacts/treasuryV2'

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
      // (DelegatedSpendPermit — see the activate route). Read live off the vault, not cached, so a
      // redeployed gateway never gets a stale domain silently signed against.
      let gateway: { address: string; chainId: number } | null = null
      if (auth.org.treasury_vault_address && auth.org.treasury_chain_id) {
        const rpcUrl = rpcForChain(auth.org.treasury_chain_id)
        if (rpcUrl) {
          try {
            const publicClient = createPublicClient({ transport: http(rpcUrl) })
            const addr = await publicClient.readContract({
              address: auth.org.treasury_vault_address as `0x${string}`,
              abi: VAULT_ABI, functionName: 'gateway',
            })
            gateway = { address: addr as string, chainId: auth.org.treasury_chain_id }
          } catch { /* leave null — activation UI shows "treasury not readable" rather than guessing */ }
        }
      }

      return ctx.json({ cards: data ?? [], gateway })
    },
    { auth: 'signed-message', action: 'mintware-org-cards-list' },
  )(req)
}
