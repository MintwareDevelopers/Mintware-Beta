'use client'

// /earn/[pool] — dark two-column pool terminal (Meteora DAMM-v2 detail as the standard), adapted to our
// single-sided USDG model. LEFT: pool-info panel (TVL, curated allocation + fixed range, current price,
// 24h vol/activity, age/trades, pool id, explorer links, trust score + reasons). RIGHT: position
// summary + Deposit/Withdraw tabs + a Swap tab link. No par/guaranteed language.
//
// Earn-vs-LP decision (2026-09-08, docs/developers/lp-gateway-earn-vs-lp-decision.md): 100% of a deposit is
// deployed as liquidity once the owner deploys (no held-back reserve; the old ~50%-idle-in-Morpho split and
// the "spendable buffer" it fed are both gone — harvest always restakes fees into NAV now). Deposit is
// USDG-only, single-input — no Krystal-style zap from any token yet (tracked as a stretch goal in the
// decision doc, not built).
//
// Money path (round-2 audit closeout, 2026-09-08):
//   · O-2  — the route param is the pool's registry key (v4 poolId). Funds go ONLY to the position
//            manager /api/gateway/meta returns for THAT id with `source: 'registry'` (or 'env-fallback'
//            while the registry is empty — shown as a "single-instance dev rig" badge). A 404 = not live.
//   · C-6  — every deposit/withdraw is priced first (dry quote off live pool state) and submitted via
//            `depositWithMin` / `withdrawWithMin` with a 1% floor shown in the review step; the plain
//            calls are used only when meta reports the deployment lacks the *WithMin entrypoints.
//   · O-1  — after the tx mines, the wallet signs the exact record message the route verifies and the
//            result is recorded. UI state is honest: "Deposited on-chain · recording…" → "Recorded" or
//            "Recording failed — funds are safe on-chain; retry". Never a false ✓.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits } from 'viem'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { TokenPair } from '@/components/web2/v1/TokenPair'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { buildGatewayDepositMessage, buildGatewayWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { depositSharesQuote, withdrawLegsQuote, parsePoolState, type SerializedPoolState } from '@/lib/gateway/positionReader'
import { applyToleranceBps } from '@/lib/gateway/v4Math'
import { sanitizeAmountInput } from '@/lib/gateway/amountInput'

// C-6 slippage tolerance applied to every dry quote before it becomes an on-chain floor (bps).
export const SLIPPAGE_TOLERANCE_BPS = 100

type Meta = {
  positionManager: `0x${string}`; staging: `0x${string}` | null; poolAddress: string; pairLabel: string | null; chainId: number; rpcUrl: string
  usdg: `0x${string}` | null; pairedAsset: `0x${string}` | null; pairedDecimals: number | null
  feePips: number | null; dynamicFee: boolean; inRange?: boolean | null; currentTick?: number | null
  source: 'registry' | 'env-fallback'; live: boolean; supportsMin: boolean | null
  // D-4: which yield source backs the staging window — 'real' earns immediately while staged, 'idle'
  // is held ready but not yet earning, 'unknown' when the probe couldn't read it (never guess which).
  adapterKind?: 'idle' | 'real' | 'unknown'
}
type Metrics = { poolAddress: string; pairLabel: string; tvlUsd: number; vol24Usd: number; volTvlRatio: number | null; priceQuotePerBase: number | null; poolAgeDays: number | null; txCount24: number | null; riskScore: number; reasons: string[]; baseSymbol?: string; quoteSymbol?: string; baseLogo?: string | null; quoteLogo?: string | null; live: boolean }
type Snapshot = { takenAt: string; positionValueAtomic: string; pnlAtomic: string }
type Position = { shares: string; positionValueAtomic: string | null; bufferBalanceAtomic: string | null; costBasisAtomic?: string | null; unrealizedPnlAtomic?: string | null; recorded?: boolean; history?: Snapshot[] }
type PositionResponse = { position: Position; poolState: SerializedPoolState | null }
type Status = 'idle' | 'quote' | 'review' | 'switch' | 'approve' | 'deposit' | 'withdraw' | 'record' | 'recorded' | 'record_failed'
type Review =
  | { kind: 'deposit'; amountAtomic: bigint; estShares: bigint; minShares: bigint; withMin: boolean }
  | { kind: 'withdraw'; sharesToBurn: bigint; estQuote: bigint; estPaired: bigint; minQuote: bigint; minPaired: bigint; lpQuotable: boolean; withMin: boolean }
