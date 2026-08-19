// Settle an approved swipe — the exact settleSpend() call already proven live (lib/proof/latestRun.ts
// leg 3, real tx 0x7fd4b3f0…) reused for a real card-triggered event instead of a scripted smoke
// test. Owner-only (moves real on-chain funds, even on testnet).
//
// The submitter is the same oracle/Privy signer the admin smoke-test routes already use in the
// RELAYER_ROLE seat (getOracleSigner('root')) — this is NOT a new always-on relayer server, it's the
// established demo-settlement pattern in this repo, invoked on-demand instead of scripted. A real
// always-on auto-settling relayer (services/relayer getting an HTTP surface + its own funded key) is
// a separate, bigger infra task — see .claude/rules/payments-ypn.md "Deploy-gated remainder".
//
// Capped at sub-$250 swipes on purpose: settleSpend only needs the self-signed DelegatedSpendPermit
// below that threshold; at/above it also needs an edge-auth-signed ShortLivedHoldAuth, which this
// route doesn't build (edge-auth signing a THIRD, on-chain-verifiable artifact — beyond the
// off-chain /authorize decision — is real additional scope, not something to fake here).

import type { NextRequest } from 'next/server'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, zeroAddress, isHex } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'
import { viemChainFor } from '@/lib/web3/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI, GATEWAY_ABI } from '@/lib/web3/artifacts/treasuryV2'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HIGH_VALUE_THRESHOLD = 250_000_000n // $250 (6dp) — matches the smoke test's own edge-sig boundary

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const body = await r.clone().json().catch(() => ({}))
      const eventId = String(body.eventId ?? '')
      if (!eventId) return ctx.json({ error: 'eventId required' }, 400)

      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)
      if (!auth.policy.canManageTreasury) return ctx.json({ error: 'owner only' }, 403)
      const org = auth.org
      if (!org.treasury_vault_address || !org.treasury_chain_id) return ctx.json({ error: 'treasury not set up yet' }, 409)

      const { data: event } = await ctx.supabase
        .from('card_swipe_events')
        .select('id, org_card_id, member_wallet, amount_atomic_usdc, decision, settled')
        .eq('id', eventId).eq('org_id', id).maybeSingle()
      if (!event) return ctx.json({ error: 'event not found' }, 404)
      if (event.decision !== 'approved') return ctx.json({ error: 'only approved swipes can settle' }, 409)
      if (event.settled) return ctx.json({ error: 'already settled' }, 409)
      const amountUSDC = BigInt(event.amount_atomic_usdc)
      if (amountUSDC >= HIGH_VALUE_THRESHOLD) {
        return ctx.json({ error: 'over $250 needs an edge-signed authorization leg — not wired yet, see route header' }, 501)
      }

      const { data: card } = await ctx.supabase
        .from('org_cards')
        .select('permit_max_daily_usdc, permit_nonce, permit_deadline, permit_signature')
        .eq('id', event.org_card_id).single()
      if (!card?.permit_signature) return ctx.json({ error: 'card not activated — the member must sign a standing permit first' }, 409)
      const permitDeadline = BigInt(card.permit_deadline)
      if (permitDeadline <= BigInt(Math.floor(Date.now() / 1000))) {
        return ctx.json({ error: 'the member’s standing permit has expired — they must re-activate' }, 409)
      }
      if (!isHex(card.permit_signature)) return ctx.json({ error: 'stored permit signature is malformed' }, 500)

      const rpcUrl = rpcForChain(org.treasury_chain_id)
      const chain = viemChainFor(org.treasury_chain_id)
      if (!rpcUrl || !chain) return ctx.json({ error: 'unsupported chain' }, 400)

      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
      let gateway: `0x${string}`
      try {
        gateway = (await publicClient.readContract({
          address: org.treasury_vault_address as `0x${string}`, abi: VAULT_ABI, functionName: 'gateway',
        })) as `0x${string}`
      } catch {
        return ctx.json({ error: 'treasury_read_failed' }, 502)
      }

      let account
      try {
        account = await getOracleSigner('root')
      } catch (e) {
        ctx.log.error('cards.settle', 'oracle signer unavailable', { error: String(e) })
        return ctx.json({ error: 'settlement_signer_unavailable' }, 503)
      }
      const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

      // One holdId per event, deterministic — a second settle attempt for the same event reverts
      // on-chain (holds[holdId].settled), not just blocked by our own `settled` flag above.
      const holdId = keccak256(toBytes(event.id))
      const permit = {
        user: event.member_wallet as `0x${string}`,
        maxDailySpendUSDC: BigInt(card.permit_max_daily_usdc),
        nonce: BigInt(card.permit_nonce),
        deadline: permitDeadline,
      }
      const emptyEdgeAuth = {
        holdId: ('0x' + '0'.repeat(64)) as `0x${string}`,
        user: zeroAddress, amountUSDC: 0n, nonce: 0n, expiry: 0n,
      }

      let txHash: `0x${string}`
      try {
        txHash = await walletClient.writeContract({
          address: gateway, abi: GATEWAY_ABI, functionName: 'settleSpend',
          args: [holdId, permit.user, amountUSDC, zeroAddress, permit, card.permit_signature as `0x${string}`, emptyEdgeAuth, '0x'],
          account, chain, gas: 700_000n,
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
      } catch (e) {
        ctx.log.error('cards.settle', 'settleSpend failed', { error: String(e) })
        return ctx.json({ ok: false, error: 'settle_failed', detail: String(e) }, 502)
      }

      await ctx.supabase.from('card_swipe_events')
        .update({ settled: true, settle_tx: txHash, settled_at: new Date().toISOString() })
        .eq('id', eventId)

      const explorerBase = org.treasury_chain_id === 5042002 ? 'https://testnet.arcscan.app/tx/' : 'https://sepolia.basescan.org/tx/'
      return ctx.json({ ok: true, txHash, explorerUrl: explorerBase + txHash })
    },
    { auth: 'signed-message', action: 'mintware-org-card-settle' },
  )(req)
}
