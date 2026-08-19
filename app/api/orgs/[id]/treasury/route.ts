// Org treasury — the read snapshot that powers the public treasury page (#6), the member card (#2),
// and the fund screen's status (#1). Plus PATCH to record the vault address after an operator's Foundry
// deploy (the converged vault links a delegatecall library, so it is NOT app-deployable — see the
// 20260818000001_org_tenancy migration header + the deprecated deploy-ypn-v2-testnet route).
//
// GET  /api/orgs/:id/treasury[?address=0x..]  — public. Org + on-chain snapshot + member count
//                                               (+ the caller's par-safe realizable balance if ?address).
// PATCH /api/orgs/:id/treasury                — owner-only (signed-message). Records vault + chain.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { makeTreasuryReader, rpcForChain } from '@/lib/org/treasuryReader'

export const dynamic = 'force-dynamic'

const EVM_RE = /^0x[a-fA-F0-9]{40}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (r, ctx) => {
    const url = new URL(r.url)
    const address = url.searchParams.get('address')

    // Accept a UUID id OR a slug — the public treasury page fetches by slug.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    const { data: org, error } = await ctx.supabase
      .from('orgs')
      .select('id, name, slug, owner_wallet, treasury_vault_address, treasury_chain_id, created_at')
      .eq(isUuid ? 'id' : 'slug', id)
      .single()
    if (error || !org) return ctx.json({ error: 'org not found' }, 404)

    const { count: memberCount } = await ctx.supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', id)
      .eq('status', 'active')

    const base = {
      org: { id: org.id, name: org.name, slug: org.slug, ownerWallet: org.owner_wallet },
      treasuryVaultAddress: org.treasury_vault_address as string | null,
      treasuryChainId: (org.treasury_chain_id as number | null) ?? null,
      memberCount: memberCount ?? 0,
    }

    // No vault recorded yet → onboarding state (fund screen shows "record your treasury" step).
    if (!org.treasury_vault_address || !org.treasury_chain_id) {
      return ctx.json({ ...base, funded: false, snapshot: null, member: null })
    }

    const rpcUrl = rpcForChain(org.treasury_chain_id)
    if (!rpcUrl) return ctx.json({ ...base, funded: true, snapshot: null, member: null, note: 'unsupported chain for reads' })

    const reader = makeTreasuryReader({ rpcUrl, vault: org.treasury_vault_address })
    try {
      const snap = await reader.snapshot()
      // On-chain config owner — lets the app verify the treasury is actually controlled by the
      // org owner's (Privy) wallet (P3 control check). Best-effort; null if the read fails.
      const onchainOwner = await reader.owner().catch(() => null)
      let member = null
      if (address && EVM_RE.test(address)) {
        const realizable = await reader.memberRealizableUsdc(address)
        const { data: mem } = await ctx.supabase
          .from('org_members')
          .select('role, status, eas_uid')
          .eq('org_id', org.id)
          .eq('wallet', address.toLowerCase())
          .maybeSingle()
        member = {
          address: address.toLowerCase(),
          spendableUsdc: realizable.toString(),
          role: (mem?.role as string | null) ?? null,
          status: (mem?.status as string | null) ?? null,
          easUid: (mem?.eas_uid as string | null) ?? null,
        }
      }
      return ctx.json({
        ...base,
        funded: snap.navUsdc > 0n,
        snapshot: {
          navUsdc: snap.navUsdc.toString(),
          coverageBps: snap.coverageBps > 1_000_000n ? null : Number(snap.coverageBps), // null = fully covered (MAX)
          deployedUsdc: snap.deployedUsdc.toString(),
          juniorBufferUsdc: snap.juniorBufferUsdc.toString(),
          fullyCovered: snap.fullyCovered,
        },
        control: {
          onchainOwner,
          // Does the on-chain owner match the org owner's (Privy) wallet? The core control assurance.
          ownerMatchesOrg: !!onchainOwner && onchainOwner.toLowerCase() === org.owner_wallet.toLowerCase(),
        },
        member,
      })
    } catch (e) {
      return ctx.json({ ...base, funded: true, snapshot: null, member: null, error: 'treasury_read_failed', detail: String(e) }, 502)
    }
  })(req)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const body = await r.clone().json().catch(() => ({}))
      const vault = String(body.treasuryVaultAddress ?? '').trim()
      const chainId = Number(body.treasuryChainId)
      if (!EVM_RE.test(vault)) return ctx.json({ error: 'valid treasuryVaultAddress required' }, 400)
      if (!Number.isInteger(chainId) || chainId <= 0) return ctx.json({ error: 'valid treasuryChainId required' }, 400)
      if (!rpcForChain(chainId)) return ctx.json({ error: 'unsupported chain (Base Sepolia 84532 or Arc 5042002)' }, 400)

      const { data: org, error: orgErr } = await ctx.supabase.from('orgs').select('id, owner_wallet').eq('id', id).single()
      if (orgErr || !org) return ctx.json({ error: 'org not found' }, 404)
      if (org.owner_wallet.toLowerCase() !== ctx.user!.address.toLowerCase())
        return ctx.json({ error: 'only the org owner can set the treasury' }, 403)

      // Sanity: the address must actually be a converged treasury vault on that chain (coverageBps() answers).
      const reader = makeTreasuryReader({ rpcUrl: rpcForChain(chainId)!, vault })
      try {
        await reader.snapshot()
      } catch {
        return ctx.json({ error: 'address does not read as a MintwareTreasuryVault on that chain' }, 422)
      }

      const { error } = await ctx.supabase
        .from('orgs')
        .update({ treasury_vault_address: vault.toLowerCase(), treasury_chain_id: chainId })
        .eq('id', id)
      if (error) return ctx.json({ error: 'update failed' }, 500)
      return ctx.json({ ok: true, treasuryVaultAddress: vault.toLowerCase(), treasuryChainId: chainId })
    },
    { auth: 'signed-message', action: 'mintware-org-treasury' },
  )(req)
}
