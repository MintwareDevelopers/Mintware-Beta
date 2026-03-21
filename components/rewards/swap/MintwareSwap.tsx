'use client'

// =============================================================================
// components/swap/MintwareSwap.tsx — Custom LI.FI SDK swap UI
//
// Architecture:
//   - Uses @lifi/sdk directly (no LiFiWidget)
//   - getTokens()  → populates from/to token lists
//   - getRoutes()  → quotes (debounced 600ms)
//   - executeRoute() → executes swap with wallet via EVM provider
//   - On completion: extracts txHash → POSTs to /api/campaigns/swap-event
//
// Chain support: Base (8453) + Core DAO (1116)
// Attribution: campaign_id omitted — API resolves active participations
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { getTokens, getRoutes, executeRoute } from '@lifi/sdk'
import type { Token, Route, RouteExtended, ExecutionOptions } from '@lifi/sdk'
import {
  lifiEvmProvider,
  createLifiConfig,
  CHAIN_NAMES,
  MINTWARE_CHAIN_IDS,
  LIFI_FEE,
  LIFI_INTEGRATOR,
  LIFI_TREASURY,
  CHAIN_EXPLORER,
  DEFAULT_FROM_TOKENS,
  DEFAULT_TO_TOKENS,
} from '@/lib/swap/lifi'
import { TokenSelector } from './TokenSelector'
import { RouteInfo }     from './RouteInfo'
import { SlippageControl } from './SlippageControl'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toWei(amount: string, decimals: number): string {
  if (!amount || parseFloat(amount) <= 0) return '0'
  const [whole, frac = ''] = amount.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  const raw = BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0')
  return raw.toString()
}

function fromWei(amount: string, decimals: number): string {
  try {
    const big     = BigInt(amount)
    const divisor = BigInt(10 ** decimals)
    const whole   = big / divisor
    const frac    = big % divisor
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    return fracStr ? `${whole}.${fracStr}` : whole.toString()
  } catch {
    return '0'
  }
}

function fmtAmount(amount: string, maxDecimals = 6): string {
  const n = parseFloat(amount)
  if (isNaN(n) || n === 0) return '0'
  if (n < 0.000001) return '< 0.000001'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  })
}

// Extract txHash from a completed route's step processes
function extractTxHash(route: RouteExtended): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps = route.steps as Array<any>
  for (let i = steps.length - 1; i >= 0; i--) {
    const procs: Array<{ txHash?: string }> = steps[i]?.execution?.process ?? []
    for (let j = procs.length - 1; j >= 0; j--) {
      if (procs[j].txHash) return procs[j].txHash!
    }
  }
  return null
}

