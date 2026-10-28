'use client'

// Cards & Spend — the real thing, not the app/app/team/cards mock. Issue a sandbox Lithic card to a
// member (owner), the member activates it once with their own wallet (standing EIP-712 spend
// permit), then any swipe — real or simulated — is authorized live against the org treasury's NAV
// through the same edge-auth engine x402 uses. Approved swipes under $250 can be settled on-chain
// on demand (settleSpend), same call already proven in lib/proof/latestRun.ts leg 3.
//
// Everything on this page is real: real Lithic sandbox card, real ASA webhook round-trip, real NAV
// hold, real on-chain settlement. Sandbox/testnet throughout — see the route file headers. Chrome
// comes from the shared TeamTerminalShell layout — this is the real "Cards & Spend."

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useReadContracts, useSignMessage, useWriteContract } from 'wagmi'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { PAYMENT_GATEWAY_ABI } from '@/lib/web3/artifacts/mintwarePaymentGateway'

interface CardRow {
  id: string; member_wallet: string; provider: string; last_four: string
  card_type: string; state: string; created_at: string; activated_at: string | null
}
interface SwipeEvent {
  id: string; org_card_id: string; member_wallet: string; amount_atomic_usdc: string
  merchant_descriptor: string | null; decision: 'approved' | 'declined'; decline_reason: string | null
  edge_hold_id: string | null; latency_ms: number | null; settled: boolean; settle_tx: string | null; created_at: string
}
type Gateway = { address: string; chainId: number } | null

const fmtUsd = (atomic: string) => `$${(Number(atomic) / 1_000_000).toFixed(2)}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const explorerTx = (_chainId: number, hash: string) => `https://sepolia.basescan.org/tx/${hash}`

