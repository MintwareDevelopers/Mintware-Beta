'use client'

// /markets/[pool] — dark two-column pool terminal (Meteora DAMM-v2 detail as the standard), adapted to our
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
import { useSearchParams } from 'next/navigation'
import { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { chainLabel, marketChain } from '@/lib/chains/marketChains'
import type { LiveMarket } from '@/app/api/gateway/markets/route'
import { GlassFrame } from './GlassFrame'
import { TokenPair } from '@/components/web2/v1/TokenPair'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { buildGatewayDepositMessage, buildGatewayWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { applyToleranceBps } from '@/lib/marketEngine/math'
import { sanitizeAmountInput } from '@/lib/marketEngine/amountInput'

// C-6 slippage tolerance applied to every dry quote before it becomes an on-chain floor (bps).
export const SLIPPAGE_TOLERANCE_BPS = 100

type Meta = {
  positionManager: `0x${string}`; staging: `0x${string}` | null; poolAddress: string; pairLabel: string | null; chainId: number; rpcUrl: string
  engineAddress?: `0x${string}`; token0?: `0x${string}`; token1?: `0x${string}`; token0Decimals?: number; token1Decimals?: number
  usdg: `0x${string}` | null; quoteAsset?: `0x${string}`; pairedAsset: `0x${string}` | null; pairedDecimals: number | null
  feePips: number | null; dynamicFee: boolean; inRange?: boolean | null; currentTick?: number | null
  source: 'registry' | 'env-fallback'; live: boolean; supportsMin: boolean | null
  // D-4: which yield source backs the staging window — 'real' earns immediately while staged, 'idle'
  // is held ready but not yet earning, 'unknown' when the probe couldn't read it (never guess which).
  adapterKind?: 'idle' | 'real' | 'unknown'
}
type Metrics = { poolAddress: string; pairLabel: string; tvlUsd: number; vol24Usd: number; volTvlRatio: number | null; priceQuotePerBase: number | null; poolAgeDays: number | null; txCount24: number | null; riskScore: number; reasons: string[]; baseSymbol?: string; quoteSymbol?: string; baseLogo?: string | null; quoteLogo?: string | null; feePct?: number | null; live: boolean }
type Snapshot = { takenAt: string; positionValueAtomic: string; pnlAtomic: string }
type Position = { shares: string; positionValueAtomic: string | null; bufferBalanceAtomic: string | null; costBasisAtomic?: string | null; unrealizedPnlAtomic?: string | null; recorded?: boolean; costBasisComplete?: boolean; history?: Snapshot[] }
type PositionResponse = { position: Position; poolState: null; totalNav?: string | null; totalSupply?: string | null }
type Status = 'idle' | 'quote' | 'review' | 'switch' | 'approve' | 'deposit' | 'withdraw' | 'record' | 'recorded' | 'record_failed'
type Review =
  | { kind: 'deposit'; amountAtomic: bigint; estShares: bigint; minShares: bigint; withMin: boolean }
  | { kind: 'withdraw'; sharesToBurn: bigint; estQuote: bigint; estPaired: bigint; minQuote: bigint; minPaired: bigint; lpQuotable: boolean; withMin: boolean }
type PendingRecord = { kind: 'deposit' | 'withdraw'; txHash: `0x${string}` }

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`)
const usdg = (a: string | bigint | null | undefined) => (a == null ? '$0.00' : `$${(Number(BigInt(a)) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (a: string | null | undefined) => (a == null ? 0 : Number(BigInt(a)) / 1e6)
const norm = (label: string) => label.replace(/\s*\/\s*/g, '-').toLowerCase()
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id)
const fmtUnits = (a: bigint, decimals: number | null, symbol: string) =>
  decimals == null ? `${a.toString()} ${symbol} (raw units)` : `${Number(formatUnits(a, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${symbol}`
const fmtShares = (a: bigint) => Number(formatUnits(a, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })

const PANEL = { background: '#FFFFFF', boxShadow: 'var(--mw-raise)' }
const INNER = { background: '#F6F6FA', boxShadow: 'var(--mw-inset)' }

function riskChip(score: number) {
  if (score < 20) return { label: 'Low', color: '#0F7A43' }
  if (score < 50) return { label: 'Med', color: '#8A5300' }
  return { label: 'High', color: '#B42318' }
}

export function V1PoolDetail({ slug }: { slug: string }) {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const { connector } = useAccount()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [metaState, setMetaState] = useState<'loading' | 'ok' | 'not_live' | 'unavailable'>('loading')
  const [m, setM] = useState<Metrics | null>(null)
  // Our own live market (registry + chain NAV) — the source of TVL for testnet markets, which no
  // market-data site indexes.
  const [live, setLive] = useState<LiveMarket | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [wpct, setWpct] = useState(100)
  const [status, setStatus] = useState<Status>('idle')
  const [review, setReview] = useState<Review | null>(null)
  const [pending, setPending] = useState<PendingRecord | null>(null)
  const [err, setErr] = useState('')
  // 24h price closes for pools that have public market data (GeckoTerminal indexes mainnet only).
  const [spark, setSpark] = useState<number[] | undefined>(undefined)

  // The route param is the pool's registry key (poolId). Legacy label slugs still render metrics but
  // can never resolve a deposit target (meta 404s) — the page says so instead of guessing.
  const decoded = useMemo(() => decodeURIComponent(slug).toLowerCase(), [slug])
  // V1-01 pass-2 residual fix (independent Codex audit, 2026-09-09): an optional `?pm=` names the
  // EXACT PositionManager generation to resolve (set by the Portfolio's link for a superseded PM) —
  // without it, meta/position resolve to whichever PM is currently active for this pool, which is the
  // right default when arriving from Discover/browsing but wrong for exiting an old, retired instance.
  const searchParams = useSearchParams()
  const pmParam = searchParams.get('pm')
  const pmQuery = pmParam ? `&pm=${encodeURIComponent(pmParam)}` : ''
  // Discover passes the pair in the link (`?pair=`) so the header never falls back to a raw id.
  const pairParam = searchParams.get('pair')
  const pairLabel = m?.pairLabel ?? meta?.pairLabel ?? pairParam ?? (decoded.startsWith('0x') ? 'Unlisted pool' : decoded.replace(/-/g, ' / ').toUpperCase())
  const [base, quote] = useMemo(() => {
    const parts = pairLabel.split('/').map((s) => s.trim().replace(/\s*\d[\d.]*\s*%\s*$/, ''))
    return pairLabel.includes('/') ? [parts[0] || 'TOKEN', parts[1] || 'USDG'] : ['TOKEN', 'USDG']
  }, [pairLabel])

  useEffect(() => {
    fetch(`/api/gateway/meta?pool=${encodeURIComponent(slug)}${pmQuery}`).then(async (r) => {
      const d = await r.json().catch(() => null)
      if (r.ok && d?.success) { setMeta(d.meta); setMetaState('ok') }
      else { setMeta(null); setMetaState(r.status === 404 ? 'not_live' : 'unavailable') }
    }).catch(() => { setMeta(null); setMetaState('unavailable') })
    fetch('/api/gateway/markets').then((r) => r.json()).then((d) => {
      const list: LiveMarket[] = d?.success && Array.isArray(d.markets) ? d.markets : []
      setLive(list.find((x) => x.poolAddress.toLowerCase() === decoded) ?? null)
    }).catch(() => {})
    fetch('/api/gateway/discover').then((r) => r.json()).then((d) => {
      const list: Metrics[] = d?.success && Array.isArray(d.pools) ? d.pools : []
      setM(list.find((p) => p.poolAddress?.toLowerCase() === decoded) ?? list.find((p) => norm(p.pairLabel) === decoded) ?? null)
    }).catch(() => {})
  }, [slug, decoded, pmQuery])

  useEffect(() => {
    if (!m?.poolAddress) return
    const id = m.poolAddress.toLowerCase()
    fetch(`/api/gateway/sparklines?pools=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        const series = d?.success && d.series ? (Object.entries(d.series) as [string, number[]][]).find(([k]) => k.toLowerCase() === id)?.[1] : undefined
        setSpark(series)
      })
      .catch(() => {})
  }, [m?.poolAddress])

  // Chain-first position read (+ the live pool state the dry quotes need). Returns the payload so the
  // money path can price off a FRESH read rather than stale render state.
  const fetchPosition = useCallback(async (): Promise<PositionResponse | null> => {
    if (!address) { setPos(null); return null }
    try {
      const r = await fetch(`/api/gateway/position?address=${address}&pool=${encodeURIComponent(slug)}${pmQuery}`)
      const d = await r.json()
      if (!d?.success) { setPos(null); return null }
      setPos(d.position)
      return { position: d.position, poolState: d.poolState ?? null, totalNav: d.totalNav, totalSupply: d.totalSupply }
    } catch { setPos(null); return null }
  }, [address, slug, pmQuery])
  useEffect(() => {
    if (!address) return
    const timer = window.setTimeout(() => { void fetchPosition() }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchPosition, address])

  // Real trailing yield, Meteora-style: 24h fees ÷ TVL, annualized. 24h fees = 24h volume × fee tier.
  const feeRate = meta?.feePips != null ? meta.feePips / 1e6 : null
  const dayFeesUsd = feeRate != null && m ? m.vol24Usd * feeRate : null
  const estAprPct = feeRate != null && m && m.tvlUsd > 0 ? (m.vol24Usd * feeRate) / m.tvlUsd * 365 * 100 : null
  const feeTierLabel = meta?.feePips != null ? `${(meta.feePips / 1e4).toFixed(2)}%` : meta?.dynamicFee ? 'Dynamic' : m?.feePct != null ? `${m.feePct.toFixed(2)}%` : live?.feePct != null ? `${live.feePct.toFixed(2)}%` : 'Not published'
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

  // V1-05 fix (independent Codex audit, 2026-09-09): the signer transport must come from the SAME
  // wallet `useMintwareIdentity()` reports as connected, not always `window.ethereum`. An embedded
  // (email/social) wallet or a WalletConnect session never exposes `window.ethereum` at all, and with
  // multiple injected extensions installed, `window.ethereum` can silently be a DIFFERENT account than
  // the one shown as connected — every prior deposit/withdraw/record signature request in that case
  // either failed outright or prompted the wrong wallet.
  //
  // First attempt used Privy's `useWallets()` directly — caught during review as a real regression:
  // this app also runs with Privy fully disabled (`components/web2/providers.tsx`, no
  // NEXT_PUBLIC_PRIVY_APP_ID — plain WagmiProvider, no PrivyProvider ancestor at all), where
  // `useWallets()` has no context to read from and returns nothing usable even for a genuinely
  // connected wagmi wallet. Fixed to use wagmi's own active `connector.getProvider()` instead — this is
  // the common layer present in BOTH configurations (Privy's wagmi integration registers its wallets,
  // embedded included, as real wagmi connectors too), so it can never diverge from the displayed
  // identity and never depends on Privy being enabled. `getConnectorClient`/wagmi's typed `switchChain`
  // aren't used here because Robinhood Chain isn't one of wagmiConfig's configured chains (only
  // mainnet/base/arbitrum/baseSepolia are, for the swap/vault surfaces) — `ensureChain` below still
  // does its own raw `wallet_switchEthereumChain`/`wallet_addEthereumChain` dance directly on the
  // provider, which works regardless of wagmi's own configured-chain list.
  async function getSignerProvider(): Promise<import('viem').EIP1193Provider> {
    if (!connector) throw new Error('No connected wallet — reconnect and try again.')
    return (await connector.getProvider()) as import('viem').EIP1193Provider
  }
  function chainObj(mm: Meta) {
    const name = chainLabel(mm.chainId)
    return { id: mm.chainId, name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [mm.rpcUrl] } } } as const
  }
  async function ensureChain(eth: Awaited<ReturnType<typeof getSignerProvider>>, mm: Meta) {
    const hex = `0x${mm.chainId.toString(16)}`
    const chain = chainObj(mm)
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }) }
    catch (e) { if ((e as { code?: number })?.code === 4902) await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: chain.name, rpcUrls: [mm.rpcUrl], nativeCurrency: chain.nativeCurrency }] }); else throw e }
  }
  async function clients(mm: Meta) {
    const eth = await getSignerProvider()
    const chain = chainObj(mm)
    return {
      eth,
      wallet: createWalletClient({ account: address as `0x${string}`, chain, transport: custom(eth) }),
      pub: createPublicClient({ chain, transport: http(mm.rpcUrl) }),
    }
  }
  function fail(e: unknown, fallback: string) {
    setErr((e as (Error & { shortMessage?: string }))?.shortMessage ?? (e as Error)?.message ?? fallback)
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
      const { wallet } = await clients(mm)
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
      setErr(`Recording failed (${(e as (Error & { shortMessage?: string }))?.shortMessage ?? (e as Error)?.message ?? 'unknown'}). Your ${kind} is confirmed on-chain and your funds are safe — retry to record it.`)
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
      const { eth, wallet, pub } = await clients(meta)
      const target = meta.engineAddress ?? meta.positionManager
      setStatus('switch'); await ensureChain(eth, meta)
      const allowance = await pub.readContract({ address: meta.usdg!, abi: ERC20_ABI, functionName: 'allowance', args: [address as `0x${string}`, target] })
      if (BigInt(allowance) < atomic) {
        setStatus('approve')
        const approval = await wallet.writeContract({ address: meta.usdg!, abi: ERC20_ABI, functionName: 'approve', args: [target, atomic] })
        const receipt = await pub.waitForTransactionReceipt({ hash: approval })
        if (receipt.status !== 'success') throw new Error('Token approval failed. No deposit was made.')
      }
      const quoteIs0 = meta.quoteAsset?.toLowerCase() === meta.token0?.toLowerCase()
      const simulation = await pub.simulateContract({ address: target, abi: MARKET_ENGINE_ABI, functionName: 'deposit', account: address as `0x${string}`, args: [quoteIs0 ? atomic : 0n, quoteIs0 ? 0n : atomic, 1n] }) // engine rejects minSharesOut == 0
      const estShares = BigInt(simulation.result)
      if (estShares <= 0n) throw new Error('Amount is too small to mint any shares at the current NAV.')
      const minShares = applyToleranceBps(estShares, SLIPPAGE_TOLERANCE_BPS)
      setReview({ kind: 'deposit', amountAtomic: atomic, estShares, minShares, withMin: withMinAvailable })
      setStatus('review')
    } catch (e) {
      const message = (e as (Error & { shortMessage?: string }))?.shortMessage ?? (e as Error)?.message
      fail(new Error(message ? `Could not quote this deposit from the MarketEngine: ${message}` : 'The MarketEngine could not quote this amount. Check the amount and try again.'), 'Could not quote this amount from the MarketEngine.')
    }
  }
  async function confirmDeposit() {
    if (!meta || !review || review.kind !== 'deposit' || !meta.usdg) return
    setErr('')
    try {
      const { eth, wallet, pub } = await clients(meta)
      setStatus('switch'); await ensureChain(eth, meta)
      setStatus('deposit')
      const quoteIs0 = meta.quoteAsset?.toLowerCase() === meta.token0?.toLowerCase()
      const dh = await wallet.writeContract({ address: meta.engineAddress ?? meta.positionManager, abi: MARKET_ENGINE_ABI, functionName: 'deposit', args: [quoteIs0 ? review.amountAtomic : 0n, quoteIs0 ? 0n : review.amountAtomic, review.minShares] })
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
      const { pub } = await clients(meta)
      const simulation = await pub.simulateContract({ address: meta.engineAddress ?? meta.positionManager, abi: MARKET_ENGINE_ABI, functionName: 'withdraw', account: address as `0x${string}`, args: [toBurn, address as `0x${string}`, 0n, 0n] })
      const legs = simulation.result as readonly [bigint, bigint, bigint]
      const quoteIs0 = meta.quoteAsset?.toLowerCase() === meta.token0?.toLowerCase()
      const quoteAmount = quoteIs0 ? legs[1] : legs[2]
      const pairedAmount = quoteIs0 ? legs[2] : legs[1]
      setReview({
        kind: 'withdraw', sharesToBurn: toBurn,
        estQuote: quoteAmount, estPaired: pairedAmount,
        minQuote: applyToleranceBps(quoteAmount, SLIPPAGE_TOLERANCE_BPS),
        minPaired: applyToleranceBps(pairedAmount, SLIPPAGE_TOLERANCE_BPS),
        lpQuotable: true, withMin: true,
      })
      setStatus('review')
    } catch (e) { fail(e, 'Could not price the withdrawal') }
  }
  async function confirmWithdraw() {
    if (!meta || !review || review.kind !== 'withdraw') return
    setErr('')
    try {
      const { eth, wallet, pub } = await clients(meta)
      setStatus('switch'); await ensureChain(eth, meta)
      setStatus('withdraw')
      const quoteIs0 = meta.quoteAsset?.toLowerCase() === meta.token0?.toLowerCase()
      const wh = await wallet.writeContract({ address: meta.engineAddress ?? meta.positionManager, abi: MARKET_ENGINE_ABI, functionName: 'withdraw', args: [review.sharesToBurn, address as `0x${string}`, quoteIs0 ? review.minQuote : review.minPaired, quoteIs0 ? review.minPaired : review.minQuote] })
      const rc = await pub.waitForTransactionReceipt({ hash: wh })
      if (rc.status !== 'success') throw new Error('Withdraw reverted — nothing moved (a floor not met reverts the whole tx).')
      setReview(null)
      await record('withdraw', wh, meta)
    } catch (e) { fail(e, 'Withdraw failed') }
  }
  function cancelReview() { setReview(null); setStatus('idle'); setErr('') }

  // The quote token's symbol (USDG on Robinhood, USDC on Base) — never assume USDG.
  const quoteSym = live?.quoteSymbol ?? (quote && quote !== 'TOKEN' ? quote : 'USDG')
  const stepLabel: Record<Status, string> = {
    idle: '', quote: 'Pricing…', review: 'Confirm', switch: 'Confirm network…', approve: `Approve ${quoteSym}…`, deposit: 'Depositing…', withdraw: 'Withdrawing…',
    record: 'Confirmed on-chain · recording…', recorded: 'Recorded ✓', record_failed: 'Retry recording',
  }
  const depBtn = !isConnected ? 'Connect Wallet' : status === 'idle' ? 'Review deposit' : status === 'review' ? 'Confirm deposit' : status === 'recorded' ? 'Deposited · recorded ✓' : stepLabel[status]
  const wBtn = !isConnected ? 'Connect Wallet' : status === 'idle' ? 'Review withdraw' : status === 'review' ? 'Confirm withdraw' : status === 'recorded' ? 'Withdrawn · recorded ✓' : stepLabel[status]
  const chip = m ? riskChip(m.riskScore) : null
  const pairedSym = m?.baseSymbol ?? base

  // A registry market on a chain this deployment doesn't route deposits through still IS live — label it so.
  const chainId = meta?.chainId ?? live?.chainId ?? null
  const otherChainLive = metaState === 'not_live' && live != null
  const liveChip = meta?.live || otherChainLive
    ? { text: 'Live', style: { color: '#0F7A43', background: 'rgba(22,163,74,0.12)' } }
    : isDevRig
      ? { text: 'Single-instance dev rig', style: { color: '#8A5300', background: 'rgba(194,122,0,0.12)' } }
      : metaState === 'not_live'
        ? { text: 'Not live', style: { color: '#454552', background: 'rgba(22,22,44,0.06)' } }
        : { text: 'Curating', style: { color: '#454552', background: 'rgba(22,22,44,0.06)' } }

  const priceNow = m?.priceQuotePerBase ?? null
  const value = pos?.positionValueAtomic ?? null
  const basis = pos?.costBasisAtomic ?? null
  const change = pos?.unrealizedPnlAtomic ?? null

  return (
    <div>
      <Link href="/app/markets" className="text-[13px] no-underline" style={{ color: '#454552' }}>← Markets</Link>

      {isDevRig && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(194,122,0,0.1)', border: '1px solid rgba(194,122,0,0.25)', color: '#8A5300' }}>
          <span style={{ fontWeight: 600 }}>Single-instance dev rig.</span>{' '}
          <span style={{ color: '#454552' }}>No curated instances are registered yet. This view uses a configured MarketEngine ({shortId(meta!.positionManager)}); it is not currently registered for deposits.</span>
        </div>
      )}
      {metaState === 'not_live' && !otherChainLive && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(22,22,44,0.04)', border: '1px solid rgba(22,22,44,0.08)', color: '#454552' }}>
          This pool is still in curation — no market is open on it yet.{' '}
          <Link href="/app/markets" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Pick a live pool from Markets →</Link>
        </div>
      )}


      {/* THE MARKET — one card, like the homepage's "Inside a market": price, the action, your position. */}
      <section className="mw-raise-lg relative mt-4 rounded-[28px] p-[clamp(16px,2.4vw,24px)] flex flex-col gap-5">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <TokenPair baseLogo={m?.baseLogo ?? null} quoteLogo={m?.quoteLogo ?? null} baseSymbol={m?.baseSymbol ?? base} quoteSymbol={m?.quoteSymbol ?? quote} size={40} ring="#FFFFFF" />
            <div className="min-w-0">
              <h1 className="font-geist font-semibold tracking-[-0.03em] text-[24px] leading-tight">{base} <span style={{ color: 'var(--mw-ink-3)', fontWeight: 500 }}>/ {quote}</span></h1>
              <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--mw-ink-3)' }}>{chainId != null ? chainLabel(chainId) : 'Robinhood mainnet'} · Uniswap v4 · curated</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-[5px] rounded-full" style={liveChip.style}>{liveChip.text === 'Live' && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{liveChip.text}</span>
            {meta?.inRange != null && (
              <span className="text-[12px] font-semibold px-2.5 py-[5px] rounded-full" style={meta.inRange ? { color: '#0F7A43', background: 'rgba(22,163,74,0.12)' } : { color: '#8A5300', background: 'rgba(194,122,0,0.12)' }}>
                {meta.inRange ? 'In range · earning fees' : 'Out of range · fees paused'}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-5 items-start">
          {/* price (or market value when the pool has no public price) + chart */}
          <div className="flex-[1.3_1_300px] min-w-0">
            {priceNow != null ? (
              <>
                <div className="font-geist-mono text-[clamp(26px,3.4vw,34px)] tracking-[-0.03em] leading-none">{priceNow < 0.01 ? priceNow.toPrecision(3) : priceNow.toLocaleString('en-US', { maximumFractionDigits: 6 })} <span className="text-[14px] tracking-normal" style={{ color: 'var(--mw-ink-3)' }}>{quote} per {base}</span></div>
                <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mw-ink-3)' }}>Pool price</div>
              </>
            ) : (
              <>
                <div className="font-geist-mono text-[clamp(26px,3.4vw,34px)] tracking-[-0.03em] leading-none">{live?.navQuote != null ? live.navQuote.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'} <span className="text-[14px] tracking-normal" style={{ color: 'var(--mw-ink-3)' }}>{live?.quoteSymbol ?? quoteSym}</span></div>
                <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mw-ink-3)' }}>Market value</div>
              </>
            )}
            <PriceChart series={spark} />
            <div className="grid grid-cols-3 gap-2 mt-3 text-[12.5px]">
              <div><div style={{ color: 'var(--mw-ink-3)' }}>Fee tier</div><div className="font-geist-mono mt-0.5">{feeTierLabel}</div></div>
              <div><div style={{ color: 'var(--mw-ink-3)' }}>{m ? 'TVL' : 'Network'}</div><div className="font-geist-mono mt-0.5 leading-snug break-words">{m ? usd(m.tvlUsd) : chainId != null ? chainLabel(chainId) : '—'}</div></div>
              <div><div style={{ color: 'var(--mw-ink-3)' }}>Est. fee APR</div><div className="font-geist-mono mt-0.5">{aprLabel ?? '—'}</div></div>
            </div>
          </div>

          {/* the action */}
          <div className="flex-[1_1_300px] min-w-0 rounded-[20px] p-4 max-[520px]:!p-0 max-[520px]:!bg-transparent max-[520px]:!shadow-none" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            {metaState === 'not_live' && !hasPos ? (
              <>
                <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#62626F' }}>Status</div>
                <div className="font-geist font-semibold text-[20px] mt-1.5">{otherChainLive ? `Live on ${chainLabel(chainId)}` : 'In curation'}</div>
                <p className="text-[13px] leading-[1.6] mt-2" style={{ color: '#454552' }}>
                  {otherChainLive
                    ? 'This market is live and verified on-chain. Deposits from this app open for its network shortly.'
                    : 'Mintware screens a pool on depth, age and real trading before a market opens on it. This one is on the watchlist; deposits open once its market is live.'}
                </p>
                <Link href="/app/markets" className="inline-flex mt-4 text-[13px] font-semibold no-underline hover:underline" style={{ color: '#4643D1' }}>Browse live markets →</Link>
              </>
            ) : (
              <>
                <div className="mw-inset flex gap-1 p-1 mb-4 rounded-[14px]">
                  {(['deposit', 'withdraw'] as const).map((t) => (
                    <button key={t} onClick={() => { if (busy) return; setTab(t); setErr(''); setReview(null); if (status !== 'record_failed') setStatus('idle') }} className="flex-1 min-h-[40px] rounded-[10px] text-[14px] cursor-pointer capitalize" style={tab === t ? { background: '#FFFFFF', color: '#15151D', fontWeight: 600, boxShadow: 'var(--mw-raise-sm)' } : { color: '#454552', fontWeight: 500 }}>{t}</button>
                  ))}
                </div>

                {/* O-1: a failed record is surfaced with a retry — never hidden behind a ✓ */}
                {status === 'record_failed' && pending && (
                  <div className="mb-3 rounded-[12px] p-3.5 text-[12.5px] leading-[1.5]" style={{ background: 'rgba(194,122,0,0.1)', border: '1px solid rgba(194,122,0,0.25)', color: '#8A5300' }}>
                    <div style={{ fontWeight: 600 }}>{pending.kind === 'deposit' ? 'Deposited on-chain' : 'Withdrawn on-chain'} — not yet recorded here.</div>
                    <div style={{ color: '#454552' }} className="mt-1">Your funds are safe on-chain (tx {shortId(pending.txHash)}). Recording only updates your cost basis on this dashboard.</div>
                    <button onClick={retryRecord} className="mt-2.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-[10px] cursor-pointer" style={{ background: 'rgba(194,122,0,0.18)', color: '#15151D' }}>Retry recording</button>
                  </div>
                )}

                {tab === 'deposit' ? (
                  <>
                    <div className="rounded-[14px] p-4" style={INNER}>
                      <div className="flex justify-between text-[13px]" style={{ color: '#62626F' }}><span>You provide</span><span className="font-semibold" style={{ color: '#15151D' }}>{quoteSym}</span></div>
                      <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(sanitizeAmountInput(e.target.value)); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="bg-transparent outline-none font-mono font-medium tracking-[-0.03em] text-[34px] w-full mt-2" style={{ color: '#15151D' }} />
                    </div>
                    {Number(amount) > 0 && estAprPct != null && status !== 'review' && (
                      <div className="mt-3 rounded-[12px] p-3" style={INNER}>
                        <div className="flex justify-between text-[12.5px]">
                          <span style={{ color: '#454552' }}>Est. fees / yr at current pace</span>
                          <span className="font-mono font-bold" style={{ color: '#0F7A43' }}>~{usd(Number(amount) * (estAprPct / 100))}</span>
                        </div>
                        <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: '#62626F' }}>
                          On your full deposit once deployed, at the trailing-24h fee rate — an estimate, not a projection. Fees are gross of impermanent loss; 100% of any IL is yours.
                        </div>
                      </div>
                    )}
                    {status === 'review' && review?.kind === 'deposit' && (
                      <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                        <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#4643D1' }}>Review</div>
                        <Row k="You send" v={usdg(review.amountAtomic)} />
                        <Row k="Est. shares (current NAV)" v={review.withMin ? fmtShares(review.estShares) : '— (no live pool state)'} />
                        {review.withMin ? (
                          <Row k={`Min. shares floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={fmtShares(review.minShares)} accent />
                        ) : (
                          <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#8A5300' }}>This deployment has no slippage-bounded deposit — the transaction has no floor. Proceed only if you accept that.</div>
                        )}
                        <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#62626F' }}>
                          Shares are an estimate off the current block. {review.withMin ? 'If fewer than the floor would be minted, the transaction reverts and nothing moves.' : ''} Approve {quoteSym}, then deposit.
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3.5">
                      {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(22,22,44,0.06)', color: '#454552' }}>Back</button>}
                      <button
                        onClick={status === 'review' ? confirmDeposit : status === 'record_failed' ? retryRecord : reviewDeposit}
                        disabled={busy || (isConnected && !canDeposit && status !== 'record_failed')}
                        className="flex-1 text-[15px] font-semibold min-h-[52px] rounded-[14px] cursor-pointer disabled:cursor-default"
                        style={busy || (isConnected && !canDeposit && status !== 'record_failed') ? { background: 'rgba(22,22,44,0.06)', color: '#454552' } : { background: '#5B5BE6', color: '#fff', boxShadow: '0 6px 18px -6px rgba(70,67,209,0.6), 0 0 0 1px rgba(60,57,200,0.9), inset 0 1px 0 rgba(255,255,255,0.22)' }}
                      >
                        {isConnected && !canDeposit && status !== 'record_failed' ? (metaState === 'loading' ? 'Loading…' : 'Not live for deposits') : depBtn}
                      </button>
                    </div>
                    <div className="flex justify-between mt-4 text-[12.5px]" style={{ color: '#454552' }}><span>Lockup?</span><span style={{ color: '#0F7A43', fontWeight: 600 }}>None — withdraw your share in both tokens</span></div>
                  </>
                ) : (
                  <>
                    <div className="rounded-[14px] p-4" style={INNER}>
                      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#62626F' }}>Withdraw</div>
                      <div className="flex gap-2 mt-3">
                        {[25, 50, 100].map((p) => (
                          <button key={p} onClick={() => { setWpct(p); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={wpct === p ? { background: '#FFFFFF', color: '#15151D', boxShadow: 'var(--mw-raise-sm)' } : { background: 'transparent', color: '#454552' }}>{p === 100 ? 'Max' : `${p}%`}</button>
                        ))}
                      </div>
                      <div className="text-[12px] mt-3" style={{ color: '#454552' }}>Returns your pro-rata share of both legs at the current price (subject to impermanent loss).</div>
                    </div>
                    {status === 'review' && review?.kind === 'withdraw' && (
                      <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                        <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#4643D1' }}>Review</div>
                        <Row k="Shares to burn" v={fmtShares(review.sharesToBurn)} />
                        {review.withMin ? (
                          <>
                            <Row k={`Est. ${quoteSym} out`} v={usdg(review.estQuote)} />
                            <Row k={`Min. ${quoteSym} floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={usdg(review.minQuote)} accent />
                            <Row k={`Est. ${pairedSym} out`} v={review.lpQuotable ? fmtUnits(review.estPaired, meta?.pairedDecimals ?? null, pairedSym) : 'unquotable (spot unreadable)'} />
                            <Row k={`Min. ${pairedSym} floor`} v={review.lpQuotable ? fmtUnits(review.minPaired, meta?.pairedDecimals ?? null, pairedSym) : 'none set'} accent />
                            <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#62626F' }}>
                              Estimates off the current block; the on-chain floors are the protection. If the pool can’t deliver at least the floors, the transaction reverts and nothing moves.
                              {!review.lpQuotable && ' The LP leg could not be priced, so its floor is 0 — only the idle leg is protected on this attempt.'}
                            </div>
                          </>
                        ) : (
                          <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#8A5300' }}>This deployment has no slippage-bounded withdraw — the transaction has no floor. Proceed only if you accept that.</div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3.5">
                      {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(22,22,44,0.06)', color: '#454552' }}>Back</button>}
                      <button
                        onClick={status === 'review' ? confirmWithdraw : status === 'record_failed' ? retryRecord : reviewWithdraw}
                        disabled={busy || (!hasPos && status !== 'record_failed')}
                        className="flex-1 text-[15px] font-semibold min-h-[52px] rounded-[14px] cursor-pointer disabled:cursor-default"
                        style={busy || (!hasPos && status !== 'record_failed') ? { background: 'rgba(22,22,44,0.06)', color: '#454552' } : { background: '#5B5BE6', color: '#fff' }}
                      >
                        {!hasPos && status !== 'record_failed' ? 'No position' : wBtn}
                      </button>
                    </div>
                  </>
                )}
                {err && <div className="text-[12.5px] mt-2.5 leading-[1.5]" style={{ color: '#B42318' }}>{err}</div>}
              </>
            )}
          </div>
        </div>

        {/* your position */}
        <div className="grid grid-cols-2 min-[640px]:grid-cols-4 gap-3 px-4 py-3.5 rounded-2xl text-[13px]" style={{ background: 'var(--mw-band)' }}>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Value</div><div className="font-geist-mono mt-0.5">{!isConnected ? '—' : value == null ? 'Unavailable' : usdg(value)}</div></div>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Put in</div><div className="font-geist-mono mt-0.5">{!isConnected || !hasPos ? '—' : basis == null ? 'Unavailable' : usdg(basis)}</div></div>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Change</div><div className="font-geist-mono mt-0.5" style={change != null && hasPos ? { color: num(change) >= 0 ? '#0F7A43' : '#B42318' } : undefined}>{!isConnected || !hasPos || change == null ? '—' : `${num(change) >= 0 ? '+' : '−'}${usdg(String(BigInt(change) < 0n ? -BigInt(change) : BigInt(change)))}`}</div></div>
          <div><div style={{ color: 'var(--mw-ink-3)' }}>Shares</div><div className="font-geist-mono mt-0.5 truncate">{!isConnected || !pos ? '—' : fmtShares(BigInt(pos.shares))}</div></div>
        </div>
        <div className="text-[12px] leading-[1.5] -mt-2" style={{ color: 'var(--mw-ink-3)' }}>
          {!isConnected
            ? 'Connect a wallet to see your position.'
            : hasPos && basis == null
              ? 'Put in is unavailable: part of this position’s history wasn’t recorded here (for example a deposit made outside the app). Your funds are unaffected.'
              : 'Change is value minus what you put in. It includes trading fees and price moves, so it can be negative.'}
        </div>
      </section>

      {/* MARKET DETAILS */}
      <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mt-10 mb-3" style={{ color: '#62626F' }}>Market details</div>
      <div className="grid gap-5 grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)] items-start">
        <GlassFrame innerClassName="p-6">
          {/* allocation */}
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mt-6" style={{ color: '#62626F' }}>How your {quoteSym} is put to work</div>
          {/* layered: the capital sits in the engine today; the collateral and credit layers are drawn by status, not share */}
          <div className="mt-3 rounded-[14px] p-1.5 flex flex-col gap-1" style={INNER}>
            <div className="h-5 rounded-[9px] flex items-center px-2.5 text-[11px] font-semibold text-white" style={{ background: '#6B69E6', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)' }}>Liquidity · 100%</div>
            <div className="h-3 rounded-[7px] mw-tex-dots" style={{ backgroundColor: '#E1DBFA' }} title="Collateral layer · in development" />
            <div className="h-2 rounded-[6px] mw-tex-hatch" style={{ backgroundColor: '#ECECF2' }} title="Credit layer · planned" />
          </div>
          <div className="flex flex-col gap-2 mt-3 text-[13px]">
            <AllocRow color="#6B69E6" label={`MarketEngine portfolio · ${base}/${quote}`} sub="resting v4 liquidity plus token adapters" pct="100%" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px]" style={{ color: '#62626F' }}>
            <span><span className="inline-block w-3 h-3 rounded-[3px] align-[-2px] mr-1.5 mw-tex-dots" style={{ backgroundColor: '#E1DBFA' }} />Collateral layer · in development</span>
            <span><span className="inline-block w-3 h-3 rounded-[3px] align-[-2px] mr-1.5 mw-tex-hatch" style={{ backgroundColor: '#ECECF2' }} />Credit layer · planned</span>
          </div>
          <div className="relative h-9 mt-4 rounded-[10px] overflow-hidden" style={INNER}>
            <div className="absolute inset-y-0" style={{ left: '12%', right: '12%', background: 'linear-gradient(180deg,rgba(138,130,244,0.28),rgba(138,130,244,0.08))', borderLeft: '2px solid rgba(138,130,244,0.5)', borderRight: '2px solid rgba(138,130,244,0.5)' }} />
            <div className="absolute inset-y-0" style={{ left: '50%', width: '2px', background: '#15151D' }} />
          </div>
          <div className="text-[11.5px] mt-1.5" style={{ color: '#62626F' }}>The engine holds a resting v4 band and can recenter it under guarded lifecycle rules. Liquidity positions carry impermanent loss.</div>

          {/* metadata rows */}
          <div className="mt-6 flex flex-col">
            <Meta2 k="Fee tier" v={feeTierLabel + feeBand} />
            {/* Market-data rows come from the mainnet feed; a testnet market has none, so they are omitted, not dashed. */}
            {m && <>
              <Meta2 k="Current Pool Price" v={m?.priceQuotePerBase != null ? `1 ${base} ≈ ${m.priceQuotePerBase < 0.01 ? m.priceQuotePerBase.toPrecision(3) : m.priceQuotePerBase.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${quote}` : '—'} />
              <Meta2 k="24h Volume" v={m ? usd(m.vol24Usd) : '—'} />
              <Meta2 k="24h Fees (est)" v={dayFeesUsd != null ? usd(dayFeesUsd) : '—'} />
              <Meta2 k="Est. Fee APR · 24h, gross of IL" v={aprLabel ?? '—'} />
              <Meta2 k="Activity (Vol / TVL)" v={m?.volTvlRatio != null ? `${m.volTvlRatio.toFixed(2)}×` : '—'} />
              <Meta2 k="24h Trades" v={m?.txCount24 != null ? m.txCount24.toLocaleString() : '—'} />
              <Meta2 k="Pool age" v={m?.poolAgeDays != null ? `${m.poolAgeDays}d` : '—'} />
            </>}
            <Meta2 k="Network" v={chainId != null ? `${chainLabel(chainId)} (${chainId})` : 'Robinhood mainnet (watchlist)'} />
            <Meta2 k="Pool ID" v={shortId(meta?.poolAddress ?? m?.poolAddress ?? decoded)} mono />
            {meta && <Meta2 k="MarketEngine" v={`${shortId(meta.engineAddress ?? meta.positionManager)} · ${meta.source === 'registry' ? 'registry-verified' : 'env-configured'}`} mono />}
          </div>

          {/* trust */}
          {chip && (
            <div className="mt-5 rounded-[12px] p-3.5" style={INNER}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#62626F' }}>Trust</span>
                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: chip.color, background: `${chip.color}1A` }}>{chip.label} · {m!.riskScore}</span>
              </div>
              {m!.reasons.length > 0 && <div className="text-[12px] mt-2 leading-[1.5]" style={{ color: '#454552' }}>{m!.reasons.join(' · ')}</div>}
              <div className="text-[11px] mt-2" style={{ color: '#62626F' }}>The score ranks the queue; it never certifies safety — a human curates every pool.</div>
            </div>
          )}

          {/* explorers */}
          {(meta || m) && (() => {
            const id = meta?.poolAddress ?? m!.poolAddress
            const explorerBase = marketChain(meta?.chainId)?.explorer ?? null
            return (
              <div className="flex gap-3 mt-5 flex-wrap text-[12.5px]">
                {meta && explorerBase && <a href={`${explorerBase}/address/${meta.positionManager}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#4643D1', fontWeight: 600 }}>MarketEngine on Explorer ↗</a>}
                {/* Market-data sites index Robinhood mainnet only; a testnet market has no page there. */}
                {!meta && <a href={`https://www.geckoterminal.com/robinhood/pools/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#4643D1', fontWeight: 600 }}>GeckoTerminal ↗</a>}
                {!meta && <a href={`https://dexscreener.com/robinhood/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#4643D1', fontWeight: 600 }}>DEXScreener ↗</a>}
              </div>
            )
          })()}
        </GlassFrame>
        <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#62626F' }}>The loop</div>
            <div className="flex flex-col gap-3 mt-3">
              <Loop n="01" t="Deposit into the engine" d="Deposit one or both pool tokens with a minimum-shares floor; shares are valued in the quote asset." />
              <Loop n="02" t="Liquidity plus adapters" d="The portfolio is held across a resting v4 band and per-token adapters. On testnet the adapters hold assets ready without earning yield." />
              <Loop n="03" t="Withdraw in kind" d="Withdraw pro-rata in both pool tokens, with minimum-output limits." />
            </div>
        </div>
      </div>

      <p className="text-[12px] mt-6" style={{ color: '#62626F' }}>
        {chainId != null ? chainLabel(chainId) : 'Robinhood Chain mainnet'} · unaudited · {m ? 'metrics from GeckoTerminal' : 'values read from chain'} · every figure above is an estimate, not a projection ·{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Meta2({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 text-[13px]" style={{ borderTop: '1px solid rgba(22,22,44,0.05)' }}>
      <span style={{ color: '#454552' }}>{k}</span>
      <span className={mono ? 'font-mono' : 'font-medium'} style={{ color: '#15151D' }}>{v}</span>
    </div>
  )
}
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 text-[12.5px] mt-2">
      <span style={{ color: '#454552' }}>{k}</span>
      <span className="font-mono font-semibold text-right" style={{ color: accent ? '#0F7A43' : '#15151D' }}>{v}</span>
    </div>
  )
}
function AllocRow({ color, label, sub, pct }: { color: string; label: string; sub: string; pct: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} /><span><span className="font-medium">{label}</span> <span style={{ color: '#62626F' }}>· {sub}</span></span></span>
      <span className="font-mono" style={{ color: '#454552' }}>{pct}</span>
    </div>
  )
}
function Loop({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#4643D1' }}>{n}</span>
      <span><span className="font-semibold text-[13.5px]">{t}</span><div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#454552' }}>{d}</div></span>
    </div>
  )
}
/** The market card's price chart: the pool's 24h closes, drawn like the homepage illustration. Testnet pools have
 *  no public price feed, so they get a plain note instead of a made-up line. */
export function PriceChart({ series }: { series?: number[] }) {
  if (!series || series.length < 3) {
    return (
      <div className="mt-3 h-[96px] rounded-[14px] grid place-items-center px-4 text-center text-[12.5px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)', color: 'var(--mw-ink-3)' }}>
        No price history to chart. Public price feeds don’t track testnet pools.
      </div>
    )
  }
  const W = 300, H = 110
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1
  const pts = series.map((v, i) => [(i / (series.length - 1)) * W, H - 8 - ((v - min) / span) * (H - 16)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const up = series[series.length - 1] >= series[0]
  const pct = ((series[series.length - 1] - series[0]) / series[0]) * 100
  return (
    <div className="mt-3">
      <div className="text-[12.5px] font-geist-mono" style={{ color: up ? '#0F7A43' : '#B42318' }}>{up ? '+' : ''}{pct.toFixed(2)}% <span style={{ color: 'var(--mw-ink-3)' }}>24h</span></div>
      <svg aria-label={`24h price ${up ? 'up' : 'down'}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-[110px] mt-1">
        <defs>
          <linearGradient id="pd-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5B5BE6" /><stop offset="1" stopColor="#E8794F" /></linearGradient>
          <linearGradient id="pd-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A9A7FA" stopOpacity=".35" /><stop offset="1" stopColor="#A9A7FA" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#pd-area)" />
        <path d={line} fill="none" stroke="url(#pd-line)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
