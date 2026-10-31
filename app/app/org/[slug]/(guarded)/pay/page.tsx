'use client'

// Pay a vendor (#4) — one recipient, one amount, an optional category + memo for reporting. Validated
// against the caller's CUMULATIVE daily cap + the treasury's on-chain headroom, then RECORDED to the
// unified treasury spend ledger (treasury_spend_events). On-chain per-recipient settlement is the next
// milestone (see app/api/orgs/[id]/pay/route.ts header). NOT a netting engine — one payment. Chrome
// comes from the shared TeamTerminalShell layout.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { PageHead, Note, IconSend } from '@/components/web2/TeamKit'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { policyForRole } from '@/lib/org/rolePresets'

const CHAINS = [
  { id: 84532, name: 'Base Sepolia' },
]
const toAtomic = (usd: string) => {
  const n = Math.round(parseFloat(usd) * 1e6)
  return Number.isFinite(n) && n > 0 ? String(n) : null
}

export default function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [chainId, setChainId] = useState(84532)
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // Permission to pay vendors — owner or a role with canPayVendors (manager). Resolved from the
  // caller's OWN membership on the ?address read (server also enforces this on /pay; this just hides
  // the form from contributors/vendors so it never looks actionable). 'loading' until we know.
  const [perm, setPerm] = useState<'loading' | 'allowed' | 'denied'>('loading')

  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then((d) => {
      if (!d?.org) return
      setOrgId(d.org.id); setOrgName(d.org.name)
      if (!address) { setPerm('loading'); return } // wait for identity before deciding
      const isOwner = !!(d.org.ownerWallet && d.org.ownerWallet.toLowerCase() === address.toLowerCase())
      const canPay = isOwner || (d.member?.status === 'active' && policyForRole(d.member.role).canPayVendors)
      setPerm(canPay ? 'allowed' : 'denied')
    }).catch(() => {})
  }, [slug, address])

  const submit = async () => {
    if (!orgId || !address) return
    const atomic = toAtomic(amount)
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return setResult({ ok: false, text: 'Enter a valid recipient address.' })
    if (!atomic) return setResult({ ok: false, text: 'Enter a valid amount.' })
    setBusy(true); setResult(null)
    try {
      const res = await signedOrgFetch({
        path: `/api/orgs/${orgId}/pay`, action: 'mintware-org-pay',
        payload: { payments: [{ to, amountUsdc: atomic, chainId }], category: category || undefined, memo: memo || undefined }, address, signMessageAsync,
      })
      const d = await res.json()
      if (res.ok && d.ok) setResult({ ok: true, text: `Recorded ✓ ${amount} USDC to ${to.slice(0, 6)}… is in your treasury ledger. Nothing has been sent on-chain yet.` })
      else setResult({ ok: false, text: d.error || d.message || 'Payment failed.' })
    } catch (e) { setResult({ ok: false, text: String(e) }) } finally { setBusy(false) }
  }

  return (
    <MwAuthGuard>
      <div className="max-w-[560px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: orgName || 'Org' }}
          icon={<IconSend size={24} />}
          title="Pay a vendor"
          status={{ tone: 'building', label: 'Records only' }}
          lede="Record one payment from the treasury. It's checked against your role's daily cap and the treasury's available balance, then added to your ledger. Sending it on-chain to the recipient isn't built yet."
        />

        {perm === 'denied' ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-mid leading-[1.55]">
            Paying vendors from the treasury is limited to the <span className="font-semibold text-ink">owner</span> and <span className="font-semibold text-ink">managers</span>. Your role can still hold and spend on your own card. Ask an owner if you need to send payments.
          </div>
        ) : perm === 'loading' ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-soft">Checking your permissions…</div>
        ) : (
          <>
            <div className="mw-raise rounded-[24px] p-6 mt-7 flex flex-col gap-5">
              <label className="block"><span className="text-[13px] font-semibold text-ink-mid">Recipient</span>
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px] font-mono" />
              </label>
              <div className="flex gap-3">
                <label className="flex-1 block"><span className="text-[13px] font-semibold text-ink-mid">Amount (USDC)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px] tabular-nums" />
                </label>
                <label className="block"><span className="text-[13px] font-semibold text-ink-mid">Recipient chain</span>
                  <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="mt-1.5 rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px] bg-white">
                    {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex gap-3 max-[520px]:flex-col">
                <label className="flex-1 block"><span className="text-[13px] font-semibold text-ink-mid">Category <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· for reports</span></span>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Contractors" maxLength={80} className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px]" />
                </label>
                <label className="flex-1 block"><span className="text-[13px] font-semibold text-ink-mid">Memo <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· optional</span></span>
                  <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What's this for?" maxLength={280} className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px]" />
                </label>
              </div>
              <button onClick={submit} disabled={busy} className="mw-btn !min-h-[48px] disabled:opacity-50">{busy ? 'Recording…' : 'Record payment'}</button>
            </div>

            {result && <div role="status" className={`mt-4 rounded-[16px] px-4 py-3 text-[14px] leading-[1.5] ${result.ok ? 'bg-[#E3F4EA] text-[#0F5F37]' : 'bg-[#FBE9E7] text-[#B42318]'}`}>{result.text}</div>}

            <Note>Payments are recorded on Base Sepolia only. Testnet, unaudited; on-chain recipient settlement is the next milestone.</Note>
          </>
        )}
      </div>
    </MwAuthGuard>
  )
}
