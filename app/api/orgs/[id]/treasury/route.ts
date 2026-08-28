// Org treasury — the read snapshot that powers the public treasury page (#6), the member card (#2),
// and the fund screen's status (#1). Plus PATCH to record the vault address after an operator's Foundry
// deploy (the converged vault links a delegatecall library, so it is NOT app-deployable — see the
// 20260818000001_org_tenancy migration header + the deprecated deploy-ypn-v2-testnet route).
//
// GET  /api/orgs/:id/treasury[?address=0x..]  — public. Org + on-chain snapshot + member count
//                                               (+ the caller's par-while-covered realizable balance if ?address).
// PATCH /api/orgs/:id/treasury                — owner-only (signed-message). Records vault + chain.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { makeTreasuryReader, readSafeInfo, rpcForChain } from '@/lib/org/treasuryReader'

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

    // Who's asking — gate the sensitive fields (owner wallet, member count, financial snapshot, on-chain
    // owner + multisig signers) to the org OWNER or an ACTIVE MEMBER. A public/unknown caller gets only
    // name/slug/funded + the vault address (a public contract) — never the owner's wallet, the team's
    // signer set, or the treasury figures. (Hardening follow-up: signature-proven reads; ?address is a
    // known-address gate, not a cryptographic one.)
    const addrLc = address && EVM_RE.test(address) ? address.toLowerCase() : null
    let memberRow: { role: string | null; status: string | null; eas_uid: string | null } | null = null
    if (addrLc) {
      const { data: mem } = await ctx.supabase
        .from('org_members').select('role, status, eas_uid')
        .eq('org_id', org.id).eq('wallet', addrLc).maybeSingle()
      memberRow = (mem as { role: string | null; status: string | null; eas_uid: string | null } | null) ?? null
    }
    const privileged = (addrLc !== null && addrLc === org.owner_wallet.toLowerCase()) || memberRow?.status === 'active'

    let memberCount: number | null = null
    if (privileged) {
      const { count } = await ctx.supabase
        .from('org_members').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).eq('status', 'active')
      memberCount = count ?? 0
    }

    const base = {
      org: { id: org.id, name: org.name, slug: org.slug, ...(privileged ? { ownerWallet: org.owner_wallet } : {}) },
      treasuryVaultAddress: org.treasury_vault_address as string | null,
      treasuryChainId: (org.treasury_chain_id as number | null) ?? null,
      memberCount,
    }

    // No vault recorded yet → onboarding state (fund screen shows "record your treasury" step).
    if (!org.treasury_vault_address || !org.treasury_chain_id) {
      return ctx.json({ ...base, funded: false, snapshot: null, control: null, member: null })
    }

    const rpcUrl = rpcForChain(org.treasury_chain_id)
    if (!rpcUrl) return ctx.json({ ...base, funded: true, snapshot: null, control: null, member: null, note: 'unsupported chain for reads' })

    const reader = makeTreasuryReader({ rpcUrl, vault: org.treasury_vault_address })
    try {
      const snap = await reader.snapshot()
      const funded = snap.navUsdc > 0n

      // The caller's own realizable balance — only for an ACTUAL member of this org (never an arbitrary address).
      let member = null
      if (addrLc && memberRow) {
        const realizable = await reader.memberRealizableUsdc(addrLc)
        member = {
          address: addrLc,
          spendableUsdc: realizable.toString(),
          role: memberRow.role ?? null,
          status: memberRow.status ?? null,
          easUid: memberRow.eas_uid ?? null,
        }
      }

      // Financial snapshot + control (on-chain owner + multisig signers) are org internals — privileged only.
      let snapshot = null
      let control = null
      if (privileged) {
        snapshot = {
          navUsdc: snap.navUsdc.toString(),
          coverageBps: snap.coverageBps > 1_000_000n ? null : Number(snap.coverageBps), // null = fully covered (MAX)
          deployedUsdc: snap.deployedUsdc.toString(),
          juniorBufferUsdc: snap.juniorBufferUsdc.toString(),
          fullyCovered: snap.fullyCovered,
        }
        const onchainOwner = await reader.owner().catch(() => null)
        control = {
          onchainOwner,
          ownerMatchesOrg: !!onchainOwner && onchainOwner.toLowerCase() === org.owner_wallet.toLowerCase(),
          multisig: onchainOwner ? await readSafeInfo(rpcUrl, onchainOwner) : null,
        }
      }

      return ctx.json({ ...base, funded, snapshot, control, member })
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
      if (!rpcForChain(chainId)) return ctx.json({ error: 'unsupported chain (Base Sepolia 84532)' }, 400)

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
