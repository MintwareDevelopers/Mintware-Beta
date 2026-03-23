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
    <button
      className="inline-flex items-center gap-[6px] bg-[rgba(58,92,232,0.08)] border-[1.5px] border-[rgba(58,92,232,0.18)] rounded-xl px-[10px] py-[5px] pl-[6px] cursor-pointer whitespace-nowrap shrink-0 transition-all duration-150 hover:bg-[rgba(58,92,232,0.14)] hover:border-[rgba(58,92,232,0.35)]"
      onClick={onClick}
      type="button"
    >
      {token ? (
        <>
          {token.logoURI && !iconErr ? (
            <img
              src={token.logoURI}
              alt={token.symbol}
              className="w-[22px] h-[22px] rounded-full object-cover shrink-0"
              onError={() => setIconErr(true)}
            />
          ) : (
            <div className="w-[22px] h-[22px] rounded-full bg-mw-brand-deep text-white flex items-center justify-center font-mono text-[11px] font-bold shrink-0">
              {token.symbol[0]}
            </div>
          )}
          <span className="font-mono text-[13px] font-semibold text-[#1A1A2E]">{token.symbol}</span>
          <span className="text-[10px] text-mw-ink-4">▾</span>
        </>
      ) : (
        <>
          <span className="font-sans text-[13px] font-semibold text-mw-ink-4">{placeholder}</span>
          <span className="text-[10px] text-mw-ink-4">▾</span>
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
      <div className="bg-mw-surface-purple rounded-xl p-[20px] max-w-[440px] mx-auto shadow-[0_4px_40px_rgba(58,92,232,0.10)] border border-[#E0DFFF] font-sans">

        {/* ─── FROM chain selector ─── */}
        <div className="flex items-center gap-[6px] mb-[10px]">
          <span className="text-[11px] font-semibold text-mw-ink-4 tracking-[0.4px] uppercase min-w-[32px]">From</span>
          {MINTWARE_CHAIN_IDS.map((id) => (
            <button
              key={id}
              className={`font-sans text-[12px] font-semibold border-[1.5px] border-[#E0DFFF] rounded-xl px-[10px] py-[3px] bg-white text-[#3A3C52] cursor-pointer transition-all duration-150 hover:border-mw-brand-deep hover:text-mw-brand-deep${fromChainId === id ? ' bg-mw-brand-deep border-mw-brand-deep text-white' : ''}`}
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
        <div className="bg-[#1A1A2E] border-[1.5px] border-[#2A2C48] rounded-[14px] px-[16px] py-[14px] transition-colors duration-150 focus-within:border-mw-brand-deep">
          <div className="text-[11px] font-semibold text-[rgba(255,255,255,0.4)] tracking-[0.4px] uppercase mb-[8px]">You pay</div>
          <div className="flex items-center justify-between gap-[10px]">
            <input
              className="flex-1 bg-transparent border-0 outline-none font-mono text-[26px] font-medium text-white min-w-0 w-full p-0 placeholder:text-[rgba(255,255,255,0.25)]"
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
            <div className="[&_.mws-token-btn]:bg-[rgba(255,255,255,0.1)] [&_.mws-token-btn]:border-[rgba(255,255,255,0.2)] [&_.mws-token-btn:hover]:bg-[rgba(255,255,255,0.18)] [&_.mws-token-symbol]:text-white [&_.mws-chevron]:text-[rgba(255,255,255,0.5)]">
              <TokenButton
                token={fromToken}
                onClick={() => setShowFromSelector(true)}
                placeholder="Select"
              />
            </div>
          </div>
          {route && (
            <div className="font-sans text-[11px] text-[rgba(255,255,255,0.3)] mt-[4px]">
              ≈ ${parseFloat(route.fromAmountUSD || '0').toFixed(2)}
            </div>
          )}
        </div>

        {/* ─── Flip button ─── */}
        <div className="flex justify-center items-center my-[-8px] relative z-[1]">
          <button
            className="bg-white border-2 border-[#E0DFFF] rounded-full w-[36px] h-[36px] flex items-center justify-content-center cursor-pointer text-[16px] text-mw-brand-deep transition-all duration-200 shadow-[0_2px_8px_rgba(58,92,232,0.10)] hover:bg-mw-brand-deep hover:border-mw-brand-deep hover:text-white hover:rotate-180"
            onClick={flipTokens}
            type="button"
            aria-label="Flip tokens"
          >
            ⇅
          </button>
        </div>

        {/* ─── TO chain selector ─── */}
        <div className="flex items-center gap-[6px] mb-[10px] mt-[4px]">
          <span className="text-[11px] font-semibold text-mw-ink-4 tracking-[0.4px] uppercase min-w-[32px]">To</span>
          {MINTWARE_CHAIN_IDS.map((id) => (
            <button
              key={id}
              className={`font-sans text-[12px] font-semibold border-[1.5px] border-[#E0DFFF] rounded-xl px-[10px] py-[3px] bg-white text-[#3A3C52] cursor-pointer transition-all duration-150 hover:border-mw-brand-deep hover:text-mw-brand-deep${toChainId === id ? ' bg-mw-brand-deep border-mw-brand-deep text-white' : ''}`}
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
        <div className="bg-white border-[1.5px] border-[#E0DFFF] rounded-[14px] px-[16px] py-[14px] transition-colors duration-150 focus-within:border-mw-brand-deep">
          <div className="text-[11px] font-semibold text-mw-ink-4 tracking-[0.4px] uppercase mb-[8px]">You receive</div>
          <div className="flex items-center justify-between gap-[10px]">
            <div className={`flex-1 font-mono text-[26px] font-medium text-mw-ink min-w-0 overflow-hidden text-ellipsis whitespace-nowrap${quoteLoading ? ' text-[#C4C3F0] animate-pulse' : ''}`}>
              {quoteLoading ? 'Fetching…' : toAmountDisplay || '0'}
            </div>
            <TokenButton
              token={toToken}
              onClick={() => setShowToSelector(true)}
              placeholder="Select"
            />
          </div>
          {route && (
            <div className="font-sans text-[11px] text-mw-ink-4 mt-[4px]">
              ≈ ${parseFloat(route.toAmountUSD || '0').toFixed(2)}
            </div>
          )}
        </div>

        {/* ─── Route info ─── */}
        {route && !quoteLoading && (
          <div className="mt-[12px]">
            <RouteInfo route={route} fee={LIFI_FEE} />
          </div>
        )}

        {/* ─── Quote error ─── */}
        {quoteError && !quoteLoading && (
          <div className="font-sans text-[12px] text-mw-pink bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-sm px-[10px] py-[8px] mt-[10px]">
            ⚠ {quoteError}
          </div>
        )}

        {/* ─── Slippage ─── */}
        <div className="mt-[12px]">
          <SlippageControl value={slippage} onChange={setSlippage} />
        </div>

        {/* ─── Swap button ─── */}
        {address ? (
          <button
            className={`w-full mt-[14px] py-[14px] rounded-md border-0 font-sans text-[15px] font-bold cursor-pointer transition-all duration-200 text-white shadow-[0_2px_12px_rgba(58,92,232,0.25)] hover:not-disabled:shadow-[0_4px_20px_rgba(58,92,232,0.35)] hover:not-disabled:-translate-y-[1px] disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0${swapStatus === 'success' ? ' bg-mw-teal shadow-[0_2px_12px_rgba(42,158,138,0.25)]' : swapStatus === 'error' ? ' bg-mw-pink shadow-[0_2px_12px_rgba(194,83,122,0.25)]' : ' bg-mw-brand-deep hover:not-disabled:bg-[#2a4cd8] disabled:bg-[#C4C3F0]'}`}
            disabled={swapBtnDisabled}
            onClick={swapStatus === 'success' ? handleSwapAgain : handleSwap}
            type="button"
          >
            {swapStatus === 'success' ? '✓ Swap again' : swapBtnLabel}
          </button>
        ) : (
          <div className="font-sans text-[12px] text-mw-ink-4 text-center mt-[10px]">
            Connect your wallet to swap
          </div>
        )}

        {/* ─── Unsupported chain warning ─── */}
        {walletOnUnsupportedChain && (
          <div className="font-sans text-[12px] text-mw-pink bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-sm px-[10px] py-[8px] mt-[10px]">
            ⚠ Your wallet is on an unsupported network. LI.FI routes on Base and Core DAO mainnet only — testnets (Sepolia etc.) are not supported.
          </div>
        )}

        {/* ─── Swap error ─── */}
        {swapStatus === 'error' && swapError && (
          <div className="font-sans text-[12px] text-mw-pink bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-sm px-[10px] py-[8px] mt-[10px]">
            ✗ {swapError}
          </div>
        )}

        {/* ─── Success / tx hash ─── */}
        {swapStatus === 'success' && txHash && (
          <div className="font-sans text-[12px] text-mw-teal bg-[rgba(42,158,138,0.06)] border border-[rgba(42,158,138,0.15)] rounded-sm px-[10px] py-[8px] mt-[10px] flex items-center gap-[6px]">
            <span>✓ Swap confirmed</span>
            <a
              className="font-mono text-[11px] text-mw-brand-deep no-underline break-all hover:underline"
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