type PendingRecord = { kind: 'deposit' | 'withdraw'; txHash: `0x${string}` }

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`)
const usdg = (a: string | bigint | null | undefined) => (a == null ? '$0.00' : `$${(Number(BigInt(a)) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (a: string | null | undefined) => (a == null ? 0 : Number(BigInt(a)) / 1e6)
const norm = (label: string) => label.replace(/\s*\/\s*/g, '-').toLowerCase()
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id)
const fmtUnits = (a: bigint, decimals: number | null, symbol: string) =>
  decimals == null ? `${a.toString()} ${symbol} (raw units)` : `${Number(formatUnits(a, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${symbol}`
const fmtShares = (a: bigint) => Number(formatUnits(a, 6)).toLocaleString('en-US', { maximumFractionDigits: 6 })

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
  const [metaState, setMetaState] = useState<'loading' | 'ok' | 'not_live' | 'unavailable'>('loading')
  const [m, setM] = useState<Metrics | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [wpct, setWpct] = useState(100)
  const [status, setStatus] = useState<Status>('idle')
  const [review, setReview] = useState<Review | null>(null)
  const [pending, setPending] = useState<PendingRecord | null>(null)
  const [err, setErr] = useState('')
  const [alert, setAlert] = useState<{ sinceIso: string } | null>(null)

  // The route param is the pool's registry key (poolId). Legacy label slugs still render metrics but
  // can never resolve a deposit target (meta 404s) — the page says so instead of guessing.
  const decoded = useMemo(() => decodeURIComponent(slug).toLowerCase(), [slug])
  const pairLabel = m?.pairLabel ?? meta?.pairLabel ?? (decoded.startsWith('0x') ? 'Pool' : decoded.replace(/-/g, ' / ').toUpperCase())
  const [base, quote] = useMemo(() => {
    const parts = pairLabel.split('/').map((s) => s.trim().replace(/\s*\d[\d.]*\s*%\s*$/, ''))
    return [parts[0] || 'TOKEN', parts[1] || 'USDG']
  }, [pairLabel])

  useEffect(() => {
    setMetaState('loading')
    fetch(`/api/gateway/meta?pool=${encodeURIComponent(slug)}`).then(async (r) => {
      const d = await r.json().catch(() => null)
      if (r.ok && d?.success) { setMeta(d.meta); setMetaState('ok') }
      else { setMeta(null); setMetaState(r.status === 404 ? 'not_live' : 'unavailable') }
    }).catch(() => { setMeta(null); setMetaState('unavailable') })
    fetch('/api/gateway/discover').then((r) => r.json()).then((d) => {
      const list: Metrics[] = d?.success && Array.isArray(d.pools) ? d.pools : []
      setM(list.find((p) => p.poolAddress?.toLowerCase() === decoded) ?? list.find((p) => norm(p.pairLabel) === decoded) ?? null)
    }).catch(() => {})
    fetch(`/api/gateway/alerts?pool=${encodeURIComponent(slug)}`).then((r) => r.json()).then((d) => {
      const oor = (d?.alerts ?? []).find((a: { kind: string; firing: boolean; sinceIso: string }) => a.kind === 'out_of_range' && a.firing)
      setAlert(oor ? { sinceIso: oor.sinceIso } : null)
    }).catch(() => {})
  }, [slug, decoded])

  // Chain-first position read (+ the live pool state the dry quotes need). Returns the payload so the
  // money path can price off a FRESH read rather than stale render state.
  const fetchPosition = useCallback(async (): Promise<PositionResponse | null> => {
    if (!address) { setPos(null); return null }
    try {
      const r = await fetch(`/api/gateway/position?address=${address}&pool=${encodeURIComponent(slug)}`)
      const d = await r.json()
      if (!d?.success) { setPos(null); return null }
      setPos(d.position)
      return { position: d.position, poolState: d.poolState ?? null }
    } catch { setPos(null); return null }
  }, [address, slug])
  useEffect(() => { void fetchPosition() }, [fetchPosition])

  // Real trailing yield, Meteora-style: 24h fees ÷ TVL, annualized. 24h fees = 24h volume × fee tier.
  const feeRate = meta?.feePips != null ? meta.feePips / 1e6 : null
  const dayFeesUsd = feeRate != null && m ? m.vol24Usd * feeRate : null
  const estAprPct = feeRate != null && m && m.tvlUsd > 0 ? (m.vol24Usd * feeRate) / m.tvlUsd * 365 * 100 : null
  const feeTierLabel = meta?.feePips != null ? `${(meta.feePips / 1e4).toFixed(2)}%` : meta?.dynamicFee ? 'Dynamic' : '—'
  // Fee-tier band (Krystal cost/vol read): ≤0.05 low · 0.05–0.30 standard · >0.30 high.
  const feePct = meta?.feePips != null ? meta.feePips / 1e4 : null
  const feeBand = feePct == null ? '' : feePct <= 0.05 ? ' · low' : feePct <= 0.3 ? ' · standard' : ' · high'
  const aprLabel = estAprPct != null ? `~${estAprPct < 1 ? estAprPct.toFixed(2) : estAprPct.toFixed(1)}%` : null

  const busy = status === 'quote' || status === 'switch' || status === 'approve' || status === 'deposit' || status === 'withdraw' || status === 'record'
  const working = num(pos?.positionValueAtomic)
  const hasPos = working > 0 || (pos?.shares != null && BigInt(pos.shares) > 0n)

  // O-2 client-side invariant: the PM we would fund fronts EXACTLY the pool in the URL, and it came from
  // the registry (or the tagged env rig while the registry is empty). Anything else ⇒ no deposit button.
  const isDevRig = meta?.source === 'env-fallback'
  const targetOk = !!meta && meta.poolAddress.toLowerCase() === decoded && (meta.source === 'registry' ? meta.live : isDevRig)
  const canDeposit = targetOk && !!meta?.usdg
  // V1-01 fix (independent Codex audit): a retired instance resolves from the backend now (meta/
  // position/withdraw no longer 404 a deactivated pool — see routeInstance.ts's `includeInactive`),
  // but `targetOk` requires `meta.live`, which is deliberately false for a retired row. Withdraw must
  // NOT share that gate — only deposit eligibility should require `live`; a resolved instance (active
  // or retired) is always withdrawable.
  const canWithdraw = !!meta && meta.poolAddress.toLowerCase() === decoded && (meta.source === 'registry' || isDevRig)
  const withMinAvailable = meta?.supportsMin === true

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
  function clients(mm: Meta) {
    const eth = injected()
    if (!eth) throw new Error('Connect an external EVM wallet to continue (embedded-wallet transactions are coming).')
    const chain = chainObj(mm)
    return {
      eth,
      wallet: createWalletClient({ account: address as `0x${string}`, chain, transport: custom(eth) }),
      pub: createPublicClient({ chain, transport: http(mm.rpcUrl) }),
    }
  }
  function fail(e: unknown, fallback: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setErr((e as any)?.shortMessage ?? (e as Error)?.message ?? fallback)
    setStatus('idle'); setReview(null)
  }
  function requireWallet(): boolean {
    if (!isConnected || !address) { privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' }); return false }
    return true
  }

  // O-1: sign the exact message the record route verifies (action + address + txHash + pool + issuedAt),
  // POST it, and report truthfully. `pending` keeps the tx so a failed record can be retried.
  async function record(kind: 'deposit' | 'withdraw', txHash: `0x${string}`, mm: Meta) {
    setStatus('record'); setPending({ kind, txHash }); setErr('')
    try {
      const { wallet } = clients(mm)
      const issuedAt = Date.now()
      const build = kind === 'deposit' ? buildGatewayDepositMessage : buildGatewayWithdrawMessage
      const authMessage = build({ address: address!, txHash, pool: mm.poolAddress, issuedAt })
      const authSignature = await wallet.signMessage({ account: address as `0x${string}`, message: authMessage })
      const res = await fetch(`/api/gateway/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, txHash, pool: mm.poolAddress, authMessage, authSignature, issuedAt }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.success) throw new Error(d?.error ?? `record_failed_${res.status}`)
      setStatus('recorded'); setPending(null)
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErr(`Recording failed (${(e as any)?.shortMessage ?? (e as Error)?.message ?? 'unknown'}). Your ${kind} is confirmed on-chain and your funds are safe — retry to record it.`)
      setStatus('record_failed')
    } finally {
      void fetchPosition()
    }
  }
  async function retryRecord() {
    if (!pending || !meta) return
    await record(pending.kind, pending.txHash, meta)
  }

  // ── deposit: price → review → approve → depositWithMin → record ─────────────────────────────────────
  async function reviewDeposit() {
    setErr('')
    if (!requireWallet()) return
    if (!meta || !canDeposit) { setErr('This pool isn’t live for deposits.'); return }
    const atomic = parseUnits(amount || '0', 6)
    if (atomic <= 0n) { setErr('Enter an amount.'); return }
    setStatus('quote')
    try {
      const fresh = await fetchPosition()
      const st = fresh?.poolState ? parsePoolState(fresh.poolState) : null
      if (!st) {
        if (withMinAvailable) throw new Error('Couldn’t read the pool’s live state to price a floor — try again in a moment.')
        setReview({ kind: 'deposit', amountAtomic: atomic, estShares: 0n, minShares: 0n, withMin: false })
        setStatus('review'); return
      }
      const estShares = depositSharesQuote(atomic, st.totalShares, st.totalNav)
      if (estShares <= 0n) throw new Error('Amount is too small to mint any shares at the current NAV.')
      const minShares = applyToleranceBps(estShares, SLIPPAGE_TOLERANCE_BPS)
      setReview({ kind: 'deposit', amountAtomic: atomic, estShares, minShares, withMin: withMinAvailable })
      setStatus('review')
    } catch (e) { fail(e, 'Could not price the deposit') }
  }
  async function confirmDeposit() {
    if (!meta || !review || review.kind !== 'deposit' || !meta.usdg) return
    setErr('')
    try {
      const { eth, wallet, pub } = clients(meta)
      setStatus('switch'); await ensureChain(eth, meta)
      setStatus('approve')
      const ah = await wallet.writeContract({ address: meta.usdg, abi: ERC20_ABI, functionName: 'approve', args: [meta.positionManager, review.amountAtomic] })
      await pub.waitForTransactionReceipt({ hash: ah })
      setStatus('deposit')
      const dh = review.withMin
        ? await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'depositWithMin', args: [review.amountAtomic, review.minShares] })
        : await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deposit', args: [review.amountAtomic] })
      const rc = await pub.waitForTransactionReceipt({ hash: dh })
      if (rc.status !== 'success') throw new Error('Deposit reverted — nothing moved (a floor not met reverts the whole tx).')
      setAmount(''); setReview(null)
      await record('deposit', dh, meta)
    } catch (e) { fail(e, 'Deposit failed') }
  }

  // ── withdraw: price → review → withdrawWithMin → record ─────────────────────────────────────────────
  async function reviewWithdraw() {
    setErr('')
    if (!requireWallet()) return
    if (!meta || !canWithdraw) { setErr('This pool isn’t live.'); return }
    setStatus('quote')
    try {
      const fresh = await fetchPosition()
      const shares = fresh?.position?.shares != null ? BigInt(fresh.position.shares) : 0n
      const toBurn = (shares * BigInt(wpct)) / 100n
      if (toBurn <= 0n) throw new Error('Nothing to withdraw.')
      const st = fresh?.poolState ? parsePoolState(fresh.poolState) : null
      if (!st) {
        if (withMinAvailable) throw new Error('Couldn’t read the pool’s live state to price a floor — try again in a moment.')
        setReview({ kind: 'withdraw', sharesToBurn: toBurn, estQuote: 0n, estPaired: 0n, minQuote: 0n, minPaired: 0n, lpQuotable: false, withMin: false })
        setStatus('review'); return
      }
      const legs = withdrawLegsQuote(toBurn, st)
      setReview({
        kind: 'withdraw', sharesToBurn: toBurn,
        estQuote: legs.quoteOut, estPaired: legs.pairedOut,
        minQuote: applyToleranceBps(legs.quoteOut, SLIPPAGE_TOLERANCE_BPS),
        minPaired: legs.lpQuotable ? applyToleranceBps(legs.pairedOut, SLIPPAGE_TOLERANCE_BPS) : 0n,
        lpQuotable: legs.lpQuotable, withMin: withMinAvailable,
      })
      setStatus('review')
    } catch (e) { fail(e, 'Could not price the withdrawal') }
  }
  async function confirmWithdraw() {
    if (!meta || !review || review.kind !== 'withdraw') return
    setErr('')
    try {
      const { eth, wallet, pub } = clients(meta)
      setStatus('switch'); await ensureChain(eth, meta)
      setStatus('withdraw')
      const wh = review.withMin
        ? await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'withdrawWithMin', args: [review.sharesToBurn, review.minQuote, review.minPaired] })
        : await wallet.writeContract({ address: meta.positionManager, abi: LP_GATEWAY_ABI, functionName: 'withdraw', args: [review.sharesToBurn] })
      const rc = await pub.waitForTransactionReceipt({ hash: wh })
      if (rc.status !== 'success') throw new Error('Withdraw reverted — nothing moved (a floor not met reverts the whole tx).')
      setReview(null)
      await record('withdraw', wh, meta)
    } catch (e) { fail(e, 'Withdraw failed') }
  }
  function cancelReview() { setReview(null); setStatus('idle'); setErr('') }

  const stepLabel: Record<Status, string> = {
    idle: '', quote: 'Pricing…', review: 'Confirm', switch: 'Confirm network…', approve: 'Approve USDG…', deposit: 'Depositing…', withdraw: 'Withdrawing…',
    record: 'Confirmed on-chain · recording…', recorded: 'Recorded ✓', record_failed: 'Retry recording',
  }
  const depBtn = !isConnected ? 'Connect Wallet' : status === 'idle' ? 'Review deposit' : status === 'review' ? 'Confirm deposit' : status === 'recorded' ? 'Deposited · recorded ✓' : stepLabel[status]
  const wBtn = !isConnected ? 'Connect Wallet' : status === 'idle' ? 'Review withdraw' : status === 'review' ? 'Confirm withdraw' : status === 'recorded' ? 'Withdrawn · recorded ✓' : stepLabel[status]
  const chip = m ? riskChip(m.riskScore) : null
  const pairedSym = m?.baseSymbol ?? base

  const liveChip = meta?.live
    ? { text: 'Live', style: { color: '#34D399', background: 'rgba(52,211,153,0.12)' } }
    : isDevRig
      ? { text: 'Single-instance dev rig', style: { color: '#F0B45E', background: 'rgba(240,180,94,0.12)' } }
      : metaState === 'not_live'
        ? { text: 'Not live', style: { color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' } }
        : { text: 'Curating', style: { color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' } }

  return (
    <div>
      <Link href="/v1" className="text-[13px] no-underline" style={{ color: '#9B9BAD' }}>← Discover</Link>

      {/* header */}
      <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <TokenPair baseLogo={m?.baseLogo ?? null} quoteLogo={m?.quoteLogo ?? null} baseSymbol={m?.baseSymbol ?? base} quoteSymbol={m?.quoteSymbol ?? quote} size={36} ring="#0B0B14" />
            <h1 className="font-atx-display font-semibold tracking-[-0.03em] text-[28px]">{pairLabel}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Tag>Uniswap V4</Tag><Tag>Curated</Tag><Tag>Robinhood Testnet</Tag>
            <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={liveChip.style}>{liveChip.text}</span>
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

      {isDevRig && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(240,180,94,0.1)', border: '1px solid rgba(240,180,94,0.25)', color: '#F0B45E' }}>
          <span style={{ fontWeight: 600 }}>Single-instance dev rig.</span>{' '}
          <span style={{ color: '#9B9BAD' }}>No curated instances are registered yet, so this page is served from the operator’s environment-configured gateway ({shortId(meta!.positionManager)}). Testnet only — not a curated, live pool.</span>
        </div>
      )}
      {metaState === 'not_live' && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#9B9BAD' }}>
          This pool has no live gateway — nothing here accepts funds.{' '}
          <Link href="/v1" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Pick a live pool from Discover →</Link>
        </div>
      )}

      {alert && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px] flex items-start gap-2.5" style={{ background: 'rgba(240,180,94,0.1)', border: '1px solid rgba(240,180,94,0.25)', color: '#F0B45E' }}>
          <span>⚠</span>
          <span>
            <span style={{ fontWeight: 600 }}>Out of range ~{Math.max(1, Math.round((Date.now() - Date.parse(alert.sinceIso)) / 36e5))}h — LP fees paused.</span>{' '}
            <span style={{ color: '#9B9BAD' }}>Your position is still fully deployed (no yield accrues while out of range); fees resume automatically when price re-enters the range.</span>
          </span>
        </div>
      )}

      <div className="grid gap-5 mt-6 grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
        {/* LEFT: pool info */}
        <div className="rounded-[16px] p-6 min-[900px]:order-1 order-2" style={PANEL}>
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Total Value Locked</div>
          <div className="font-mono font-bold text-[30px] mt-1.5">{m ? usd(m.tvlUsd) : '—'}</div>
          <div className="text-[12.5px] mt-1" style={{ color: '#8A82F4' }}>Curated + spun up by Mintware</div>

          {/* allocation */}
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mt-6" style={{ color: '#63636F' }}>How your USDG is put to work</div>
          <div className="flex h-4 rounded-full overflow-hidden mt-3">
            <span style={{ width: '100%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
          </div>
          <div className="flex flex-col gap-2 mt-3 text-[13px]">
            <AllocRow color="#8A82F4" label={`Deployed as liquidity in ${base}/${quote}`} sub="your full deposit — no held-back reserve" pct="100%" />
          </div>
          <div className="relative h-9 mt-4 rounded-[10px] overflow-hidden" style={INNER}>
            <div className="absolute inset-y-0" style={{ left: '12%', right: '12%', background: 'linear-gradient(180deg,rgba(138,130,244,0.28),rgba(138,130,244,0.08))', borderLeft: '2px solid rgba(138,130,244,0.5)', borderRight: '2px solid rgba(138,130,244,0.5)' }} />
            <div className="absolute inset-y-0" style={{ left: '50%', width: '2px', background: '#F4F4FA' }} />
          </div>
          <div className="text-[11.5px] mt-1.5" style={{ color: '#63636F' }}>Fixed wide range (~10× up / −90% down) — always in range, no rebalancing. Carries impermanent loss — 100% of it is yours; Mintware supplies no capital to the position.</div>

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
            <Meta2 k="Pool ID" v={shortId(meta?.poolAddress ?? m?.poolAddress ?? decoded)} mono />
            {meta && <Meta2 k="Gateway (deposit target)" v={`${shortId(meta.positionManager)} · ${meta.source === 'registry' ? 'registry-verified' : 'env-configured'}`} mono />}
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
          {(meta || m) && (() => {
            const id = meta?.poolAddress ?? m!.poolAddress
            return (
              <div className="flex gap-3 mt-5 flex-wrap text-[12.5px]">
                {meta && <a href={`https://robinhoodchain.blockscout.com/address/${meta.positionManager}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Gateway on Explorer ↗</a>}
                <a href={`https://www.geckoterminal.com/robinhood/pools/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>GeckoTerminal ↗</a>
                <a href={`https://dexscreener.com/robinhood/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#8A82F4', fontWeight: 600 }}>DEXScreener ↗</a>
              </div>
            )
          })()}
        </div>

        {/* RIGHT: action panel */}
        <div className="flex flex-col gap-5 min-[900px]:order-2 order-1">
          {/* position summary */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <Sum k="Position value" v={usdg(pos?.positionValueAtomic)} />
            {hasPos && pos?.recorded === false && (
              <div className="mt-3 text-[12px] leading-[1.5]" style={{ color: '#F0B45E' }}>
                Position read from chain; its deposit was never recorded here, so cost basis and P&amp;L are unknown. Your funds are unaffected.
              </div>
            )}
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
                <button key={t} onClick={() => { if (busy) return; setTab(t); setErr(''); setReview(null); if (status !== 'record_failed') setStatus('idle') }} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer capitalize" style={tab === t ? { background: 'rgba(255,255,255,0.09)', color: '#F4F4FA' } : { color: '#9B9BAD' }}>{t}</button>
              ))}
              <Link href="/v1/swap" className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold no-underline" style={{ color: '#9B9BAD' }}>Swap ↗</Link>
            </div>

            {/* O-1: a failed record is surfaced with a retry — never hidden behind a ✓ */}
            {status === 'record_failed' && pending && (
              <div className="mb-3 rounded-[12px] p-3.5 text-[12.5px] leading-[1.5]" style={{ background: 'rgba(240,180,94,0.1)', border: '1px solid rgba(240,180,94,0.25)', color: '#F0B45E' }}>
                <div style={{ fontWeight: 600 }}>{pending.kind === 'deposit' ? 'Deposited on-chain' : 'Withdrawn on-chain'} — not yet recorded here.</div>
                <div style={{ color: '#9B9BAD' }} className="mt-1">Your funds are safe on-chain (tx {shortId(pending.txHash)}). Recording only updates your cost basis on this dashboard.</div>
                <button onClick={retryRecord} className="mt-2.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-[10px] cursor-pointer" style={{ background: 'rgba(240,180,94,0.18)', color: '#F4F4FA' }}>Retry recording</button>
              </div>
            )}

            {tab === 'deposit' ? (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}><span>Enter amount</span><span>USDG</span></div>
                  <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(sanitizeAmountInput(e.target.value)); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="bg-transparent outline-none font-mono font-bold text-[26px] w-full mt-2" style={{ color: '#F4F4FA' }} />
                </div>
                {Number(amount) > 0 && estAprPct != null && status !== 'review' && (
                  <div className="mt-3 rounded-[12px] p-3" style={INNER}>
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: '#9B9BAD' }}>Est. fees / yr at current pace</span>
                      <span className="font-mono font-bold" style={{ color: '#34D399' }}>~{usd(Number(amount) * (estAprPct / 100))}</span>
                    </div>
                    <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: '#63636F' }}>
                      On your full deposit once deployed, at the trailing-24h fee rate — an estimate, not a projection. Fees are gross of impermanent loss; 100% of any IL is yours.
                    </div>
                  </div>
                )}
                {status === 'review' && review?.kind === 'deposit' && (
                  <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                    <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A82F4' }}>Review</div>
                    <Row k="You send" v={usdg(review.amountAtomic)} />
                    <Row k="Est. shares (current NAV)" v={review.withMin ? fmtShares(review.estShares) : '— (no live pool state)'} />
                    {review.withMin ? (
                      <Row k={`Min. shares floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={fmtShares(review.minShares)} accent />
                    ) : (
                      <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#F0B45E' }}>This deployment has no slippage-bounded deposit — the transaction has no floor. Proceed only if you accept that.</div>
                    )}
                    <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#63636F' }}>
                      Shares are an estimate off the current block. {review.withMin ? 'If fewer than the floor would be minted, the transaction reverts and nothing moves.' : ''} Approve USDG, then deposit.
                    </div>
                  </div>
                )}
                <div className="flex gap-2 mt-3.5">
                  {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' }}>Back</button>}
                  <button
                    onClick={status === 'review' ? confirmDeposit : status === 'record_failed' ? retryRecord : reviewDeposit}
                    disabled={busy || (isConnected && !canDeposit && status !== 'record_failed')}
                    className="flex-1 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
                    style={busy || (isConnected && !canDeposit && status !== 'record_failed') ? { background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}
                  >
                    {isConnected && !canDeposit && status !== 'record_failed' ? (metaState === 'loading' ? 'Loading…' : 'Not live for deposits') : depBtn}
                  </button>
                </div>
                <div className="flex justify-between mt-4 text-[12.5px]" style={{ color: '#9B9BAD' }}><span>Locks anything?</span><span style={{ color: '#34D399', fontWeight: 600 }}>No — withdraw anytime</span></div>
              </>
            ) : (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Withdraw</div>
                  <div className="flex gap-2 mt-3">
                    {[25, 50, 100].map((p) => (
                      <button key={p} onClick={() => { setWpct(p); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={wpct === p ? { background: 'rgba(138,130,244,0.18)', color: '#F4F4FA', border: '1px solid rgba(138,130,244,0.4)' } : { background: 'transparent', color: '#9B9BAD', border: '1px solid rgba(255,255,255,0.1)' }}>{p === 100 ? 'Max' : `${p}%`}</button>
                    ))}
                  </div>
                  <div className="text-[12px] mt-3" style={{ color: '#9B9BAD' }}>Returns your pro-rata share of both legs at the current price (subject to impermanent loss).</div>
                </div>
                {status === 'review' && review?.kind === 'withdraw' && (
                  <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                    <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A82F4' }}>Review</div>
                    <Row k="Shares to burn" v={fmtShares(review.sharesToBurn)} />
                    {review.withMin ? (
                      <>
                        <Row k="Est. USDG out" v={usdg(review.estQuote)} />
                        <Row k={`Min. USDG floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={usdg(review.minQuote)} accent />
                        <Row k={`Est. ${pairedSym} out`} v={review.lpQuotable ? fmtUnits(review.estPaired, meta?.pairedDecimals ?? null, pairedSym) : 'unquotable (spot unreadable)'} />
                        <Row k={`Min. ${pairedSym} floor`} v={review.lpQuotable ? fmtUnits(review.minPaired, meta?.pairedDecimals ?? null, pairedSym) : 'none set'} accent />
                        <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#63636F' }}>
                          Estimates off the current block; the on-chain floors are the protection. If the pool can’t deliver at least the floors, the transaction reverts and nothing moves.
                          {!review.lpQuotable && ' The LP leg could not be priced, so its floor is 0 — only the idle leg is protected on this attempt.'}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#F0B45E' }}>This deployment has no slippage-bounded withdraw — the transaction has no floor. Proceed only if you accept that.</div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 mt-3.5">
                  {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' }}>Back</button>}
                  <button
                    onClick={status === 'review' ? confirmWithdraw : status === 'record_failed' ? retryRecord : reviewWithdraw}
                    disabled={busy || (!hasPos && status !== 'record_failed')}
                    className="flex-1 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
                    style={busy || (!hasPos && status !== 'record_failed') ? { background: 'rgba(255,255,255,0.06)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff' }}
                  >
                    {!hasPos && status !== 'record_failed' ? 'No position' : wBtn}
                  </button>
                </div>
              </>
            )}
            {err && <div className="text-[12.5px] mt-2.5 leading-[1.5]" style={{ color: '#F0736E' }}>{err}</div>}
          </div>

          {/* the loop */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>The loop</div>
            <div className="flex flex-col gap-3 mt-3">
              <Loop
                n="01"
                t="Briefly staged"
                d={
                  meta?.adapterKind === 'real'
                    ? 'A short window before the next scheduled deploy — already earning yield while it waits.'
                    : meta?.adapterKind === 'idle'
                      ? 'A short window before the next scheduled deploy — held ready, not yet earning.'
                      : 'A short window before the next scheduled deploy.'
                }
              />
              <Loop n="02" t="Deployed as liquidity" d="Your full deposit — no held-back reserve — is paired into this pool and earns trading fees." />
              <Loop n="03" t="Fees compound back in" d="Trading fees lift your position's value pro-rata. Withdraw anytime for both legs." />
            </div>
          </div>
        </div>
      </div>

      <p className="text-[12px] mt-6" style={{ color: '#63636F' }}>
        Robinhood testnet · metrics live from GeckoTerminal · every figure above is an estimate, not a projection ·{' '}
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
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 text-[12.5px] mt-2">
      <span style={{ color: '#9B9BAD' }}>{k}</span>
      <span className="font-mono font-semibold text-right" style={{ color: accent ? '#34D399' : '#F4F4FA' }}>{v}</span>
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