// Token display button content
function TokenButton({
  token,
  onClick,
  placeholder = 'Select token',
}: {
  token: Token | null
  onClick: () => void
  placeholder?: string
}) {
  const [iconErr, setIconErr] = useState(false)
  return (
    <button className="mws-token-btn" onClick={onClick} type="button">
      {token ? (
        <>
          {token.logoURI && !iconErr ? (
            <img
              src={token.logoURI}
              alt={token.symbol}
              className="mws-token-icon"
              onError={() => setIconErr(true)}
            />
          ) : (
            <div className="mws-token-icon-fallback">{token.symbol[0]}</div>
          )}
          <span className="mws-token-symbol">{token.symbol}</span>
          <span className="mws-chevron">▾</span>
        </>
      ) : (
        <>
          <span className="mws-token-placeholder">{placeholder}</span>
          <span className="mws-chevron">▾</span>
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type SwapStatus = 'idle' | 'swapping' | 'success' | 'error'

export function MintwareSwap() {
  const { address, chainId: walletChainId } = useAccount()
  const { data: walletClient }              = useWalletClient()
  const { switchChainAsync }                = useSwitchChain()

  // Warn when the wallet is on a chain LI.FI doesn't route (e.g. Sepolia)
  const walletOnUnsupportedChain =
    !!walletChainId && !(MINTWARE_CHAIN_IDS as readonly number[]).includes(walletChainId)

  // Chain selection
  const [fromChainId, setFromChainId] = useState<number>(8453)  // Base default
  const [toChainId,   setToChainId]   = useState<number>(8453)

  // Tokens
  const [fromTokens,  setFromTokens]  = useState<Token[]>([])
  const [toTokens,    setToTokens]    = useState<Token[]>([])
  const [fromToken,   setFromToken]   = useState<Token | null>(null)
  const [toToken,     setToToken]     = useState<Token | null>(null)
  const [tokensLoading, setTokensLoading] = useState(false)

  // Amount
  const [fromAmount,  setFromAmount]  = useState('')

  // Slippage
  const [slippage,    setSlippage]    = useState(0.01)

  // Quote
  const [route,        setRoute]       = useState<Route | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError,   setQuoteError]  = useState<string | null>(null)
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteAbortRef = useRef<AbortController | null>(null)

  // Swap execution
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [txHash,     setTxHash]     = useState<string | null>(null)
  const [swapError,  setSwapError]  = useState<string | null>(null)

  // Token selector modals
  const [showFromSelector, setShowFromSelector] = useState(false)
  const [showToSelector,   setShowToSelector]   = useState(false)

  // ─── SDK init (once, client-side) ───────────────────────────────────────
  useEffect(() => {
    createLifiConfig()
  }, [])

  // ─── Bind wagmi wallet to LI.FI EVM provider ─────────────────────────────
  useEffect(() => {
    if (!walletClient) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = walletClient as any
    lifiEvmProvider.setOptions({
      getWalletClient: async () => client,
      switchChain: async (chainId: number) => {
        try {
          await switchChainAsync({ chainId })
          return client
        } catch {
          return undefined
        }
      },
    })
  }, [walletClient, switchChainAsync])

  // ─── Load tokens for both chains ─────────────────────────────────────────
  useEffect(() => {
    const chains = Array.from(new Set([fromChainId, toChainId]))
    let cancelled = false
    setTokensLoading(true)
    getTokens({ chains })
      .then((res) => {
        if (cancelled) return
        const ft = res.tokens[fromChainId] ?? []
        const tt = res.tokens[toChainId]   ?? []
        setFromTokens(ft)
        setToTokens(tt)

        // Auto-select default from token
        setFromToken((prev: Token | null) => {
          if (prev && ft.find((t) => t.address.toLowerCase() === prev.address.toLowerCase())) return prev
          const defAddr = DEFAULT_FROM_TOKENS[fromChainId]
          return ft.find((t) => t.address.toLowerCase() === defAddr?.toLowerCase()) ?? ft[0] ?? null
        })
        // Auto-select default to token
        setToToken((prev: Token | null) => {
          if (prev && tt.find((t) => t.address.toLowerCase() === prev.address.toLowerCase())) return prev
          const defAddr = DEFAULT_TO_TOKENS[toChainId]
          return tt.find((t) => t.address.toLowerCase() === defAddr?.toLowerCase()) ?? tt[1] ?? null
        })
      })
      .catch(() => { if (!cancelled) { setFromTokens([]); setToTokens([]) } })
      .finally(() => { if (!cancelled) setTokensLoading(false) })
    return () => { cancelled = true }
  }, [fromChainId, toChainId])

  // ─── Quote (debounced) ───────────────────────────────────────────────────
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current)

    const amt = parseFloat(fromAmount)
    if (!fromToken || !toToken || !address || !amt || amt <= 0) {
      setRoute(null)
      setQuoteError(null)
      setQuoteLoading(false)
      return
    }

    setQuoteLoading(true)
    setQuoteError(null)

    quoteTimerRef.current = setTimeout(async () => {
      quoteAbortRef.current?.abort()
      quoteAbortRef.current = new AbortController()

      try {
        const fromAmountWei = toWei(fromAmount, fromToken.decimals)
        // integrator + fee are set at the SDK config level (createConfig).
        // Passing them again in per-request options triggers LI.FI's integrator
        // validation — only verified/registered integrators pass that check.
        // fee/referrer are gated separately until the integrator is approved.
        const feeOptions = LIFI_FEE && LIFI_TREASURY && process.env.NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED === 'true'
          ? { fee: LIFI_FEE, referrer: LIFI_TREASURY }
          : {}
        const req = {
          fromChainId,
          toChainId,
          fromTokenAddress: fromToken.address,
          toTokenAddress:   toToken.address,
          fromAmount:       fromAmountWei,
          fromAddress:      address,
          options: {
            slippage,
            ...feeOptions,
          },
        }
        const res = await getRoutes(req)
        if (res.routes.length === 0) {
          setQuoteError('No route found for this token pair')
          setRoute(null)
        } else {
          setRoute(res.routes[0])
          setQuoteError(null)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Quote failed'
        setQuoteError(msg.length > 80 ? msg.slice(0, 80) + '…' : msg)
        setRoute(null)
      } finally {
        setQuoteLoading(false)
      }
    }, 600)

    return () => { if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current) }
  }, [fromAmount, fromToken, toToken, fromChainId, toChainId, address, slippage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Swap execution ──────────────────────────────────────────────────────
  const handleSwap = useCallback(async () => {
    if (!route || !address) return
    setSwapStatus('swapping')
    setSwapError(null)
    setTxHash(null)

    const execOptions: ExecutionOptions = {
      updateRouteHook: (updatedRoute: RouteExtended) => {
        // Extract txHash as soon as any step has one
        const hash = extractTxHash(updatedRoute)
        if (hash) setTxHash(hash)
      },
    }

    try {
      const completedRoute = await executeRoute(route, execOptions)
      const hash = extractTxHash(completedRoute)
      if (hash) setTxHash(hash)
      setSwapStatus('success')

      // Attribution POST — campaign_id omitted; API resolves active participations
      if (hash) {
        fetch('/api/campaigns/swap-event', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            tx_hash:    hash,
            wallet:     address,
            token_in:   completedRoute.fromToken.symbol,
            token_out:  completedRoute.toToken.symbol,
            amount_usd: parseFloat(completedRoute.toAmountUSD) || 0,
            chain:      String(completedRoute.toChainId),
            timestamp:  new Date().toISOString(),
          }),
        }).catch((err) => {
          console.warn('[MintwareSwap] attribution post failed:', err)
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Swap failed'
      setSwapError(msg.includes('rejected') || msg.includes('denied')
        ? 'Transaction rejected'
        : msg.length > 100 ? msg.slice(0, 100) + '…' : msg)
      setSwapStatus('error')
    }
  }, [route, address])

  // ─── Swap direction flip ─────────────────────────────────────────────────
  function flipTokens() {
    setFromChainId(toChainId)
    setToChainId(fromChainId)
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount('')
    setRoute(null)
    setQuoteError(null)
  }

  // ─── Derived display values ──────────────────────────────────────────────
  const toAmountDisplay = route
    ? fmtAmount(fromWei(route.toAmount, route.toToken.decimals))
    : ''

  const swapBtnLabel =
    swapStatus === 'swapping' ? 'Swapping…' :
    swapStatus === 'success'  ? 'Swap again' :
    quoteLoading              ? 'Getting quote…' :
    route                     ? `Swap ${fromToken?.symbol ?? ''} → ${toToken?.symbol ?? ''}` :
                                'Enter an amount'

  const swapBtnDisabled =
    swapStatus === 'swapping' ||
    (!route && swapStatus !== 'success') ||
    quoteLoading ||
    !address

  // ─── Reset after success ─────────────────────────────────────────────────
  function handleSwapAgain() {
    setSwapStatus('idle')
    setTxHash(null)
    setSwapError(null)
    setFromAmount('')
    setRoute(null)
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        /* ── Container ──────────────────────────────────── */
        .mws-wrap {
          background: #F7F6FF;
          border-radius: 20px;
          padding: 20px;
          max-width: 440px;
          margin: 0 auto;
          box-shadow: 0 4px 40px rgba(58,92,232,0.10);
          border: 1px solid #E0DFFF;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }

        /* ── Chain selectors ────────────────────────────── */
        .mws-chain-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
        }
        .mws-chain-label {
          font-size: 11px;
          font-weight: 600;
          color: #8A8C9E;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          min-width: 32px;
        }
        .mws-chain-pill {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          font-weight: 600;
          border: 1.5px solid #E0DFFF;
          border-radius: 20px;
          padding: 3px 10px;
          background: #fff;
          color: #3A3C52;
          cursor: pointer;
          transition: all 0.15s;
        }
        .mws-chain-pill:hover {
          border-color: #3A5CE8;
          color: #3A5CE8;
        }
        .mws-chain-pill.active {
          background: #3A5CE8;
          border-color: #3A5CE8;
          color: #fff;
        }

        /* ── Token cards ─────────────────────────────────── */
        .mws-card {
          background: #fff;
          border: 1.5px solid #E0DFFF;
          border-radius: 14px;
          padding: 14px 16px;
          transition: border-color 0.15s;
        }
        .mws-card:focus-within { border-color: #3A5CE8; }
        .mws-card-from {
          background: #1A1A2E;
          border-color: #2A2C48;
        }
        .mws-card-from:focus-within { border-color: #3A5CE8; }
        .mws-card-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .mws-card-label {
          font-size: 11px;
          font-weight: 600;
          color: #8A8C9E;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .mws-card-from .mws-card-label { color: rgba(255,255,255,0.4); }

        /* Amount input */
        .mws-amount-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-family: 'DM Mono', monospace;
          font-size: 26px;
          font-weight: 500;
          color: #1A1A2E;
          min-width: 0;
          width: 100%;
          padding: 0;
        }
        .mws-amount-input::placeholder { color: #C4C3F0; }
        .mws-card-from .mws-amount-input { color: #fff; }
        .mws-card-from .mws-amount-input::placeholder { color: rgba(255,255,255,0.25); }

        /* Output display */
        .mws-amount-out {
          flex: 1;
          font-family: 'DM Mono', monospace;
          font-size: 26px;
          font-weight: 500;
          color: #1A1A2E;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mws-amount-out.loading { color: #C4C3F0; animation: mws-pulse 1.2s ease-in-out infinite; }
        @keyframes mws-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        /* USD hint */
        .mws-usd-hint {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          color: #8A8C9E;
          margin-top: 4px;
        }
        .mws-card-from .mws-usd-hint { color: rgba(255,255,255,0.3); }

        /* ── Token button ──────────────────────────────────── */
        .mws-token-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(58,92,232,0.08);
          border: 1.5px solid rgba(58,92,232,0.18);
          border-radius: 20px;
          padding: 5px 10px 5px 6px;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .mws-token-btn:hover {
          background: rgba(58,92,232,0.14);
          border-color: rgba(58,92,232,0.35);
        }
        .mws-card-from .mws-token-btn {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.2);
        }
        .mws-card-from .mws-token-btn:hover {
          background: rgba(255,255,255,0.18);
        }
        .mws-token-icon {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .mws-token-icon-fallback {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #3A5CE8;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .mws-token-symbol {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          color: #1A1A2E;
        }
        .mws-card-from .mws-token-symbol { color: #fff; }
        .mws-token-placeholder {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #8A8C9E;
        }
        .mws-chevron {
          font-size: 10px;
          color: #8A8C9E;
        }
        .mws-card-from .mws-chevron { color: rgba(255,255,255,0.5); }

        /* ── Swap direction button ───────────────────────── */
        .mws-flip-wrap {
          display: flex;
          justify-content: center;
          align-items: center;
          margin: -8px 0;
          position: relative;
          z-index: 1;
        }
        .mws-flip-btn {
          background: #fff;
          border: 2px solid #E0DFFF;
          border-radius: 50%;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 16px;
          color: #3A5CE8;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(58,92,232,0.10);
        }
        .mws-flip-btn:hover {
          background: #3A5CE8;
          border-color: #3A5CE8;
          color: #fff;
          transform: rotate(180deg);
        }

        /* ── Slippage row ─────────────────────────────────── */
        .mws-section {
          margin-top: 12px;
        }

        /* ── Swap button ──────────────────────────────────── */
        .mws-swap-btn {
          width: 100%;
          margin-top: 14px;
          padding: 14px;
          border-radius: 12px;
          border: none;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          background: #3A5CE8;
          color: #fff;
          box-shadow: 0 2px 12px rgba(58,92,232,0.25);
        }
        .mws-swap-btn:hover:not(:disabled) {
          background: #2a4cd8;
          box-shadow: 0 4px 20px rgba(58,92,232,0.35);
          transform: translateY(-1px);
        }
        .mws-swap-btn:disabled {
          background: #C4C3F0;
          color: #fff;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }
        .mws-swap-btn.success {
          background: #2A9E8A;
          box-shadow: 0 2px 12px rgba(42,158,138,0.25);
        }
        .mws-swap-btn.error {
          background: #C2537A;
          box-shadow: 0 2px 12px rgba(194,83,122,0.25);
        }

        /* ── Error / info messages ───────────────────────── */
        .mws-error-msg {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          color: #C2537A;
          background: rgba(194,83,122,0.06);
          border: 1px solid rgba(194,83,122,0.15);
          border-radius: 8px;
          padding: 8px 10px;
          margin-top: 10px;
        }
        .mws-info-msg {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          color: #2A9E8A;
          background: rgba(42,158,138,0.06);
          border: 1px solid rgba(42,158,138,0.15);
          border-radius: 8px;
          padding: 8px 10px;
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mws-tx-link {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #3A5CE8;
          text-decoration: none;
          word-break: break-all;
        }
        .mws-tx-link:hover { text-decoration: underline; }

        /* ── Not connected ────────────────────────────────── */
        .mws-connect-notice {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          color: #8A8C9E;
          text-align: center;
          margin-top: 10px;
        }
      `}</style>

      <div className="mws-wrap">

        {/* ─── FROM chain selector ─── */}
        <div className="mws-chain-row">
          <span className="mws-chain-label">From</span>
          {MINTWARE_CHAIN_IDS.map((id) => (
            <button
              key={id}
              className={`mws-chain-pill${fromChainId === id ? ' active' : ''}`}
              onClick={() => {
                setFromChainId(id)
                setFromToken(null)
                setRoute(null)
                setFromAmount('')
              }}
              type="button"
            >
              {CHAIN_NAMES[id]}
            </button>
          ))}
        </div>

        {/* ─── FROM token card ─── */}
        <div className="mws-card mws-card-from">
          <div className="mws-card-label">You pay</div>
          <div className="mws-card-row">
            <input
              className="mws-amount-input"
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={fromAmount}
              onChange={(e) => {
                setFromAmount(e.target.value)
                setSwapStatus('idle')
                setSwapError(null)
              }}
            />
            <TokenButton
              token={fromToken}
              onClick={() => setShowFromSelector(true)}
              placeholder="Select"
            />
          </div>
          {route && (
            <div className="mws-usd-hint">
              ≈ ${parseFloat(route.fromAmountUSD || '0').toFixed(2)}
            </div>
          )}
        </div>

        {/* ─── Flip button ─── */}
        <div className="mws-flip-wrap">
          <button
            className="mws-flip-btn"
            onClick={flipTokens}
            type="button"
            aria-label="Flip tokens"
          >
            ⇅
          </button>
        </div>

        {/* ─── TO chain selector ─── */}
        <div className="mws-chain-row" style={{ marginTop: 4 }}>
          <span className="mws-chain-label">To</span>
          {MINTWARE_CHAIN_IDS.map((id) => (
            <button
              key={id}
              className={`mws-chain-pill${toChainId === id ? ' active' : ''}`}
              onClick={() => {
                setToChainId(id)
                setToToken(null)
                setRoute(null)
              }}
              type="button"
            >
              {CHAIN_NAMES[id]}
            </button>
          ))}
        </div>

        {/* ─── TO token card ─── */}
        <div className="mws-card">
          <div className="mws-card-label">You receive</div>
          <div className="mws-card-row">
            <div className={`mws-amount-out${quoteLoading ? ' loading' : ''}`}>
              {quoteLoading ? 'Fetching…' : toAmountDisplay || '0'}
            </div>
            <TokenButton
              token={toToken}
              onClick={() => setShowToSelector(true)}
              placeholder="Select"
            />
          </div>
          {route && (
            <div className="mws-usd-hint">
              ≈ ${parseFloat(route.toAmountUSD || '0').toFixed(2)}
            </div>
          )}
        </div>

        {/* ─── Route info ─── */}
        {route && !quoteLoading && (
          <div className="mws-section">
            <RouteInfo route={route} fee={LIFI_FEE} />
          </div>
        )}

        {/* ─── Quote error ─── */}
        {quoteError && !quoteLoading && (
          <div className="mws-error-msg">⚠ {quoteError}</div>
        )}

        {/* ─── Slippage ─── */}
        <div className="mws-section">
          <SlippageControl value={slippage} onChange={setSlippage} />
        </div>

        {/* ─── Swap button ─── */}
        {address ? (
          <button
            className={`mws-swap-btn${swapStatus === 'success' ? ' success' : swapStatus === 'error' ? ' error' : ''}`}
            disabled={swapBtnDisabled}
            onClick={swapStatus === 'success' ? handleSwapAgain : handleSwap}
            type="button"
          >
            {swapStatus === 'success' ? '✓ Swap again' : swapBtnLabel}
          </button>
        ) : (
          <div className="mws-connect-notice">Connect your wallet to swap</div>
        )}

        {/* ─── Unsupported chain warning ─── */}
        {walletOnUnsupportedChain && (
          <div className="mws-error-msg">
            ⚠ Your wallet is on an unsupported network. LI.FI routes on Base and Core DAO mainnet only — testnets (Sepolia etc.) are not supported.
          </div>
        )}

        {/* ─── Swap error ─── */}
        {swapStatus === 'error' && swapError && (
          <div className="mws-error-msg">✗ {swapError}</div>
        )}

        {/* ─── Success / tx hash ─── */}
        {swapStatus === 'success' && txHash && (
          <div className="mws-info-msg">
            <span>✓ Swap confirmed</span>
            <a
              className="mws-tx-link"
              href={`${CHAIN_EXPLORER[toChainId] ?? 'https://basescan.org/tx/'}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on explorer ↗
            </a>
          </div>
        )}

      </div>

      {/* ─── Token selector modals ─── */}
      {showFromSelector && (
        <TokenSelector
          tokens={fromTokens}
          selected={fromToken}
          chainName={CHAIN_NAMES[fromChainId]}
          onSelect={(t) => {
            setFromToken(t)
            setRoute(null)
            setFromAmount('')
          }}
          onClose={() => setShowFromSelector(false)}
        />
      )}

      {showToSelector && (
        <TokenSelector
          tokens={toTokens}
          selected={toToken}
          chainName={CHAIN_NAMES[toChainId]}
          onSelect={(t) => {
            setToToken(t)
            setRoute(null)
          }}
          onClose={() => setShowToSelector(false)}
        />
      )}
    </>
  )
}
