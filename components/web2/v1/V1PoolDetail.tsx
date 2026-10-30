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
type PositionResponse = { position: Position; poolState: null; totalNav?: string; totalSupply?: string }
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

const PANEL = { background: '#FFFFFF', border: '1px solid rgba(22,22,44,0.08)', boxShadow: '0 1px 2px rgba(20,20,50,0.04), 0 8px 24px -12px rgba(30,30,80,0.10)' }
const INNER = { background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(22,22,44,0.06)' }

function riskChip(score: number) {
  if (score < 20) return { label: 'Low', color: '#16A34A' }
  if (score < 50) return { label: 'Med', color: '#B7791F' }
  return { label: 'High', color: '#DC4A44' }
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

  const stepLabel: Record<Status, string> = {
    idle: '', quote: 'Pricing…', review: 'Confirm', switch: 'Confirm network…', approve: 'Approve USDG…', deposit: 'Depositing…', withdraw: 'Withdrawing…',
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
    ? { text: 'Live', style: { color: '#16A34A', background: 'rgba(22,163,74,0.12)' } }
    : isDevRig
      ? { text: 'Single-instance dev rig', style: { color: '#B7791F', background: 'rgba(194,122,0,0.12)' } }
      : metaState === 'not_live'
        ? { text: 'Not live', style: { color: '#494957', background: 'rgba(22,22,44,0.06)' } }
        : { text: 'Curating', style: { color: '#494957', background: 'rgba(22,22,44,0.06)' } }

  return (
    <div>
      <Link href="/v1" className="text-[13px] no-underline" style={{ color: '#494957' }}>← Discover</Link>

      {/* header */}
      <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <TokenPair baseLogo={m?.baseLogo ?? null} quoteLogo={m?.quoteLogo ?? null} baseSymbol={m?.baseSymbol ?? base} quoteSymbol={m?.quoteSymbol ?? quote} size={36} ring="#FFFFFF" />
            <h1 className="font-atx-display font-semibold tracking-[-0.03em] text-[28px]">{pairLabel}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Tag>Uniswap V4</Tag><Tag>Curated</Tag><Tag>{chainId != null ? chainLabel(chainId) : 'Robinhood mainnet'}</Tag>
            <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={liveChip.style}>{liveChip.text}</span>
            {meta?.inRange != null && (
              <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={meta.inRange ? { color: '#16A34A', background: 'rgba(22,163,74,0.12)' } : { color: '#B7791F', background: 'rgba(194,122,0,0.12)' }}>
                {meta.inRange ? 'In range · earning fees' : 'Out of range · fees paused'}
              </span>
            )}
          </div>
        </div>
        {(aprLabel || m?.volTvlRatio != null) && (
          <div className="rounded-[12px] px-4 py-2.5 text-right" style={PANEL}>
            <div className="font-mono font-bold text-[22px]" style={{ color: '#5A57DE' }}>{aprLabel ?? `${m!.volTvlRatio!.toFixed(1)}×`}</div>
            <div className="text-[10.5px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>{aprLabel ? 'Est. Fee APR · 24h' : '24h Vol / TVL'}</div>
          </div>
        )}
      </div>

      {isDevRig && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(194,122,0,0.1)', border: '1px solid rgba(194,122,0,0.25)', color: '#B7791F' }}>
          <span style={{ fontWeight: 600 }}>Single-instance dev rig.</span>{' '}
          <span style={{ color: '#494957' }}>No curated instances are registered yet. This view uses a configured MarketEngine ({shortId(meta!.positionManager)}); it is not currently registered for deposits.</span>
        </div>
      )}
      {metaState === 'not_live' && !otherChainLive && (
        <div className="mt-5 rounded-[12px] px-4 py-3 text-[13px]" style={{ background: 'rgba(22,22,44,0.04)', border: '1px solid rgba(22,22,44,0.08)', color: '#494957' }}>
          This pool is still in curation — no market is open on it yet.{' '}
          <Link href="/v1" className="no-underline hover:underline" style={{ color: '#5A57DE', fontWeight: 600 }}>Pick a live pool from Discover →</Link>
        </div>
      )}

      <div className="grid gap-5 mt-6 grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
        {/* LEFT: pool info */}
        <GlassFrame className="min-[900px]:order-1 order-2" innerClassName="p-6">
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#8A8A9E' }}>{m ? 'Total Value Locked' : 'Market value'}</div>
          <div className="font-mono font-bold text-[30px] mt-1.5">{m ? usd(m.tvlUsd) : live?.navQuote != null ? `${live.navQuote.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${live.quoteSymbol ?? ''}` : '—'}</div>
          <div className="text-[12.5px] mt-1" style={{ color: '#5A57DE' }}>Curated + spun up by Mintware</div>

          {/* allocation */}
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mt-6" style={{ color: '#8A8A9E' }}>How your USDG is put to work</div>
          <div className="flex h-4 rounded-full overflow-hidden mt-3">
            <span style={{ width: '100%', background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
          </div>
          <div className="flex flex-col gap-2 mt-3 text-[13px]">
            <AllocRow color="#5A57DE" label={`MarketEngine portfolio · ${base}/${quote}`} sub="resting v4 liquidity plus token adapters" pct="100%" />
          </div>
          <div className="relative h-9 mt-4 rounded-[10px] overflow-hidden" style={INNER}>
            <div className="absolute inset-y-0" style={{ left: '12%', right: '12%', background: 'linear-gradient(180deg,rgba(138,130,244,0.28),rgba(138,130,244,0.08))', borderLeft: '2px solid rgba(138,130,244,0.5)', borderRight: '2px solid rgba(138,130,244,0.5)' }} />
            <div className="absolute inset-y-0" style={{ left: '50%', width: '2px', background: '#191923' }} />
          </div>
          <div className="text-[11.5px] mt-1.5" style={{ color: '#8A8A9E' }}>The engine holds a resting v4 band and can recenter it under guarded lifecycle rules. Liquidity positions carry impermanent loss.</div>

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
                <span className="text-[12px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>Trust</span>
                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: chip.color, background: `${chip.color}1A` }}>{chip.label} · {m!.riskScore}</span>
              </div>
              {m!.reasons.length > 0 && <div className="text-[12px] mt-2 leading-[1.5]" style={{ color: '#494957' }}>{m!.reasons.join(' · ')}</div>}
              <div className="text-[11px] mt-2" style={{ color: '#8A8A9E' }}>The score ranks the queue; it never certifies safety — a human curates every pool.</div>
            </div>
          )}

          {/* explorers */}
          {(meta || m) && (() => {
            const id = meta?.poolAddress ?? m!.poolAddress
            const explorerBase = marketChain(meta?.chainId)?.explorer ?? null
            return (
              <div className="flex gap-3 mt-5 flex-wrap text-[12.5px]">
                {meta && explorerBase && <a href={`${explorerBase}/address/${meta.positionManager}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#5A57DE', fontWeight: 600 }}>MarketEngine on Explorer ↗</a>}
                {/* Market-data sites index Robinhood mainnet only; a testnet market has no page there. */}
                {!meta && <a href={`https://www.geckoterminal.com/robinhood/pools/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#5A57DE', fontWeight: 600 }}>GeckoTerminal ↗</a>}
                {!meta && <a href={`https://dexscreener.com/robinhood/${id}`} target="_blank" rel="noreferrer" className="no-underline" style={{ color: '#5A57DE', fontWeight: 600 }}>DEXScreener ↗</a>}
              </div>
            )
          })()}
        </GlassFrame>

        {/* RIGHT: action panel */}
        {metaState === 'not_live' && !hasPos ? (
          <div className="rounded-[16px] p-6 min-[900px]:order-2 order-1 self-start" style={PANEL}>
            <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>Status</div>
            <div className="font-atx-display font-semibold text-[20px] mt-1.5">{otherChainLive ? `Live on ${chainLabel(chainId)}` : 'In curation'}</div>
            <p className="text-[13px] leading-[1.6] mt-2" style={{ color: '#494957' }}>
              {otherChainLive
                ? 'This market is live and verified on-chain. Deposits from this app open for its network shortly.'
                : 'Mintware screens a pool on depth, age and real trading before a market opens on it. This one is on the watchlist; deposits open once its market is live.'}
            </p>
            <Link href="/v1" className="inline-flex mt-4 text-[13px] font-semibold no-underline hover:underline" style={{ color: '#5A57DE' }}>Browse live markets →</Link>
          </div>
        ) : (
        <div className="flex flex-col gap-5 min-[900px]:order-2 order-1">
          {/* position summary */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <Sum k="Position value" v={usdg(pos?.positionValueAtomic)} />
            {hasPos && pos?.recorded === false && (
              <div className="mt-3 text-[12px] leading-[1.5]" style={{ color: '#B7791F' }}>
                Position read from chain; its deposit was never recorded here, so cost basis and P&amp;L are unknown. Your funds are unaffected.
              </div>
            )}
            {hasPos && pos?.recorded !== false && pos?.costBasisComplete === false && (
              <div className="mt-3 text-[12px] leading-[1.5]" style={{ color: '#B7791F' }}>
                Cost basis may be incomplete — some of your earlier history for this pool is still being recovered. The figures below reflect only what&apos;s currently attributed. Your funds are unaffected.
              </div>
            )}
            {hasPos && pos?.costBasisAtomic != null && (
              <div className="mt-4 pt-4 flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(22,22,44,0.06)' }}>
                <div className="flex justify-between items-baseline text-[13px]">
                  <span style={{ color: '#494957' }}>Net vs your deposit <span style={{ color: '#8A8A9E' }}>({usdg(pos.costBasisAtomic)} in)</span></span>
                  {(() => {
                    const up = num(pos.unrealizedPnlAtomic) >= 0
                    return <span className="font-mono font-bold" style={{ color: up ? '#16A34A' : '#DC4A44' }}>{up ? '+' : ''}{usdg(pos.unrealizedPnlAtomic)}</span>
                  })()}
                </div>
                {(() => {
                  const wk = (pos.history ?? []).find((h) => Date.now() - Date.parse(h.takenAt) >= 7 * 864e5)
                  if (!wk) return null
                  const d7 = num(pos.positionValueAtomic) - num(wk.positionValueAtomic)
                  const up = d7 >= 0
                  return (
                    <div className="flex justify-between items-baseline text-[12px]">
                      <span style={{ color: '#8A8A9E' }}>Change · 7d</span>
                      <span className="font-mono" style={{ color: up ? '#16A34A' : '#DC4A44' }}>{up ? '+' : ''}${Math.abs(d7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                <button key={t} onClick={() => { if (busy) return; setTab(t); setErr(''); setReview(null); if (status !== 'record_failed') setStatus('idle') }} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer capitalize" style={tab === t ? { background: 'rgba(22,22,44,0.09)', color: '#191923' } : { color: '#494957' }}>{t}</button>
              ))}
              <Link href="/v1/swap" className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold no-underline" style={{ color: '#494957' }}>Swap ↗</Link>
            </div>

            {/* O-1: a failed record is surfaced with a retry — never hidden behind a ✓ */}
            {status === 'record_failed' && pending && (
              <div className="mb-3 rounded-[12px] p-3.5 text-[12.5px] leading-[1.5]" style={{ background: 'rgba(194,122,0,0.1)', border: '1px solid rgba(194,122,0,0.25)', color: '#B7791F' }}>
                <div style={{ fontWeight: 600 }}>{pending.kind === 'deposit' ? 'Deposited on-chain' : 'Withdrawn on-chain'} — not yet recorded here.</div>
                <div style={{ color: '#494957' }} className="mt-1">Your funds are safe on-chain (tx {shortId(pending.txHash)}). Recording only updates your cost basis on this dashboard.</div>
                <button onClick={retryRecord} className="mt-2.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-[10px] cursor-pointer" style={{ background: 'rgba(194,122,0,0.18)', color: '#191923' }}>Retry recording</button>
              </div>
            )}

            {tab === 'deposit' ? (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}><span>Enter amount</span><span>USDG</span></div>
                  <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(sanitizeAmountInput(e.target.value)); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="bg-transparent outline-none font-mono font-bold text-[26px] w-full mt-2" style={{ color: '#191923' }} />
                </div>
                {Number(amount) > 0 && estAprPct != null && status !== 'review' && (
                  <div className="mt-3 rounded-[12px] p-3" style={INNER}>
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: '#494957' }}>Est. fees / yr at current pace</span>
                      <span className="font-mono font-bold" style={{ color: '#16A34A' }}>~{usd(Number(amount) * (estAprPct / 100))}</span>
                    </div>
                    <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: '#8A8A9E' }}>
                      On your full deposit once deployed, at the trailing-24h fee rate — an estimate, not a projection. Fees are gross of impermanent loss; 100% of any IL is yours.
                    </div>
                  </div>
                )}
                {status === 'review' && review?.kind === 'deposit' && (
                  <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                    <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#5A57DE' }}>Review</div>
                    <Row k="You send" v={usdg(review.amountAtomic)} />
                    <Row k="Est. shares (current NAV)" v={review.withMin ? fmtShares(review.estShares) : '— (no live pool state)'} />
                    {review.withMin ? (
                      <Row k={`Min. shares floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={fmtShares(review.minShares)} accent />
                    ) : (
                      <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#B7791F' }}>This deployment has no slippage-bounded deposit — the transaction has no floor. Proceed only if you accept that.</div>
                    )}
                    <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#8A8A9E' }}>
                      Shares are an estimate off the current block. {review.withMin ? 'If fewer than the floor would be minted, the transaction reverts and nothing moves.' : ''} Approve USDG, then deposit.
                    </div>
                  </div>
                )}
                <div className="flex gap-2 mt-3.5">
                  {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(22,22,44,0.06)', color: '#494957' }}>Back</button>}
                  <button
                    onClick={status === 'review' ? confirmDeposit : status === 'record_failed' ? retryRecord : reviewDeposit}
                    disabled={busy || (isConnected && !canDeposit && status !== 'record_failed')}
                    className="flex-1 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
                    style={busy || (isConnected && !canDeposit && status !== 'record_failed') ? { background: 'rgba(22,22,44,0.06)', color: '#494957' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}
                  >
                    {isConnected && !canDeposit && status !== 'record_failed' ? (metaState === 'loading' ? 'Loading…' : 'Not live for deposits') : depBtn}
                  </button>
                </div>
                <div className="flex justify-between mt-4 text-[12.5px]" style={{ color: '#494957' }}><span>Locks anything?</span><span style={{ color: '#16A34A', fontWeight: 600 }}>No — withdraw anytime</span></div>
              </>
            ) : (
              <>
                <div className="rounded-[14px] p-4" style={INNER}>
                  <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>Withdraw</div>
                  <div className="flex gap-2 mt-3">
                    {[25, 50, 100].map((p) => (
                      <button key={p} onClick={() => { setWpct(p); if (status === 'review' || status === 'recorded') { setStatus('idle'); setReview(null) } }} disabled={busy} className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={wpct === p ? { background: 'rgba(138,130,244,0.18)', color: '#191923', border: '1px solid rgba(138,130,244,0.4)' } : { background: 'transparent', color: '#494957', border: '1px solid rgba(22,22,44,0.1)' }}>{p === 100 ? 'Max' : `${p}%`}</button>
                    ))}
                  </div>
                  <div className="text-[12px] mt-3" style={{ color: '#494957' }}>Returns your pro-rata share of both legs at the current price (subject to impermanent loss).</div>
                </div>
                {status === 'review' && review?.kind === 'withdraw' && (
                  <div className="mt-3 rounded-[12px] p-3.5" style={{ ...INNER, border: '1px solid rgba(138,130,244,0.35)' }}>
                    <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#5A57DE' }}>Review</div>
                    <Row k="Shares to burn" v={fmtShares(review.sharesToBurn)} />
                    {review.withMin ? (
                      <>
                        <Row k="Est. USDG out" v={usdg(review.estQuote)} />
                        <Row k={`Min. USDG floor (−${SLIPPAGE_TOLERANCE_BPS / 100}%)`} v={usdg(review.minQuote)} accent />
                        <Row k={`Est. ${pairedSym} out`} v={review.lpQuotable ? fmtUnits(review.estPaired, meta?.pairedDecimals ?? null, pairedSym) : 'unquotable (spot unreadable)'} />
                        <Row k={`Min. ${pairedSym} floor`} v={review.lpQuotable ? fmtUnits(review.minPaired, meta?.pairedDecimals ?? null, pairedSym) : 'none set'} accent />
                        <div className="text-[11px] mt-2 leading-[1.5]" style={{ color: '#8A8A9E' }}>
                          Estimates off the current block; the on-chain floors are the protection. If the pool can’t deliver at least the floors, the transaction reverts and nothing moves.
                          {!review.lpQuotable && ' The LP leg could not be priced, so its floor is 0 — only the idle leg is protected on this attempt.'}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11.5px] mt-2 leading-[1.5]" style={{ color: '#B7791F' }}>This deployment has no slippage-bounded withdraw — the transaction has no floor. Proceed only if you accept that.</div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 mt-3.5">
                  {status === 'review' && <button onClick={cancelReview} className="text-[14px] font-semibold py-3.5 px-4 rounded-[14px] cursor-pointer" style={{ background: 'rgba(22,22,44,0.06)', color: '#494957' }}>Back</button>}
                  <button
                    onClick={status === 'review' ? confirmWithdraw : status === 'record_failed' ? retryRecord : reviewWithdraw}
                    disabled={busy || (!hasPos && status !== 'record_failed')}
                    className="flex-1 text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
                    style={busy || (!hasPos && status !== 'record_failed') ? { background: 'rgba(22,22,44,0.06)', color: '#494957' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff' }}
                  >
                    {!hasPos && status !== 'record_failed' ? 'No position' : wBtn}
                  </button>
                </div>
              </>
            )}
            {err && <div className="text-[12.5px] mt-2.5 leading-[1.5]" style={{ color: '#DC4A44' }}>{err}</div>}
          </div>

          {/* the loop */}
          <div className="rounded-[16px] p-5" style={PANEL}>
            <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#8A8A9E' }}>The loop</div>
            <div className="flex flex-col gap-3 mt-3">
              <Loop n="01" t="Deposit into the engine" d="Deposit one or both pool tokens with a minimum-shares floor; shares are valued in the quote asset." />
              <Loop n="02" t="Liquidity plus adapters" d="The portfolio is held across a resting v4 band and per-token adapters. Robinhood testnet adapters hold assets ready without earning yield." />
              <Loop n="03" t="Withdraw in kind" d="Withdraw pro-rata in both pool tokens, with minimum-output limits." />
            </div>
          </div>
        </div>
        )}
      </div>

      <p className="text-[12px] mt-6" style={{ color: '#8A8A9E' }}>
        Robinhood Chain testnet · unaudited · metrics from GeckoTerminal · every figure above is an estimate, not a projection ·{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#5A57DE', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#494957', background: 'rgba(22,22,44,0.05)' }}>{children}</span>
}
function Meta2({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 text-[13px]" style={{ borderTop: '1px solid rgba(22,22,44,0.05)' }}>
      <span style={{ color: '#494957' }}>{k}</span>
      <span className={mono ? 'font-mono' : 'font-medium'} style={{ color: '#191923' }}>{v}</span>
    </div>
  )
}
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 text-[12.5px] mt-2">
      <span style={{ color: '#494957' }}>{k}</span>
      <span className="font-mono font-semibold text-right" style={{ color: accent ? '#16A34A' : '#191923' }}>{v}</span>
    </div>
  )
}
function AllocRow({ color, label, sub, pct }: { color: string; label: string; sub: string; pct: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} /><span><span className="font-medium">{label}</span> <span style={{ color: '#8A8A9E' }}>· {sub}</span></span></span>
      <span className="font-mono" style={{ color: '#494957' }}>{pct}</span>
    </div>
  )
}
function Sum({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#8A8A9E' }}>{k}</div>
      <div className="font-mono font-bold text-[20px] mt-1" style={{ color: accent ? '#16A34A' : '#191923' }}>{v}</div>
    </div>
  )
}
function Loop({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#5A57DE' }}>{n}</span>
      <span><span className="font-semibold text-[13.5px]">{t}</span><div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#494957' }}>{d}</div></span>
    </div>
  )
}
