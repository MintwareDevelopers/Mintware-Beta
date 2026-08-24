// Activate a card — the member signs a STANDING EIP-712 DelegatedSpendPermit with their own wallet
// (only they can produce a valid signature for their own `permit.user`; the org owner who issued
// the card cannot sign on the member's behalf). One signature covers many later settleSpend calls
// until `deadline` — see docs/page.tsx: "the nonce is revocation-only... the long-lived permit is
// reusable." This route only stores it; nothing on-chain happens here.
//
// Manual auth (auth: 'none'): the typed-data signature itself IS the authentication (it must recover
// to the card's member_wallet) — same "Routes That Do Manual Auth" category as vault deposit.

import type { NextRequest } from 'next/server'
import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { VAULT_ABI } from '@/lib/web3/artifacts/treasuryV2'
import { verifyDelegatedSpendPermit } from '@/lib/org/spendPermit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params
  return createHandler(async (r, ctx) => {
    const body = await r.clone().json().catch(() => ({}))
    const maxDailySpendUSDC = (() => { try { return BigInt(body.maxDailySpendUsdc) } catch { return null } })()
    const nonce = (() => { try { return BigInt(body.nonce) } catch { return null } })()
    const deadline = (() => { try { return BigInt(body.deadline) } catch { return null } })()
    const signature = String(body.signature ?? '')
    if (maxDailySpendUSDC === null || maxDailySpendUSDC <= 0n) return ctx.json({ error: 'invalid maxDailySpendUsdc' }, 400)
    if (nonce === null) return ctx.json({ error: 'invalid nonce' }, 400)
    if (deadline === null || deadline <= BigInt(Math.floor(Date.now() / 1000))) return ctx.json({ error: 'deadline must be in the future' }, 400)
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return ctx.json({ error: 'invalid signature' }, 400)

    const { data: card } = await ctx.supabase
      .from('org_cards').select('id, org_id, member_wallet, activated_at').eq('id', cardId).eq('org_id', id).maybeSingle()
    if (!card) return ctx.json({ error: 'card not found' }, 404)

    const { data: org } = await ctx.supabase
      .from('orgs').select('treasury_vault_address, treasury_chain_id').eq('id', id).single()
    if (!org?.treasury_vault_address || !org.treasury_chain_id) return ctx.json({ error: 'org treasury not set up yet' }, 409)
    const rpcUrl = rpcForChain(org.treasury_chain_id)
    if (!rpcUrl) return ctx.json({ error: 'unsupported chain' }, 400)

    // Recompute the domain server-side from the live gateway — never trust a client-supplied
    // verifyingContract, or a stale one could let a member sign against the wrong contract.
    let gateway: string
    try {
      const publicClient = createPublicClient({ transport: http(rpcUrl) })
      gateway = (await publicClient.readContract({
        address: org.treasury_vault_address as `0x${string}`, abi: VAULT_ABI, functionName: 'gateway',
      })) as string
    } catch {
      return ctx.json({ error: 'treasury_read_failed' }, 502)
    }

    const valid = await verifyDelegatedSpendPermit({
      signer: card.member_wallet as `0x${string}`,
      chainId: org.treasury_chain_id,
      gateway: gateway as `0x${string}`,
      message: { user: card.member_wallet as `0x${string}`, maxDailySpendUSDC, nonce, deadline },
      signature: signature as `0x${string}`,
    })
    if (!valid) return ctx.json({ error: 'signature does not recover to the card holder' }, 401)

    const { error: updateErr } = await ctx.supabase
      .from('org_cards')
      .update({
        permit_max_daily_usdc: maxDailySpendUSDC.toString(),
        permit_nonce: nonce.toString(),
        permit_deadline: deadline.toString(),
        permit_signature: signature,
        activated_at: new Date().toISOString(),
      })
      .eq('id', cardId)
    if (updateErr) return ctx.json({ error: 'activation_write_failed' }, 500)

    return ctx.json({ ok: true, gateway, chainId: org.treasury_chain_id })
  }, { auth: 'none' })(req)
}
