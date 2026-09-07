'use client'

// /earn/[pool] — dark two-column pool terminal (Meteora DAMM-v2 detail as the standard), adapted to our
// single-sided USDG model. LEFT: pool-info panel (TVL, curated allocation + fixed range, current price,
// 24h vol/activity, age/trades, pool address, explorer links, trust score + reasons). RIGHT: position
// summary + Deposit/Withdraw tabs (real approve→deposit / withdraw via the connected wallet) + a Swap tab
// link. Idle-buffer-spend copy; no par/guaranteed language. Real data from discover + meta + position.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createWalletClient, createPublicClient, custom, http, parseUnits } from 'viem'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useGatewayBuffer } from '@/components/web2/v1/useGatewayBuffer'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'

type Meta = { positionManager: `0x${string}`; poolAddress: string; chainId: number; rpcUrl: string; usdg: `0x${string}` | null; feePips: number | null; dynamicFee: boolean; inRange?: boolean | null; currentTick?: number | null; live: boolean }
type Metrics = { pairLabel: string; tvlUsd: number; vol24Usd: number; volTvlRatio: number | null; priceQuotePerBase: number | null; poolAgeDays: number | null; txCount24: number | null; riskScore: number; reasons: string[]; live: boolean }
type Snapshot = { takenAt: string; positionValueAtomic: string; pnlAtomic: string }
type Position = { positionValueAtomic: string | null; bufferBalanceAtomic: string | null; costBasisAtomic?: string | null; unrealizedPnlAtomic?: string | null; history?: Snapshot[] }
type Status = 'idle' | 'switch' | 'approve' | 'deposit' | 'withdraw' | 'record' | 'done'

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`)
const usdg = (a: string | null | undefined) => (a == null ? '$0.00' : `$${(Number(BigInt(a)) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (a: string | null | undefined) => (a == null ? 0 : Number(BigInt(a)) / 1e6)
const norm = (label: string) => label.replace(/\s*\/\s*/g, '-').toLowerCase()

const PANEL = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

function riskChip(score: number) {
  if (score < 20) return { label: 'Low', color: '#34D399' }
  if (score < 50) return { label: 'Med', color: '#F0B45E' }
  return { label: 'High', color: '#F0736E' }
}

export function V1PoolDetail({ slug }: { slug: string }) {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [m, setM] = useState<Metrics | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [wpct, setWpct] = useState(100)
  const [status, setStatus] = useState<Status>('idle')
  const [err, setErr] = useState('')

  const decoded = useMemo(() => decodeURIComponent(slug).toLowerCase(), [slug])
  const pairLabel = m?.pairLabel ?? decoded.replace(/-/g, ' / ').toUpperCase()
  const [base, quote] = useMemo(() => {
    const parts = pairLabel.split('/').map((s) => s.trim())
    return [parts[0] || 'TOKEN', parts[1] || 'USDG']
  }, [pairLabel])

  useEffect(() => {
    fetch(`/api/gateway/meta?pool=${encodeURIComponent(slug)}`).then((r) => r.json()).then((d) => setMeta(d?.success ? d.meta : null)).catch(() => {})
    fetch('/api/gateway/discover').then((r) => r.json()).then((d) => {
      const list: Metrics[] = d?.success && Array.isArray(d.pools) ? d.pools : []
      setM(list.find((p) => norm(p.pairLabel) === decoded || norm(p.pairLabel) === slug.toLowerCase()) ?? null)
    }).catch(() => {})
  }, [slug, decoded])

  const refreshPosition = useCallback(() => {
    if (!address) { setPos(null); return }
    fetch(`/api/gateway/position?address=${address}&pool=${encodeURIComponent(slug)}`)
      .then((r) => r.json()).then((d) => setPos(d?.success ? d.position : null)).catch(() => setPos(null))
  }, [address, slug])
  useEffect(refreshPosition, [refreshPosition])

  // Buffer is owner-gated (audit L-03): revealed only after the wallet signs. Position value below is public.
  const { buffer: bufAtomic, revealed, revealing, reveal } = useGatewayBuffer(address, slug)
  // Real trailing yield, Meteora-style: 24h fees ÷ TVL, annualized. 24h fees = 24h volume × fee tier.
  const feeRate = meta?.feePips != null ? meta.feePips / 1e6 : null
  const dayFeesUsd = feeRate != null && m ? m.vol24Usd * feeRate : null
  const estAprPct = feeRate != null && m && m.tvlUsd > 0 ? (m.vol24Usd * feeRate) / m.tvlUsd * 365 * 100 : null
  const feeTierLabel = meta?.feePips != null ? `${(meta.feePips / 1e4).toFixed(2)}%` : meta?.dynamicFee ? 'Dynamic' : '—'
  // Fee-tier band (Krystal cost/vol read): ≤0.05 low · 0.05–0.30 standard · >0.30 high.
  const feePct = meta?.feePips != null ? meta.feePips / 1e4 : null
  const feeBand = feePct == null ? '' : feePct <= 0.05 ? ' · low' : feePct <= 0.3 ? ' · standard' : ' · high'
  const aprLabel = estAprPct != null ? `~${estAprPct < 1 ? estAprPct.toFixed(2) : estAprPct.toFixed(1)}%` : null

  const busy = status !== 'idle' && status !== 'done'
  const working = num(pos?.positionValueAtomic)
  const buffer = num(bufAtomic)
  const hasPos = working + buffer > 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function injected(): any { return typeof window !== 'undefined' ? (window as any).ethereum : null }
  function chainObj(mm: Meta) {
    return { id: mm.chainId, name: 'robinhood', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [mm.rpcUrl] } } } as const
  }
  async function ensureChain(eth: ReturnType<typeof injected>, mm: Meta) {
    const hex = `0x${mm.chainId.toString(16)}`
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (e) { if ((e as any)?.code === 4902) await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: 'Robinhood Chain Testnet', rpcUrls: [mm.rpcUrl], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }] }); else throw e }
  }

  async function deposit() {
    setErr('')
    if (!isConnected || !address) { privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' }); return }
    if (!meta || !meta.live || !meta.usdg) { setErr('This pool isn’t live for deposits yet.'); return }
    const atomic = parseUnits(amount || '0', 6)
    if (atomic <= 0n) { setErr('Enter an amount.'); return }
    const eth = injected()
    if (!eth) { setErr('Connect an external EVM wallet to deposit (embedded-wallet deposits are coming).'); return }
    try {
      setStatus('switch'); await ensureChain(eth, meta)
      const chain = chainObj(meta)
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
      setStatus('done'); setAmount(''); refreshPosition()
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr((e as any)?.shortMessage ?? (e as Error)?.message ?? 'Deposit failed'); setStatus('idle')
    }
  }

  async function withdraw() {
    setErr('')
    if (!isConnected || !address) { privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' }); return }
    if (!meta || !meta.live) { setErr('This pool isn’t live yet.'); return }
    const eth = injected()
    if (!eth) { setErr('Connect an external EVM wallet to withdraw.'); return }
    try {
      setStatus('switch'); await ensureChain(eth, meta)
      const chain = chainObj(meta)
      const wallet = createWalletClient({ account: address as `0x${string}`, chain, transport: custom(eth) })
      const pub = createPublicClient({ chain, transport: http(meta.rpcUrl) })
      const shares = (await pub.readContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'sharesOf', args: [address as `0x${string}`] })) as bigint
      const toBurn = (shares * BigInt(wpct)) / 100n
      if (toBurn <= 0n) { setErr('Nothing to withdraw.'); setStatus('idle'); return }
      setStatus('withdraw')
      const wh = await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'withdraw', args: [toBurn] })
      const rc = await pub.waitForTransactionReceipt({ hash: wh })
      if (rc.status !== 'success') throw new Error('Withdraw reverted')
      setStatus('done'); refreshPosition()
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr((e as any)?.shortMessage ?? (e as Error)?.message ?? 'Withdraw failed'); setStatus('idle')
    }
  }

  const depBtn = !isConnected ? 'Connect Wallet' : status === 'switch' ? 'Confirm network…' : status === 'approve' ? 'Approve USDG…' : status === 'deposit' ? 'Depositing…' : status === 'record' ? 'Recording…' : status === 'done' ? 'Deposited ✓' : 'Deposit USDG'
  const wBtn = !isConnected ? 'Connect Wallet' : status === 'switch' ? 'Confirm network…' : status === 'withdraw' ? 'Withdrawing…' : status === 'done' ? 'Withdrawn ✓' : 'Withdraw'
  const chip = m ? riskChip(m.riskScore) : null

  return (
    <div>
      <Link href="/v1" className="text-[13px] no-underline" style={{ color: '#9B9BAD' }}>← Discover</Link>

      {/* header */}
      <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-9 h-9 rounded-full" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }} />
            <h1 className="font-atx-display font-semibold tracking-[-0.03em] text-[28px]">{pairLabel}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Tag>Uniswap V4</Tag><Tag>Curated</Tag><Tag>Robinhood Testnet</Tag>
            <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={meta?.live ? { color: '#34D399', background: 'rgba(52,211,153,0.12)' } : { color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' }}>{meta?.live ? 'Live' : 'Curating'}</span>
            {meta?.inRange != null && (
              <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={meta.inRange ? { color: '#34D399', background: 'rgba(52,211,153,0.12)' } : { color: '#F0B45E', background: 'rgba(240,180,94,0.12)' }}>
                {meta.inRange ? 'In range · earning fees' : 'Out of range · fees paused'}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-[12px] px-4 py-2.5 text-right" style={PANEL}>
          <div className="font-mono font-bold text-[22px]" style={{ color: '#8A82F4' }}>{aprLabel ?? (m?.volTvlRatio != null ? `${m.volTvlRatio.toFixed(1)}×` : '—')}</div>
          <div className="text-[10.5px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{aprLabel ? 'Est. Fee APR · 24h' : '24h Vol / TVL'}</div>
        </div>
      </div>

      <div className="grid gap-5 mt-6" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(320px,1fr)' }}>
        {/* LEFT: pool info */}
        <div className="rounded-[16px] p-6 min-[900px]:order-1 order-2" style={PANEL}>
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Total Value Locked</div>
          <div className="font-mono font-bold text-[30px] mt-1.5">{m ? usd(m.tvlUsd) : '—'}</div>
          <div className="text-[12.5px] mt-1" style={{ color: '#8A82F4' }}>Curated + spun up by Mintware</div>

          {/* allocation */}
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mt-6" style={{ color: '#63636F' }}>How your USDG is put to work</div>
          <div className="flex h-4 rounded-full overflow-hidden mt-3">
            <span style={{ width: '50%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
            <span style={{ width: '50%', background: 'rgba(138,130,244,0.22)' }} />
          </div>
          <div className="flex flex-col gap-2 mt-3 text-[13px]">
            <AllocRow color="#8A82F4" label={`Deployed in ${base}`} sub="earns trading fees" pct="≤50%" />
            <AllocRow color="rgba(138,130,244,0.35)" label="Idle in Morpho" sub="earns lending yield · zero IL" pct="≥50%" />
          </div>
          <div className="relative h-9 mt-4 rounded-[10px] overflow-hidden" style={INNER}>
            <div className="absolute inset-y-0" style={{ left: '12%', right: '12%', background: 'linear-gradient(180deg,rgba(138,130,244,0.28),rgba(138,130,244,0.08))', borderLeft: '2px solid rgba(138,130,244,0.5)', borderRight: '2px solid rgba(138,130,244,0.5)' }} />
            <div className="absolute inset-y-0" style={{ left: '50%', width: '2px', background: '#F4F4FA' }} />
          </div>
          <div className="text-[11.5px] mt-1.5" style={{ color: '#63636F' }}>Fixed wide range (~10× up / −90% down) — always in range, no rebalancing.</div>

          {/* metadata rows */}
          <div className="mt-6 flex flex-col">
            <Meta2 k="Current Pool Price" v={m?.priceQuotePerBase != null ? `1 ${base} ≈ ${m.priceQuotePerBase < 0.01 ? m.priceQuotePerBase.toPrecision(3) : m.priceQuotePerBase.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${quote}` : '—'} />
            <Meta2 k="24h Volume" v={m ? usd(m.vol24Usd) : '—'} />
            <Meta2 k="Fee tier" v={feeTierLabel + feeBand} />
            <Meta2 k="24h Fees (est)" v={dayFeesUsd != null ? usd(dayFeesUsd) : '—'} />
            <Meta2 k="Est. Fee APR · 24h, gross of IL" v={aprLabel ?? '—'} />
            <Meta2 k="Activity (Vol / TVL)" v={m?.volTvlRatio != null ? `${m.volTvlRatio.toFixed(2)}×` : '—'} />
            <Meta2 k="24h Trades" v={m?.txCount24 != null ? m.txCount24.toLocaleString() : '—'} />
            <Meta2 k="Pool age" v={m?.poolAgeDays != null ? `${m.poolAgeDays}d` : '—'} />
            <Meta2 k="Network" v="Robinhood Testnet (46630)" />
            <Meta2 k="Pool Address" v={meta ? `${meta.poolAddress.slice(0, 8)}…${meta.poolAddress.slice(-6)}` : (m ? '—' : '—')} mono />
          </div>

          {/* trust */}
          {chip && (
            <div className="mt-5 rounded-[12px] p-3.5" style={INNER}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Trust</span>
                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: chip.color, background: `${chip.color}1A` }}>{chip.label} · {m!.riskScore}</span>
              </div>
              {m!.reasons.length > 0 && <div className="text-[12px] mt-2 leading-[1.5]" style={{ color: '#9B9BAD' }}>{m!.reasons.join(' · ')}</div>}
              <div className="text-[11px] mt-2" style={{ color: '#63636F' }}>The score ranks the queue; it never certifies safety — a human curates every pool.</div>
            </div>
          )}

          {/* explorers */}
          {meta && (
            <div className="flex gap-3 mt-5 flex-wrap text-[12.5px]">
              <a href={`https://robinhoodchain.blockscout.com/address/${meta.poolAddress}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Explorer ↗</a>
              <a href={`https://www.geckoterminal.com/robinhood/pools/${meta.poolAddress}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>GeckoTerminal ↗</a>
              <a href={`https://dexscreener.com/robinhood/${meta.poolAddress}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>DEXScreener ↗</a>
            </div>
          )}
        </div>

        {/* RIGHT: action panel */}
        <div className="flex flex-col gap-5 min-[900px]:order-2 order-1">
          {/* position summary */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="grid grid-cols-2 gap-4">
              <Sum k="Position value" v={usdg(pos?.positionValueAtomic)} />
              {revealed ? (
                <Sum k="Spendable buffer" v={usdg(bufAtomic)} accent />
              ) : (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Spendable buffer</div>
                  <button
                    onClick={reveal}
                    disabled={revealing || !isConnected}
                    className="font-mono font-bold text-[15px] mt-1 cursor-pointer disabled:cursor-default text-left"
                    style={{ color: '#8A82F4' }}
                  >
                    {!isConnected ? 'Connect to view' : revealing ? 'Verifying…' : 'Verify to view →'}
                  </button>
                </div>
              )}
            </div>
            {hasPos && pos?.costBasisAtomic != null && (
              <div className="mt-4 pt-4 flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex justify-between items-baseline text-[13px]">
                  <span style={{ color: '#9B9BAD' }}>Net vs your deposit <span style={{ color: '#63636F' }}>({usdg(pos.costBasisAtomic)} in)</span></span>
                  {(() => {
                    const up = num(pos.unrealizedPnlAtomic) >= 0
                    return <span className="font-mono font-bold" style={{ color: up ? '#34D399' : '#F0736E' }}>{up ? '+' : ''}{usdg(pos.unrealizedPnlAtomic)}</span>
                  })()}
                </div>
                {(() => {
                  const wk = (pos.history ?? []).find((h) => Date.now() - Date.parse(h.takenAt) >= 7 * 864e5)
                  if (!wk) return null
                  const d7 = num(pos.positionValueAtomic) - num(wk.positionValueAtomic)
                  const up = d7 >= 0
                  return (
                    <div className="flex justify-between items-baseline text-[12px]">
                      <span style={{ color: '#63636F' }}>Change · 7d</span>
                      <span className="font-mono" style={{ color: up ? '#34D399' : '#F0736E' }}>{up ? '+' : ''}${Math.abs(d7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* deposit / withdraw */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="flex gap-1.5 mb-4">
              {(['deposit', 'withdraw'] as const).map((t) => (
                <button key={t} onClick={() => { setTab(t); setErr(''); setStatus('idle') }} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer capitalize" style={tab === t ? { background: 'rgba(255,255,255,0.09)', color: '#F4F4FA' } : { color: '#9B9BAD' }}>{t}</button>
              ))}
              <Link href="/v1/swap" className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold no-underline" style={{ color: '#9B9BAD' }}>Swap ↗</Link>
            </div>

            {tab === 'deposit' ? (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}><span>Enter amount</span><span>USDG</span></div>
                  <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} disabled={busy} className="bg-transparent outline-none font-mono font-bold text-[26px] w-full mt-2" style={{ color: '#F4F4FA' }} />
                </div>
                {Number(amount) > 0 && estAprPct != null && (
                  <div className="mt-3 rounded-[12px] p-3" style={INNER}>
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: '#9B9BAD' }}>Est. fees / yr at current pace</span>
                      <span className="font-mono font-bold" style={{ color: '#34D399' }}>~{usd(Number(amount) * (estAprPct / 100) * 0.5)}</span>
                    </div>
                    <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: '#63636F' }}>
                      On the ~50% deployed as liquidity, at the trailing-24h fee rate — an estimate, not a projection. The rest earns Morpho lending; fees are gross of impermanent loss.
                    </div>
                  </div>
                )}
                <button onClick={deposit} disabled={busy} className="w-full mt-3.5 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default" style={busy ? { background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}>{depBtn}</button>
                <div className="flex justify-between mt-4 text-[12.5px]" style={{ color: '#9B9BAD' }}><span>Locks anything?</span><span style={{ color: '#34D399', fontWeight: 600 }}>No — withdraw anytime</span></div>
              </>
            ) : (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Withdraw</div>
                  <div className="flex gap-2 mt-3">
                    {[25, 50, 100].map((p) => (
                      <button key={p} onClick={() => setWpct(p)} disabled={busy} className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={wpct === p ? { background: 'rgba(138,130,244,0.18)', color: '#F4F4FA', border: '1px solid rgba(138,130,244,0.4)' } : { background: 'transparent', color: '#9B9BAD', border: '1px solid rgba(255,255,255,0.1)' }}>{p === 100 ? 'Max' : `${p}%`}</button>
                    ))}
                  </div>
                  <div className="text-[12px] mt-3" style={{ color: '#9B9BAD' }}>Returns your pro-rata share at the current price (subject to impermanent loss).</div>
                </div>
                <button onClick={withdraw} disabled={busy || !hasPos} className="w-full mt-3.5 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default" style={busy || !hasPos ? { background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff' }}>{!hasPos ? 'No position' : wBtn}</button>
              </>
            )}
            {err && <div className="text-[12.5px] mt-2.5" style={{ color: '#F0736E' }}>{err}</div>}
          </div>

          {/* the loop */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>The loop</div>
            <div className="flex flex-col gap-3 mt-3">
              <Loop n="01" t="Earns while staged" d="Idle USDG earns lending yield in Morpho from block one." />
              <Loop n="02" t="Provides liquidity" d="A capped share is paired into this pool and earns trading fees." />
              <Loop n="03" t="Spend the yield" d="Fees fill your spendable buffer — your position is never unwound." />
            </div>
          </div>
        </div>
      </div>

      <p className="text-[12px] mt-6" style={{ color: '#63636F' }}>
        Robinhood testnet · metrics live from GeckoTerminal ·{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.05)' }}>{children}</span>
}
function Meta2({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ color: '#9B9BAD' }}>{k}</span>
      <span className={mono ? 'font-mono' : 'font-medium'} style={{ color: '#F4F4FA' }}>{v}</span>
    </div>
  )
}
function AllocRow({ color, label, sub, pct }: { color: string; label: string; sub: string; pct: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} /><span><span className="font-medium">{label}</span> <span style={{ color: '#63636F' }}>· {sub}</span></span></span>
      <span className="font-mono" style={{ color: '#9B9BAD' }}>{pct}</span>
    </div>
  )
}
function Sum({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[20px] mt-1" style={{ color: accent ? '#34D399' : '#F4F4FA' }}>{v}</div>
    </div>
  )
}
function Loop({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#8A82F4' }}>{n}</span>
      <span><span className="font-semibold text-[13.5px]">{t}</span><div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#9B9BAD' }}>{d}</div></span>
    </div>
  )
}