export default function CardsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const { writeContractAsync } = useWriteContract()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  const [cards, setCards] = useState<CardRow[]>([])
  const [gateway, setGateway] = useState<Gateway>(null)
  const [events, setEvents] = useState<SwipeEvent[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [nowSecs, setNowSecs] = useState(0)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury${address ? `?address=${address}` : ''}`).then((r) => r.json()).then((d) => {
      if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name); setIsOwner(d.org.ownerWallet?.toLowerCase() === address?.toLowerCase()) }
    }).catch(() => {})
  }, [slug, address])

  const refreshCards = useCallback(async () => {
    if (!orgId || !address) return
    const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/cards/list`, action: 'mintware-org-cards-list', address, signMessageAsync }).catch(() => null)
    if (res?.ok) { const d = await res.json(); setCards(d.cards ?? []); setGateway(d.gateway ?? null) }
  }, [orgId, address, signMessageAsync])

  const refreshEvents = useCallback(async () => {
    if (!orgId || !address) return
    const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/cards/events`, action: 'mintware-org-cards-events', address, signMessageAsync }).catch(() => null)
    if (res?.ok) { const d = await res.json(); setEvents(d.events ?? []) }
  }, [orgId, address, signMessageAsync])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshCards(); void refreshEvents() }, [refreshCards, refreshEvents])
  useEffect(() => {
    const tick = () => setNowSecs(Math.floor(Date.now() / 1000))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])

  const destinationReads = useReadContracts({
    contracts: gateway ? cards.flatMap((card) => ([
      { address: gateway.address as `0x${string}`, abi: PAYMENT_GATEWAY_ABI, functionName: 'bufferOf' as const, args: [card.member_wallet as `0x${string}`], chainId: gateway.chainId },
      { address: gateway.address as `0x${string}`, abi: PAYMENT_GATEWAY_ABI, functionName: 'proposedBuffer' as const, args: [card.member_wallet as `0x${string}`], chainId: gateway.chainId },
      { address: gateway.address as `0x${string}`, abi: PAYMENT_GATEWAY_ABI, functionName: 'bufferEta' as const, args: [card.member_wallet as `0x${string}`], chainId: gateway.chainId },
    ])) : [],
    query: { enabled: !!gateway && cards.length > 0 },
  })


  const updateDestination = async (card: CardRow, action: 'proposeBuffer' | 'acceptBuffer' | 'revokeBuffer') => {
    if (!address || !gateway) return setMsg('Card funding Gateway not readable yet — try again shortly.')
    if (card.member_wallet.toLowerCase() !== address.toLowerCase()) return setMsg('Only the card holder can manage their own funding destination.')
    setBusy(`destination-${card.id}`); setMsg('')
    try {
      const args = action === 'proposeBuffer' ? [card.member_wallet as `0x${string}`] as const : [] as const
      const hash = await writeContractAsync({
        address: gateway.address as `0x${string}`, abi: PAYMENT_GATEWAY_ABI,
        functionName: action, args, chainId: gateway.chainId,
      })
      setMsg(`Destination transaction submitted: ${explorerTx(gateway.chainId, hash)}`)
      await destinationReads.refetch()
    } catch (e) { setMsg((e as Error)?.message ?? 'destination update failed') } finally { setBusy('') }
  }


  const settle = async (event: SwipeEvent) => {
    if (!orgId || !address) return
    setBusy(`settle-${event.id}`); setMsg('')
    try {
      const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/cards/settle`, action: 'mintware-org-card-settle', payload: { eventId: event.id }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok && d.ok) refreshEvents(); else setMsg(d.error ?? d.detail ?? 'settle failed')
    } catch (e) { setMsg(String(e)) } finally { setBusy('') }
  }

  return (
    <MwAuthGuard>
      <div className="max-w-[900px] mx-auto">
        <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {orgName || 'Org'}</Link>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em]">Cards &amp; spend</h1>
          <span className="live-chip"><span className="dot" aria-hidden />Lithic sandbox · testnet</span>
        </div>
        <p className="text-[13px] text-ink-mid mt-1.5 max-w-[64ch]">
          A swipe authorizes live against the treasury&apos;s real NAV — the same edge-auth engine x402 uses,
          gated by the holder&apos;s role cap. Nothing is pre-funded; capital keeps earning until a charge settles.
        </p>
        {msg && <div className="text-[12.5px] text-[#D14343] mt-3">{msg}</div>}


        {/* card directory */}
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Cards · {cards.length}</div>
        <div className="soft-card overflow-hidden">
          {cards.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink-soft">No cards yet.</div>}
          {cards.map((c) => {
            const mine = address && c.member_wallet.toLowerCase() === address.toLowerCase()
            const readOffset = cards.indexOf(c) * 3
            const currentDestination = destinationReads.data?.[readOffset]?.result as string | undefined
            const proposedDestination = destinationReads.data?.[readOffset + 1]?.result as string | undefined
            const eta = Number(destinationReads.data?.[readOffset + 2]?.result ?? 0n)
            const matchesCurrent = currentDestination?.toLowerCase() === c.member_wallet.toLowerCase()
            const matchesProposal = proposedDestination?.toLowerCase() === c.member_wallet.toLowerCase()
            const canAccept = matchesProposal && eta > 0 && nowSecs >= eta
            return (
              <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-hair-soft last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-ink font-mono truncate">•••• {c.last_four} <span className="text-ink-soft font-sans">· {short(c.member_wallet)}</span></div>
                  <div className="text-[11.5px] text-ink-soft">{c.state}{c.activated_at ? ' · activated ✓' : ' · not activated'}</div>
                </div>
                {mine && !matchesCurrent && !matchesProposal && (
                  <button onClick={() => updateDestination(c, 'proposeBuffer')} disabled={busy === `destination-${c.id}` || !gateway} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">Propose funding wallet</button>
                )}
                {mine && matchesProposal && !canAccept && <span className="shrink-0 text-[11.5px] text-ink-soft">Destination pending 48-hour delay</span>}
                {mine && canAccept && (
                  <button onClick={() => updateDestination(c, 'acceptBuffer')} disabled={busy === `destination-${c.id}`} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">Accept destination</button>
                )}
                {mine && matchesCurrent && <button onClick={() => updateDestination(c, 'revokeBuffer')} disabled={busy === `destination-${c.id}`} className="shrink-0 rounded-full border border-hair px-4 py-2 text-[12.5px] font-semibold">Revoke destination</button>}
                {!mine && !matchesCurrent && <span className="shrink-0 text-[11.5px] text-ink-soft">Awaiting holder destination registration</span>}
              </div>
            )
          })}
        </div>


        {/* spend feed */}
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Spend feed</div>
        <div className="soft-card overflow-hidden">
          {events.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink-soft">Nothing yet — swipe a card above.</div>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-hair-soft last:border-b-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-ink truncate">{e.merchant_descriptor ?? 'Unknown merchant'} <span className="text-ink-soft font-sans font-normal">· {short(e.member_wallet)}</span></div>
                <div className="text-[11.5px] text-ink-soft">
                  {e.decision === 'approved'
                    ? <span className="text-mw-green">Approved</span>
                    : <span className="text-[#D14343]">Declined · {e.decline_reason}</span>}
                  {e.latency_ms != null && ` · ${e.latency_ms}ms`}
                  {e.settled && e.settle_tx && gateway && (
                    <> · <a href={explorerTx(gateway.chainId, e.settle_tx)} target="_blank" rel="noreferrer" className="text-peri-deep hover:underline">settled ✓</a></>
                  )}
                </div>
              </div>
              <div className="tabular-nums text-[13.5px] text-ink shrink-0">{fmtUsd(e.amount_atomic_usdc)}</div>
              {isOwner && e.decision === 'approved' && !e.settled && (
                <button onClick={() => settle(e)} disabled={busy === `settle-${e.id}`} className="shrink-0 rounded-full border border-peri text-peri-deep px-3.5 py-1.5 text-[12px] font-semibold hover:bg-peri hover:text-white transition-colors disabled:opacity-50">{busy === `settle-${e.id}` ? 'Settling…' : 'Settle'}</button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-soft mt-5">Sandbox card issuance (Lithic) + testnet settlement (Arc / Base Sepolia). Not production, not an offer.</p>
      </div>
    </MwAuthGuard>
  )
}
