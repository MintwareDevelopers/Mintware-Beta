// Card spend-buffer balance monitor — reconciles the cached buffer_balance_atomic (which the ASA-window
// flat check reads, lib/org/cardAuthorize.ts) against the AUTHORITATIVE on-chain balance
// (usdc.balanceOf(buffer_address)). Spec: docs/developers/card-spend-buffer-spec.md §2.
//
// The cache exists because the flat authorization check must be a single deterministic read inside
// Lithic's ~6s window — it cannot make an RPC call per swipe. This monitor keeps that cache honest:
// the refill cron syncs before deciding, and the reactive path syncs after a capture drains the buffer.

import { createPublicClient, http, erc20Abi } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { VAULT_ABI } from '@/lib/web3/artifacts/treasuryV2'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void }

export type SyncResult =
  | { ok: true; balanceAtomic: bigint }
  | { ok: false; reason: 'config' | 'no_buffer' | 'chain' | 'read' }

/** Read the buffer wallet's real USDC balance on-chain and write it into the cache. The USDC token is
 *  resolved from the treasury vault (`vault.usdc()`) so no separate token config is needed. */
export async function syncBufferBalance(opts: {
  supabase: SupabaseClient
  orgId: string
  orgCardId: string
  log?: Logger
}): Promise<SyncResult> {
  const { supabase, orgId, orgCardId, log } = opts

  const { data: org } = await supabase
    .from('orgs')
    .select('treasury_vault_address, treasury_chain_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org?.treasury_vault_address || !org.treasury_chain_id) return { ok: false, reason: 'config' }

  const { data: buf } = await supabase
    .from('card_spend_buffers')
    .select('id, buffer_address')
    .eq('org_card_id', orgCardId)
    .maybeSingle()
  if (!buf?.buffer_address) return { ok: false, reason: 'no_buffer' }

  const rpcUrl = rpcForChain(org.treasury_chain_id)
  const chain = viemChainFor(org.treasury_chain_id)
  if (!rpcUrl || !chain) return { ok: false, reason: 'chain' }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  let balance: bigint
  try {
    const usdc = (await publicClient.readContract({
      address: org.treasury_vault_address as `0x${string}`, abi: VAULT_ABI, functionName: 'usdc',
    })) as `0x${string}`
    balance = (await publicClient.readContract({
      address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [buf.buffer_address as `0x${string}`],
    })) as bigint
  } catch (e) {
    log?.warn('cards.buffer', 'on-chain balance read failed', { orgCardId, error: String(e) })
    return { ok: false, reason: 'read' }
  }

  await supabase
    .from('card_spend_buffers')
    .update({ buffer_balance_atomic: balance.toString(), balance_synced_at: new Date().toISOString() })
    .eq('id', buf.id)

  return { ok: true, balanceAtomic: balance }
}
