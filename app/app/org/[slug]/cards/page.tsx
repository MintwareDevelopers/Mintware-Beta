'use client'

// Cards & Spend — the real thing, not the app/app/team/cards mock. Issue a sandbox Lithic card to a
// member (owner), the member activates it once with their own wallet (standing EIP-712 spend
// permit), then any swipe — real or simulated — is authorized live against the org treasury's NAV
// through the same edge-auth engine x402 uses. Approved swipes under $250 can be settled on-chain
// on demand (settleSpend), same call already proven in lib/proof/latestRun.ts leg 3.
//
// Everything on this page is real: real Lithic sandbox card, real ASA webhook round-trip, real NAV
// hold, real on-chain settlement. Sandbox/testnet throughout — see the route file headers.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage, useSignTypedData } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

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
  const { signTypedDataAsync } = useSignTypedData()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  const [cards, setCards] = useState<CardRow[]>([])
  const [gateway, setGateway] = useState<Gateway>(null)
  const [events, setEvents] = useState<SwipeEvent[]>([])
  const [issueWallet, setIssueWallet] = useState('')
  const [simCard, setSimCard] = useState('')
  const [simAmount, setSimAmount] = useState('4.20')
  const [simMerchant, setSimMerchant] = useState('MINTWARE DEMO MERCHANT')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

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

  useEffect(() => { void refreshCards(); void refreshEvents() }, [refreshCards, refreshEvents])

  const issueCard = async () => {
    if (!orgId || !address || !/^0x[a-fA-F0-9]{40}$/.test(issueWallet)) return setMsg('Enter a valid member wallet.')
    setBusy('issue'); setMsg('')
    try {
      const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/cards`, action: 'mintware-org-card-issue', payload: { memberWallet: issueWallet }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok && d.ok) { setIssueWallet(''); refreshCards() }
      else if (res.status === 503 && d.gated === 'lithic_unconfigured') setMsg('LITHIC_API_KEY is not set on the server.')
      else setMsg(d.error ?? 'issuance failed')
    } catch (e) { setMsg(String(e)) } finally { setBusy('') }
  }

  const activateCard = async (card: CardRow) => {
    if (!address || !gateway) return setMsg('Treasury not readable yet — try again shortly.')
    if (card.member_wallet.toLowerCase() !== address.toLowerCase()) return setMsg('Only the card holder can activate their own card.')
    setBusy(`activate-${card.id}`); setMsg('')
    try {
      const nonce = BigInt(Date.now())
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 3600) // 90-day standing permit
      const maxDailySpendUSDC = 100_000_000n // $100/day ceiling on the permit itself (belt #3, alongside the org role cap)
      const signature = await signTypedDataAsync({
        domain: { name: 'Mintware Payment Gateway', version: '2.0', chainId: gateway.chainId, verifyingContract: gateway.address as `0x${string}` },
        types: { DelegatedSpendPermit: [
          { name: 'user', type: 'address' }, { name: 'maxDailySpendUSDC', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ] },
        primaryType: 'DelegatedSpendPermit',
        message: { user: address as `0x${string}`, maxDailySpendUSDC, nonce, deadline },
      })
      const res = await fetch(`/api/orgs/${orgId}/cards/${card.id}/activate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxDailySpendUsdc: maxDailySpendUSDC.toString(), nonce: nonce.toString(), deadline: deadline.toString(), signature }),
      })
      const d = await res.json()
      if (res.ok && d.ok) refreshCards(); else setMsg(d.error ?? 'activation failed')
    } catch (e) { setMsg(String(e)) } finally { setBusy('') }
  }

  const simulate = async () => {
    if (!orgId || !address || !simCard) return setMsg('Pick a card to simulate a swipe on.')
    const amountUsd = parseFloat(simAmount)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return setMsg('Enter a valid amount.')
    setBusy('simulate'); setMsg('')
    try {
      const res = await signedOrgFetch({
        path: `/api/orgs/${orgId}/cards/simulate-swipe`, action: 'mintware-org-card-simulate-swipe',
        payload: { cardId: simCard, amountUsd, merchantDescriptor: simMerchant }, address, signMessageAsync,
      })
      const d = await res.json()
      if (!res.ok || !d.ok) setMsg(d.error ?? 'simulate failed')
      // Poll the feed a few times — the decision lands asynchronously via the ASA webhook.
      for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 800)); await refreshEvents() }
    } catch (e) { setMsg(String(e)) } finally { setBusy('') }
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
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[900px] px-6 max-[700px]:px-4 py-[44px]">
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

          {/* issue */}
          {isOwner && (
            <div className="soft-card p-5 mt-6 flex items-end gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
              <label className="flex-1 block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Member wallet</span>
                <input value={issueWallet} onChange={(e) => setIssueWallet(e.target.value)} placeholder="0x…" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] font-mono outline-none focus:border-peri" />
              </label>
              <button onClick={issueCard} disabled={busy === 'issue' || !issueWallet} className="rounded-full bg-peri text-white px-5 py-2.5 text-[13px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy === 'issue' ? 'Signing…' : 'Issue card'}</button>
            </div>
          )}

          {/* card directory */}
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Cards · {cards.length}</div>
          <div className="soft-card overflow-hidden">
            {cards.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink-soft">No cards yet{isOwner ? ' — issue the first one above.' : '.'}</div>}
            {cards.map((c) => {
              const mine = address && c.member_wallet.toLowerCase() === address.toLowerCase()
              return (
                <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-hair-soft last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-ink font-mono truncate">•••• {c.last_four} <span className="text-ink-soft font-sans">· {short(c.member_wallet)}</span></div>
                    <div className="text-[11.5px] text-ink-soft">{c.state}{c.activated_at ? ' · activated ✓' : ' · not activated'}</div>
                  </div>
                  {!c.activated_at && mine && (
                    <button onClick={() => activateCard(c)} disabled={busy === `activate-${c.id}` || !gateway} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy === `activate-${c.id}` ? 'Signing…' : 'Activate (sign)'}</button>
                  )}
                  {!c.activated_at && !mine && <span className="shrink-0 text-[11.5px] text-ink-soft">Awaiting holder activation</span>}
                </div>
              )
            })}
          </div>

          {/* simulate swipe */}
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Simulate a swipe</div>
          <div className="soft-card p-5 flex items-end gap-3 flex-wrap max-[640px]:flex-col max-[640px]:items-stretch">
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Card</span>
              <select value={simCard} onChange={(e) => setSimCard(e.target.value)} className="mt-1.5 rounded-[10px] border border-hair px-3 py-2.5 text-[14px] bg-white outline-none focus:border-peri min-w-[160px]">
                <option value="">Select…</option>
                {cards.filter((c) => c.activated_at).map((c) => <option key={c.id} value={c.id}>•••• {c.last_four} · {short(c.member_wallet)}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Amount (USD)</span>
              <input value={simAmount} onChange={(e) => setSimAmount(e.target.value)} inputMode="decimal" className="mt-1.5 w-[110px] rounded-[10px] border border-hair px-3 py-2.5 text-[14px] tabular-nums outline-none focus:border-peri" />
            </label>
            <label className="flex-1 block min-w-[160px]"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Merchant</span>
              <input value={simMerchant} onChange={(e) => setSimMerchant(e.target.value)} className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
            </label>
            <button onClick={simulate} disabled={busy === 'simulate' || !simCard} className="rounded-full bg-peri text-white px-5 py-2.5 text-[13px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy === 'simulate' ? 'Swiping…' : 'Swipe'}</button>
          </div>
          {cards.length > 0 && cards.every((c) => !c.activated_at) && <div className="text-[11.5px] text-ink-soft mt-2">No activated cards yet — the holder needs to sign a standing permit first.</div>}

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
        </main>
      </div>
    </MwAuthGuard>
  )
}
