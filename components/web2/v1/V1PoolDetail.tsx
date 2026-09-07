'use client'

// /earn/[pool] detail — dark app surface (Meteora frame, our simpler single-sided mechanics). Pair
// header + real stat row (from /api/gateway/discover), the signature allocation + fixed-range visual,
// a one-field USDG deposit (real approve→deposit via the connected wallet), and the position panel
// (buffer + working, from /api/gateway/position). Idle-buffer-spend copy; no par/guaranteed language.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createWalletClient, createPublicClient, custom, http, parseUnits } from 'viem'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'

type Meta = { positionManager: `0x${string}`; poolAddress: string; chainId: number; rpcUrl: string; usdg: `0x${string}` | null; live: boolean }
type Metrics = { pairLabel: string; tvlUsd: number; vol24Usd: number; volTvlRatio: number | null; live: boolean }
type Position = { positionValueAtomic: string | null; bufferBalanceAtomic: string | null }
type Status = 'idle' | 'switch' | 'approve' | 'deposit' | 'record' | 'done'

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`)
const usdg = (a: string | null | undefined) => (a == null ? '$0.00' : `$${(Number(BigInt(a)) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (a: string | null | undefined) => (a == null ? 0 : Number(BigInt(a)) / 1e6)
const norm = (label: string) => label.replace(/\s*\/\s*/g, '-').toLowerCase()

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

export function V1PoolDetail({ slug }: { slug: string }) {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [err, setErr] = useState('')

  const decoded = useMemo(() => decodeURIComponent(slug), [slug])
  const pairLabel = metrics?.pairLabel ?? decoded.replace(/-/g, ' / ').toUpperCase()

  useEffect(() => {
    fetch(`/api/gateway/meta?pool=${encodeURIComponent(slug)}`).then((r) => r.json()).then((d) => setMeta(d?.success ? d.meta : null)).catch(() => {})
    fetch('/api/gateway/discover').then((r) => r.json()).then((d) => {
      const list: Metrics[] = d?.success && Array.isArray(d.pools) ? d.pools : []
      setMetrics(list.find((p) => norm(p.pairLabel) === decoded.toLowerCase() || norm(p.pairLabel) === slug) ?? null)
    }).catch(() => {})
  }, [slug, decoded])

  const refreshPosition = useCallback(() => {
    if (!address) { setPos(null); return }
    fetch(`/api/gateway/position?address=${address}&pool=${encodeURIComponent(slug)}`)
      .then((r) => r.json()).then((d) => setPos(d?.success ? d.position : null)).catch(() => setPos(null))
  }, [address, slug])
  useEffect(refreshPosition, [refreshPosition])

  const busy = status !== 'idle' && status !== 'done'

  async function deposit() {
    setErr('')
    if (!isConnected || !address) { privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' }); return }
    if (!meta || !meta.live || !meta.usdg) { setErr('This pool isn’t live for deposits yet.'); return }
    const atomic = parseUnits(amount || '0', 6)
    if (atomic <= 0n) { setErr('Enter an amount.'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (typeof window !== 'undefined' ? (window as any).ethereum : null)
    if (!eth) { setErr('Connect an external EVM wallet to deposit (embedded-wallet deposits are coming).'); return }
    const chain = { id: meta.chainId, name: 'robinhood', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [meta.rpcUrl] } } } as const
    try {
      setStatus('switch')
      const hex = `0x${meta.chainId.toString(16)}`
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((e as any)?.code === 4902) {
          await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: 'Robinhood Chain Testnet', rpcUrls: [meta.rpcUrl], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }] })
        } else throw e
      }
      const wallet = createWalletClient({ account: address as `0x${string}`, chain, transport: custom(eth) })
      const pub = createPublicClient({ chain, transport: http(meta.rpcUrl) })
      setStatus('approve')
      const ah = await wallet.writeContract({ address: meta.usdg, abi: ERC20_ABI, functionName: 'approve', args: [meta.positionManager, atomic] })
      await pub.waitForTransactionReceipt({ hash: ah })
      setStatus('deposit')
      const dh = await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deposit', args: [atomic] })
      const rc = await pub.waitForTransactionReceipt({ hash: dh })
      if (rc.status !== 'success') throw new Error('Deposit reverted')
      setStatus('record')
      await fetch('/api/gateway/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, txHash: dh, pool: slug }) })
      setStatus('done')
      setAmount('')
      refreshPosition()
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr((e as any)?.shortMessage ?? (e as Error)?.message ?? 'Deposit failed')
      setStatus('idle')
    }
  }

  const btn = !isConnected ? 'Connect Wallet'
    : status === 'switch' ? 'Confirm network…'
    : status === 'approve' ? 'Approve USDG…'
    : status === 'deposit' ? 'Depositing…'
    : status === 'record' ? 'Recording…'
    : status === 'done' ? 'Deposited ✓'
    : 'Deposit USDG'

  const working = num(pos?.positionValueAtomic)
  const buffer = num(pos?.bufferBalanceAtomic)
  const hasPos = working + buffer > 0

  return (
    <div>
      <Link href="/v1" className="text-[13px] no-underline" style={{ color: '#9B9BAD' }}>← Discover</Link>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <span className="w-9 h-9 rounded-full" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }} />
        <h1 className="font-atx-display font-semibold tracking-[-0.03em] text-[26px]">{pairLabel}</h1>
        <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={meta?.live ? { color: '#34D399', background: 'rgba(52,211,153,0.12)' } : { color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' }}>
          {meta?.live ? 'Live' : 'Curating'}
        </span>
      </div>

      {/* stat row */}
      <div className="grid grid-cols-3 gap-3 mt-5 max-w-[520px]">
        <Stat k="TVL" v={metrics ? usd(metrics.tvlUsd) : '—'} />
        <Stat k="24h Volume" v={metrics ? usd(metrics.vol24Usd) : '—'} />
        <Stat k="Activity" v={metrics?.volTvlRatio != null ? `${metrics.volTvlRatio.toFixed(1)}×` : '—'} />
      </div>

      <div className="grid gap-5 mt-7" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(300px,1fr)' }}>
        {/* left: how your USDG works */}
        <div className="flex flex-col gap-5 min-[900px]:order-1 order-2">
          <div className="rounded-[16px] p-6" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.1em] font-semibold" style={{ color: '#8A82F4' }}>How your USDG is put to work</div>
            {/* allocation split */}
            <div className="flex h-4 rounded-full overflow-hidden mt-4">
              <span style={{ width: '50%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
              <span style={{ width: '50%', background: 'rgba(138,130,244,0.22)' }} />
            </div>
            <div className="flex gap-6 mt-3 text-[12.5px] flex-wrap" style={{ color: '#9B9BAD' }}>
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: '#8A82F4' }} />Deployed in {pairLabel.split(' / ')[0]} (earns fees)</span>
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'rgba(138,130,244,0.22)' }} />Idle in Morpho (earns lending, zero IL)</span>
            </div>
            {/* fixed range band */}
            <div className="mt-6 text-[11px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Fixed wide range · always in range</div>
            <div className="relative h-10 mt-2 rounded-[10px] overflow-hidden" style={INNER}>
              <div className="absolute inset-y-0" style={{ left: '12%', right: '12%', background: 'linear-gradient(180deg,rgba(138,130,244,0.28),rgba(138,130,244,0.08))', borderLeft: '2px solid rgba(138,130,244,0.5)', borderRight: '2px solid rgba(138,130,244,0.5)' }} />
              <div className="absolute inset-y-0" style={{ left: '50%', width: '2px', background: '#F4F4FA' }} />
              <span className="absolute text-[10px] font-mono" style={{ left: '50%', transform: 'translateX(-50%)', bottom: '2px', color: '#9B9BAD' }}>price</span>
            </div>
            <p className="text-[12.5px] mt-3 leading-[1.5]" style={{ color: '#9B9BAD' }}>
              A wide fixed range (≈10× up / −90% down) means no out-of-range cliff and no rebalancing — and
              only a capped share enters the IL-bearing LP; the rest earns idle in Morpho.
            </p>
          </div>

          <div className="rounded-[16px] p-6" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.1em] font-semibold" style={{ color: '#8A82F4' }}>The loop</div>
            <div className="grid grid-cols-3 max-[560px]:grid-cols-1 gap-4 mt-3">
              <Step n="01" t="Earns while staged" d="Idle USDG earns lending yield in Morpho from block one." />
              <Step n="02" t="Provides liquidity" d="A capped share is paired into this pool and earns trading fees." />
              <Step n="03" t="Spend the yield" d="Fees fill a spendable buffer — your position is never unwound." />
            </div>
          </div>
        </div>

        {/* right: deposit + position */}
        <div className="flex flex-col gap-5 min-[900px]:order-2 order-1">
          <div className="rounded-[16px] p-5" style={CARD}>
            <div className="text-[12px] uppercase tracking-[0.1em] font-semibold" style={{ color: '#8A82F4' }}>Deposit</div>
            <div className="rounded-[14px] p-4 mt-3" style={INNER}>
              <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}><span>Amount</span><span>USDG</span></div>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                disabled={busy}
                className="bg-transparent outline-none font-mono font-bold text-[26px] w-full mt-2"
                style={{ color: '#F4F4FA' }}
              />
            </div>
            <button
              onClick={deposit}
              disabled={busy}
              className="w-full mt-3.5 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
              style={busy ? { background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}
            >
              {btn}
            </button>
            {err && <div className="text-[12.5px] mt-2.5" style={{ color: '#F0736E' }}>{err}</div>}
            <div className="flex justify-between mt-4 text-[12.5px]" style={{ color: '#9B9BAD' }}>
              <span>Locks anything?</span><span style={{ color: '#34D399', fontWeight: 600 }}>No — withdraw anytime</span>
            </div>
          </div>

          {hasPos && (
            <div className="rounded-[16px] p-5" style={CARD}>
              <div className="text-[12px] uppercase tracking-[0.1em] font-semibold" style={{ color: '#8A82F4' }}>Your position</div>
              <div className="flex justify-between mt-3 text-[13.5px]"><span style={{ color: '#9B9BAD' }}>Spendable buffer</span><span className="font-mono font-bold">{usdg(pos?.bufferBalanceAtomic)}</span></div>
              <div className="flex justify-between mt-2 text-[13.5px]"><span style={{ color: '#9B9BAD' }}>Working &amp; earning</span><span className="font-mono font-bold">{usdg(pos?.positionValueAtomic)}</span></div>
            </div>
          )}
        </div>
      </div>

      <p className="text-[12px] mt-6 leading-[1.55] max-w-[80ch]" style={{ color: '#63636F' }}>
        In testing on Robinhood Chain — testnet, not yet audited. This is a liquidity position, not a
        deposit, a savings product, or a guaranteed or fixed return: its value moves with the pool price
        and is subject to impermanent loss, and a withdrawal returns your pro-rata share at the current
        price. Metrics are live from GeckoTerminal. External audit gates real value.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[12px] p-3.5" style={{ background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[10.5px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[18px] mt-1">{v}</div>
    </div>
  )
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div>
      <div className="font-mono text-[12px] font-bold" style={{ color: '#8A82F4' }}>{n}</div>
      <div className="font-semibold text-[14px] mt-1">{t}</div>
      <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#9B9BAD' }}>{d}</div>
    </div>
  )
}
