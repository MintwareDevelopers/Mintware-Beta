// Card spend-buffer balance monitor — reconciles the cached buffer_balance_atomic used to size refills
// against the authoritative onchain USDC balance at the card-funding Gateway.bufferOf[user]. Bridge's issuer pull happens
// outside our app; this cache must be refreshed before we decide how much vault liquidity to refill.

import { createPublicClient, http, erc20Abi, zeroAddress } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'
import { PAYMENT_GATEWAY_ABI } from '@/lib/web3/artifacts/mintwarePaymentGateway'
import { readCardFundingGateway } from '@/lib/org/cardFundingReader'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void }

export type SyncResult =
  | { ok: true; balanceAtomic: bigint }
  | { ok: false; reason: 'config' | 'no_buffer' | 'chain' | 'read' | 'db' | 'binding_mismatch' | 'gateway_funded' }

/**
 * Reconcile the cached buffer balance from chain. The buffer address is derived from ON-CHAIN
 * bufferOf[member] (the only authority — audit fix H1), NOT from the DB field, so a tampered/hostile
 * DB address can never point the trusted balance cache at funds the member doesn't control. USDC is
 * resolved from vault.usdc(); the gateway from vault.gateway(). Both the balance and the DB
 * buffer_address mirror are overwritten with on-chain truth on every sync.
 */
export async function syncBufferBalance(opts: {
  supabase: SupabaseClient
  orgId: string
  orgCardId: string
  log?: Logger
}): Promise<SyncResult> {
  const { supabase, orgId, orgCardId, log } = opts

  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .select('card_funding_vault_address, card_funding_chain_id, treasury_vault_address')
    .eq('id', orgId)
    .maybeSingle()
  if (orgError) {
    log?.warn('cards.buffer', 'card funding source lookup failed', { orgCardId, error: orgError.message })
    return { ok: false, reason: 'db' }
  }
  if (!org?.card_funding_vault_address || !org.card_funding_chain_id ||
      org.card_funding_vault_address.toLowerCase() === org.treasury_vault_address?.toLowerCase()) return { ok: false, reason: 'config' }

  let bufferResult = await supabase
    .from('card_spend_buffers')
    .select('id, member_wallet, gateway_position_id')
    .eq('org_card_id', orgCardId)
    .maybeSingle()
  // This safety column is dropped by a later migration. Read it while present, then retry with
  // the stable projection after the column has been removed.
  if (bufferResult.error && (bufferResult.error.code === '42703' || bufferResult.error.code === 'PGRST204')) {
    bufferResult = await supabase.from('card_spend_buffers').select('id, member_wallet').eq('org_card_id', orgCardId).maybeSingle()
  }
  const { data: buf, error: bufferError } = bufferResult
  if (bufferError) {
    log?.warn('cards.buffer', 'buffer lookup failed', { orgCardId, error: bufferError.message })
    return { ok: false, reason: 'db' }
  }
  if (!buf?.member_wallet) return { ok: false, reason: 'no_buffer' }
  if ('gateway_position_id' in buf && buf.gateway_position_id) {
    log?.warn('cards.buffer', 'legacy gateway-linked buffer is excluded from card balance sync', { orgCardId })
    return { ok: false, reason: 'gateway_funded' }
  }
  const rpcUrl = rpcForChain(org.card_funding_chain_id)
  const chain = viemChainFor(org.card_funding_chain_id)
  if (!rpcUrl || !chain) return { ok: false, reason: 'chain' }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  let balance: bigint
  let bufferAddr: `0x${string}`
  try {
    const vault = org.card_funding_vault_address as `0x${string}`
    const gateway = await readCardFundingGateway(publicClient, vault, org.treasury_vault_address) as `0x${string}`
    // The AUTHORITATIVE buffer wallet — the same bufferOf[user] the on-chain refill pays into.
    bufferAddr = (await publicClient.readContract({ address: gateway, abi: PAYMENT_GATEWAY_ABI, functionName: 'bufferOf', args: [buf.member_wallet as `0x${string}`] })) as `0x${string}`
    if (!bufferAddr || bufferAddr.toLowerCase() === zeroAddress) {
      // Member has not registered an on-chain buffer. This contract version has no unregister path;
      // clear any stale cache left by an unset or historical buffer state before returning.
      const { error: clearError, data: cleared } = await supabase.from('card_spend_buffers')
        .update({ buffer_balance_atomic: '0', buffer_address: null, balance_synced_at: new Date().toISOString() })
        .eq('id', buf.id).select('id').maybeSingle()
      if (clearError || !cleared) {
        log?.warn('cards.buffer', 'could not clear stale balance for unregistered buffer', { orgCardId, error: clearError?.message })
        return { ok: false, reason: 'db' }
      }
      return { ok: false, reason: 'no_buffer' }
    }
    // Bridge issued the card against the member's own wallet. Since Gateway.bufferOf[user] is
    // user-changeable, do not let a later rotation silently make the cache track a different
    // wallet from the one Bridge can pull from (or the refill path can fund).
    if (bufferAddr.toLowerCase() !== buf.member_wallet.toLowerCase()) {
      log?.warn('cards.buffer', 'on-chain refill destination no longer matches the Bridge funding wallet', {
        orgCardId, memberWallet: buf.member_wallet, gatewayBuffer: bufferAddr,
      })
      return { ok: false, reason: 'binding_mismatch' }
    }
    const usdc = (await publicClient.readContract({ address: vault, abi: YIELD_VAULT_ABI, functionName: 'asset' })) as `0x${string}`
    balance = (await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [bufferAddr] })) as bigint
  } catch (e) {
    log?.warn('cards.buffer', 'on-chain balance read failed', { orgCardId, error: String(e) })
    return { ok: false, reason: 'read' }
  }

  const { data: updated, error: updateError } = await supabase
    .from('card_spend_buffers')
    .update({ buffer_balance_atomic: balance.toString(), buffer_address: bufferAddr.toLowerCase(), balance_synced_at: new Date().toISOString() })
    .eq('id', buf.id).select('id').maybeSingle()
  if (updateError || !updated) {
    log?.warn('cards.buffer', 'on-chain balance could not be persisted', { orgCardId, error: updateError?.message })
    return { ok: false, reason: 'db' }
  }

  return { ok: true, balanceAtomic: balance }
}
