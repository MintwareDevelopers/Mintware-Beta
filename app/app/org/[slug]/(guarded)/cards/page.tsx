'use client'

// Organization cards page. The former Lithic / spend-in-place flow is retired; Bridge + Stripe are pre-enable.
// MintwarePaymentGateway supports Earn-share refills to a member-registered buffer only. Chrome
// comes from the shared TeamTerminalShell layout — this is the real "Cards & Spend."

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useReadContracts, useSignMessage, useWriteContract } from 'wagmi'
import { PageHead, SLabel, StatusChip, Note, IconCard } from '@/components/web2/TeamKit'
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
  const [cards, setCards] = useState<CardRow[]>([])
  const [gateway, setGateway] = useState<Gateway>(null)
  const [events, setEvents] = useState<SwipeEvent[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [nowSecs, setNowSecs] = useState(0)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury${address ? `?address=${address}` : ''}`).then((r) => r.json()).then((d) => {
      if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name) }
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


  return (
    <MwAuthGuard>
      <div className="max-w-[900px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: orgName || 'Org' }}
          icon={<IconCard size={24} />}
          title="Cards & spend"
          status={{ tone: 'building', label: 'Bridge + Stripe · pre-enable' }}
          lede="Card issuance is not enabled yet. Each card holder registers a funding wallet that card refills go to; refills redeem Earn shares to that wallet. Nothing here authorizes purchases or settles merchants."
        />
        {msg && <div role="status" className="mt-4 rounded-[14px] bg-[#FBE9E7] px-4 py-3 text-[13.5px] text-[#B42318] break-words">{msg}</div>}

        {/* How a funding wallet goes live — the one flow a holder can actually complete today. */}
        <ol className="mt-7 p-0 list-none grid grid-cols-3 max-[640px]:grid-cols-1 gap-3" aria-label="Registering a funding wallet">
          {[['Propose', 'The card holder proposes their own wallet as the funding destination.'], ['Wait 48 hours', 'A delay before it can be accepted, so a surprise change can be caught.'], ['Accept', 'Once the delay passes, the holder accepts and refills can go there.']].map(([t, d], i) => (
            <li key={t} className="mw-raise-sm rounded-[18px] p-4">
              <div className="flex items-center gap-2.5"><span className="w-7 h-7 rounded-full grid place-items-center text-[12.5px] font-semibold text-white" style={{ background: 'var(--mw-btn)' }}>{i + 1}</span><span className="font-semibold text-[15px]">{t}</span></div>
              <div className="text-[13px] text-ink-mid leading-[1.5] mt-2">{d}</div>
            </li>
          ))}
        </ol>


        {/* card directory */}
        <SLabel>Cards · {cards.length}</SLabel>
        <div className="mw-raise rounded-[22px] overflow-hidden">
          {cards.length === 0 && <div className="px-5 py-10 text-center text-[14px] text-ink-soft">No cards yet.</div>}
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
              <div key={c.id} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2.5">
                <span className="w-11 h-11 rounded-[12px] grid place-items-center shrink-0 max-[560px]:hidden" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}><IconCard /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-ink truncate"><span className="font-geist-mono">•••• {c.last_four}</span> <span className="text-ink-soft font-normal">· <span className="font-geist-mono">{short(c.member_wallet)}</span></span></div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap"><span className="text-[12.5px] text-ink-soft capitalize">{c.state}</span>{c.activated_at ? <StatusChip tone="live">Activated</StatusChip> : <StatusChip tone="building">Not activated</StatusChip>}</div>
                </div>
                {mine && !matchesCurrent && !matchesProposal && (
                  <button onClick={() => updateDestination(c, 'proposeBuffer')} disabled={busy === `destination-${c.id}` || !gateway} className="shrink-0 mw-btn !min-h-[40px] disabled:opacity-50">Propose funding wallet</button>
                )}
                {mine && matchesProposal && !canAccept && <StatusChip tone="building">Pending 48-hour delay</StatusChip>}
                {mine && canAccept && (
                  <button onClick={() => updateDestination(c, 'acceptBuffer')} disabled={busy === `destination-${c.id}`} className="shrink-0 mw-btn !min-h-[40px] disabled:opacity-50">Accept destination</button>
                )}
                {mine && matchesCurrent && <button onClick={() => updateDestination(c, 'revokeBuffer')} disabled={busy === `destination-${c.id}`} className="shrink-0 mw-btn-quiet !min-h-[40px] text-[13px]">Revoke destination</button>}
                {!mine && !matchesCurrent && <span className="shrink-0 text-[12.5px] text-ink-soft">Waiting for the holder to register a funding wallet</span>}
              </div>
            )
          })}
        </div>


        {/* spend feed */}
        <SLabel>Card activity</SLabel>
        <div className="mw-raise rounded-[22px] overflow-hidden">
          {events.length === 0 && <div className="px-5 py-10 text-center text-[14px] text-ink-soft">No card activity yet.</div>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-b-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-semibold text-ink truncate">{e.merchant_descriptor ?? 'Unknown merchant'} <span className="text-ink-soft font-normal">· <span className="font-geist-mono">{short(e.member_wallet)}</span></span></div>
                <div className="text-[12.5px] text-ink-soft mt-0.5">
                  {e.decision === 'approved'
                    ? <span className="text-mw-green">Approved</span>
                    : <span className="text-[#B42318]">Declined · {e.decline_reason}</span>}
                  {e.latency_ms != null && ` · ${e.latency_ms}ms`}
                  {e.settled && e.settle_tx && gateway && (
                    <> · <a href={explorerTx(gateway.chainId, e.settle_tx)} target="_blank" rel="noreferrer" className="text-peri-deep hover:underline">settled ✓</a></>
                  )}
                </div>
              </div>
              <div className="font-geist-mono text-[15px] text-ink shrink-0">{fmtUsd(e.amount_atomic_usdc)}</div>
            </div>
          ))}
        </div>
        <Note>Bridge + Stripe card rails are pre-enable. Testnet only, unaudited; an external audit gates real value.</Note>
      </div>
    </MwAuthGuard>
  )
}
