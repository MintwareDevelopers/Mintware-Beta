'use client'

// YPN on Arc — the live demo surface. Shows the spend stack deployed on Circle's Arc testnet and reads the
// vault's live total assets straight off the Arc RPC (client-side eth_call). Everything here has an on-chain
// transaction behind it — this page is the clickable version of the Arc integration proof.

import { useEffect, useState } from 'react'
import { MwNav } from '@/components/web2/MwNav'
import { ARC_TESTNET, ARC_TESTNET_DEPLOYMENT } from '@/config/arc'

const EXPLORER = 'https://testnet.arcscan.app/address/'
// selector for totalAssets() — keccak256("totalAssets()")[0:4]
const TOTAL_ASSETS_SELECTOR = '0x01e1d114'

type Contract = { label: string; addr: string; note: string }

const CONTRACTS: Contract[] = [
  { label: 'Vault', addr: ARC_TESTNET_DEPLOYMENT.vault, note: 'MintwareYieldVault' },
  { label: 'Payment Gateway', addr: ARC_TESTNET_DEPLOYMENT.gateway, note: 'settleSpend' },
  { label: 'Yield adapter', addr: ARC_TESTNET_DEPLOYMENT.adapter, note: 'ERC-4626 seam' },
  { label: 'CCTP router', addr: ARC_TESTNET_DEPLOYMENT.cctpDepositRouter, note: 'bridge-and-deposit' },
  { label: 'USDC (real Arc)', addr: ARC_TESTNET.usdc, note: '6dp · gas token' },
]

const LEGS = [
  { t: 'Deposit → earn', d: 'USDC deposited into the vault idles into the yield source and earns — while staying spendable.' },
  { t: 'CCTP cross-chain deposit', d: 'A dollar burned on Base arrives as yield-earning Arc vault shares in one relayer tx, via Circle CCTP.' },
  { t: 'Card charge settled in USDC', d: 'An EIP-712 permit → the gateway burns earning shares → pays the card rail in USDC on Arc.' },
]

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export default function ArcDemoPage() {
  const [tvl, setTvl] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(ARC_TESTNET.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ARC_TESTNET_DEPLOYMENT.vault, data: TOTAL_ASSETS_SELECTOR }, 'latest'],
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        const hex = j?.result as string | undefined
        if (!hex || hex === '0x') return setErr(true)
        const usdc = Number(BigInt(hex)) / 1e6
        setTvl(usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      })
      .catch(() => !cancelled && setErr(true))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <MwNav />
    <div className="max-w-[880px] mx-auto px-6 py-10">
      <div className="text-[11px] font-bold tracking-[1.5px] uppercase text-mw-brand mb-3 font-sans">
        Live on Arc testnet · chain {ARC_TESTNET.chainId}
      </div>
      <h1 className="text-[32px] leading-tight font-bold text-mw-ink tracking-[-0.02em] mb-3 font-sans">
        USDC that earns while it&apos;s spendable — on Circle&apos;s Arc.
      </h1>
      <p className="text-[16px] text-mw-ink-2 max-w-[60ch] mb-8">
        The full YPN spend stack is deployed on Arc, wired to the real Arc USDC and CCTP. Every leg of the
        loop has a transaction behind it.
      </p>

      {/* Live NAV */}
      <div className="rounded-2xl border border-mw-border shadow-card p-6 mb-8 bg-mw-surface-card">
        <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-2 font-sans">
          Vault total assets — live from Arc
        </div>
        <div className="text-[40px] font-bold text-mw-ink tracking-[-0.02em] font-mono tabular-nums">
          {tvl ? `$${tvl}` : err ? '—' : '…'}
        </div>
        <div className="text-[13px] text-mw-ink-3 mt-1">
          read client-side via <span className="font-mono">eth_call</span> to {ARC_TESTNET.rpcUrl}
        </div>
      </div>

      {/* The loop */}
      <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-4 font-sans">
        Proven on-chain
      </div>
      <div className="grid gap-3 mb-8">
        {LEGS.map((l) => (
          <div key={l.t} className="rounded-xl border border-mw-border shadow-card p-4 flex gap-3 bg-mw-surface-card">
            <div className="text-mw-green font-bold shrink-0">✓</div>
            <div>
              <div className="font-semibold text-mw-ink text-[15px]">{l.t}</div>
              <div className="text-[13.5px] text-mw-ink-2 mt-0.5">{l.d}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Contracts */}
      <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-4 font-sans">
        Live contracts
      </div>
      <div className="rounded-xl border border-mw-border shadow-card overflow-hidden bg-mw-surface-card">
        {CONTRACTS.map((c, i) => (
          <a
            key={c.addr}
            href={`${EXPLORER}${c.addr}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-between gap-4 px-4 py-3 hover:bg-mw-brand-dim transition-colors ${
              i > 0 ? 'border-t border-mw-border' : ''
            }`}
          >
            <div>
              <div className="font-semibold text-mw-ink text-[14px]">{c.label}</div>
              <div className="text-[12px] text-mw-ink-3">{c.note}</div>
            </div>
            <div className="font-mono text-[12.5px] text-mw-brand tabular-nums">{short(c.addr)}</div>
          </a>
        ))}
      </div>

      <p className="text-[12.5px] text-mw-ink-4 mt-6">
        Testnet — deployed ≠ audited. Yield source is a placeholder until Arc&apos;s native primitive
        (XyloNet XyloVault) is wired; external audit gates real value. Arc mainnet: Sept 16, 2026.
      </p>
    </div>
    </>
  )
}
