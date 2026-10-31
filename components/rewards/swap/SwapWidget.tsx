'use client'

// =============================================================================
// SwapWidget.tsx
//
// Main swap UI. Key UX improvements (ethereum-ux-adoption-report.md):
//   - Pre-wallet confirmation sheet (SwapConfirmSheet) — shows full summary
//     before the wallet popup, so users know exactly what they are signing.
//   - Real USD value wired from quote.fromAmountUSD (was hardcoded null).
//   - Estimated network fee derived from quote gas data, shown in native token.
//   - Gas sufficiency warning when native balance may not cover fees.
//   - Plain language throughout: "network fee" not "gas", etc.
// =============================================================================

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useAccount, useBalance, useReadContract, useChainId, useSwitchChain } from 'wagmi'
import { useQuote } from '@/hooks/useQuote'
import { useSwap } from '@/hooks/useSwap'
import { useTokenList } from '@/hooks/useTokenList'
import { getChainConfig } from '@/config/chains'
import { getNativeToken } from '@/config/tokens'
import { TokenSelector } from './TokenSelector'
import { PostSwapSummary } from './PostSwapSummary'
import { ChainSelector } from './ChainSelector'
import { SwapConfirmSheet } from './SwapConfirmSheet'
import type { Token } from '@/config/tokens'
import type { LifiQuote } from '@/lib/web2/providers/lifi'

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0]

function fmt(val: string, decimals = 6): string {
  const n = parseFloat(val)
  if (!val || isNaN(n)) return ''
  return n.toFixed(Math.min(decimals, 6))
}

export function SwapWidget({ preselectBuy, preselectChainId }: {
  preselectBuy?: { address: string; chainId: number; symbol?: string }
  preselectChainId?: number
} = {}) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const chainConfig = getChainConfig(chainId)

  const { status, txHash, error: swapError, isLoading: isSwapping, executeSwap, reset } = useSwap()

  // Token state
  const native = getNativeToken(chainId)
  const { tokens: availableTokens } = useTokenList(chainId)
  const [sellToken, setSellToken] = useState<Token | null>(native)
  const [buyToken, setBuyToken] = useState<Token | null>(null)
  const [sellAmount, setSellAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)
  const [customSlippage, setCustomSlippage] = useState('')
  const [showSellSelector, setShowSellSelector] = useState(false)
  const [showBuySelector, setShowBuySelector] = useState(false)

  // ── Optional buy-token preselect: switch to the target chain, then
  //    pre-fill the buy token so the user lands ready to trade it. ──
  const { switchChain } = useSwitchChain()
  const preselectApplied = useRef(false)

  useEffect(() => {
    if (preselectChainId && preselectChainId !== chainId) {
      try { switchChain?.({ chainId: preselectChainId }) } catch { /* user can switch via ChainSelector */ }
    }
  }, [preselectChainId, chainId, switchChain])

  useEffect(() => {
    if (!preselectBuy || preselectApplied.current) return
    if (preselectBuy.chainId !== chainId) return
    const found = availableTokens.find(t => t.address?.toLowerCase() === preselectBuy.address.toLowerCase())
    setBuyToken(found ?? {
      address: preselectBuy.address,
      symbol: preselectBuy.symbol ?? 'TOKEN',
      name: preselectBuy.symbol ?? 'Token',
      decimals: 18,
      chainId: preselectBuy.chainId,
    })
    preselectApplied.current = true
  }, [preselectBuy, availableTokens, chainId])

  // Confirmation sheet — shown before the wallet popup
  const [showConfirm, setShowConfirm] = useState(false)
  const [showWalletHint, setShowWalletHint] = useState(false)

  const isNative =
    !sellToken ||
    sellToken.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ||
    sellToken.address === '0x0000000000000000000000000000000000000000'

  // Native balance (ETH/CORE/etc.)
  const { data: nativeBalance } = useBalance({ address })

  // ERC20 balance via balanceOf
  const { data: erc20BalanceRaw } = useReadContract({
    address: isNative ? undefined : (sellToken?.address as `0x${string}`),
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !isNative && !!address && !!sellToken },
  })

  const balanceFormatted = isNative
    ? nativeBalance
      ? (Number(nativeBalance.value) / 1e18).toFixed(6)
      : null
    : erc20BalanceRaw !== undefined && sellToken
      ? (Number(erc20BalanceRaw) / 10 ** sellToken.decimals).toFixed(6)
      : null

  // Quote
  const { quote, buyAmount, priceImpact, isLoading: isQuoting, error: quoteError, highImpactWarning } = useQuote({
    sellToken,
    buyToken,
    sellAmount,
    taker: address ?? '',
    feeRecipient: chainConfig?.feeRecipient || undefined,
    feeBps: chainConfig?.feeBps ?? 50,
    enabled: isConnected && !!sellToken && !!buyToken && !!sellAmount,
  })

  // ── USD value from quote (LI.FI provides fromAmountUSD) ───────────────────
  const sellAmountUSD: number | null = useMemo(() => {
    if (!quote) return null
    const lq = quote as LifiQuote
    const v = parseFloat(lq.fromAmountUSD ?? '')
    return isNaN(v) || v === 0 ? null : v
  }, [quote])

  // ── Gas cost estimate from quote transaction data ─────────────────────────
  // Compute: gasCostWei = estimatedGas (units) × transaction.gasPrice (wei/gas)
  const gasCostWei: bigint | null = useMemo(() => {
    if (!quote) return null
    try {
      const lq = quote as LifiQuote
      const gasUnits = BigInt(lq.estimatedGas || '0')
      const gasPrice = BigInt(lq.transaction?.gasPrice || '0')
      if (!gasUnits || !gasPrice) return null
      return gasUnits * gasPrice
    } catch {
      return null
    }
  }, [quote])

  const gasCostEth: string | null = gasCostWei !== null
    ? (Number(gasCostWei) / 1e18).toFixed(6)
    : null

  // Fiat-denominated gas cost from LI.FI estimate (preferred display)
  const gasCostUSD: string | null = useMemo(() => {
    if (!quote) return null
    const lq = quote as LifiQuote
    const v = parseFloat(lq.gasCostUSD ?? '')
    return isNaN(v) || v === 0 ? null : v.toFixed(2)
  }, [quote])

  // ── Gas sufficiency check ─────────────────────────────────────────────────
  // Warn when native balance may not cover the estimated network fee.
  // For native-token swaps we also need to cover the send value.
  const isGasInsufficient: boolean = useMemo(() => {
    if (!gasCostWei || !nativeBalance) return false
    try {
      const lq = quote as LifiQuote
      const txValue = lq?.transaction?.value ? BigInt(lq.transaction.value) : 0n
      const needed = gasCostWei + txValue
      return nativeBalance.value < needed
    } catch {
      return false
    }
  }, [gasCostWei, nativeBalance, quote])

  const nativeSymbol = chainConfig?.chain.nativeCurrency.symbol ?? 'ETH'

  const feeAmountUSD = sellAmountUSD !== null && chainConfig
    ? (sellAmountUSD * chainConfig.feeBps) / 10000
    : null

  // Quick amount buttons
  const setPercent = useCallback(
    (pct: number) => {
      if (!balanceFormatted) return
      const val = (parseFloat(balanceFormatted) * pct).toFixed(6).replace(/\.?0+$/, '')
      setSellAmount(val)
    },
    [balanceFormatted]
  )

  // Flip tokens
  const flip = useCallback(() => {
    setSellToken(buyToken)
    setBuyToken(sellToken)
    setSellAmount(buyAmount ?? '')
  }, [sellToken, buyToken, buyAmount])

  // Action button label
  function getActionLabel(): string {
    if (!isConnected) return 'Connect Wallet'
    if (!sellToken || !buyToken) return 'Select Token'
    if (!sellAmount || parseFloat(sellAmount) <= 0) return 'Enter an Amount'
    if (isQuoting) return 'Getting quote…'
    if (quoteError) return 'Retry Quote'
    if (!quote) return 'Enter an Amount'
    if (isSwapping) return 'Swapping…'
    return 'Review Swap'
  }

  function isActionDisabled(): boolean {
    if (!isConnected) return true
    if (!sellToken || !buyToken) return true
    if (!sellAmount || parseFloat(sellAmount) <= 0) return true
    if (isQuoting || isSwapping) return true
    if (!quote) return true
    return false
  }

  // Opens the confirmation sheet instead of going straight to the wallet
  function handleReviewSwap() {
    if (!quote || !sellToken || !buyToken) return
    setShowConfirm(true)
  }

  // Called by the confirm sheet — this triggers the actual wallet popup
  async function handleConfirmSwap() {
    if (!quote || !sellToken || !buyToken) return
    setShowWalletHint(false)
    await executeSwap({
      quote,
      sellToken,
      buyToken,
      sellAmount: toWei(sellAmount, sellToken.decimals),
    })
    // Sheet stays visible (showing "Waiting for wallet…") until success or error
  }

  function toWei(amount: string, decimals: number): string {
    const [whole, frac = ''] = amount.split('.')
    const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
    const raw = BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0')
    return raw.toString()
  }

  const activeSlippage = customSlippage ? parseFloat(customSlippage) : slippage

  useEffect(() => {
    if (!showConfirm || !isSwapping) {
      setShowWalletHint(false)
      return
    }

    const timer = window.setTimeout(() => setShowWalletHint(true), 8000)
    return () => window.clearTimeout(timer)
  }, [showConfirm, isSwapping])

  const quoteSummary = useMemo(() => {
    if (!sellToken || !buyToken || !sellAmount || !quote) return null

    const receiveText = buyAmount ? `about ${fmt(buyAmount)} ${buyToken.symbol}` : `an estimated amount of ${buyToken.symbol}`
    const networkText = chainConfig?.name ? `on ${chainConfig.name}` : 'on the selected network'

    if (isGasInsufficient) {
      return `This swap will ask your wallet to trade ${sellAmount} ${sellToken.symbol} for ${receiveText} ${networkText}. You may need a little more ${nativeSymbol} to cover the network fee.`
    }

    return `This swap will ask your wallet to trade ${sellAmount} ${sellToken.symbol} for ${receiveText} ${networkText}. Review the amount, fee, and route before you continue.`
  }, [sellToken, buyToken, sellAmount, quote, buyAmount, chainConfig?.name, isGasInsufficient, nativeSymbol])

  const readinessItems = useMemo(() => {
    const items: string[] = []

    if (!isConnected) {
      items.push('Connect an EVM wallet to unlock live quotes and wallet confirmation.')
      return items
    }

    if (!sellToken || !buyToken) {
      items.push('Choose the token you want to swap from and the token you want to receive.')
    }

    if (!sellAmount || parseFloat(sellAmount) <= 0) {
      items.push('Enter an amount to preview the route, platform fee, and network fee.')
    }

    if (quote && chainConfig?.name) {
      items.push(`You are trading on ${chainConfig.name}. Mintware will keep this swap on the selected network.`)
      items.push('You will review the route and fees here before your wallet opens.')
    }

    if (isGasInsufficient) {
      items.push(`You may need a little more ${nativeSymbol} to cover the network fee before this trade can complete.`)
    }

    return items.slice(0, 3)
  }, [isConnected, sellToken, buyToken, sellAmount, quote, chainConfig?.name, isGasInsufficient, nativeSymbol])

  // Mineral styles: wells (inset) hold what you type; the raised pieces are what you press.
  const WELL = { background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }
  const NOTE = 'px-[14px] py-[11px] rounded-[14px] text-[13px] leading-[1.5]'
  const WARN = `${NOTE} text-[#B42318]`
  const WARN_STYLE = { background: '#FDF1EF', boxShadow: 'inset 0 0 0 1px rgba(180,35,24,.18)' }

  function tokenButton(token: Token | null, onClick: () => void) {
    return (
      <button
        className={`inline-flex items-center gap-[8px] pl-[8px] pr-[12px] min-h-[40px] rounded-full cursor-pointer text-[14px] font-semibold border-0 whitespace-nowrap shrink-0 ${token ? 'mw-btn-quiet !px-3' : 'mw-btn !px-4'}`}
        onClick={onClick}
      >
        {token?.logoURI && (
          <img
            src={token.logoURI}
            alt=""
            className="w-[22px] h-[22px] rounded-full object-cover bg-[#ECECF2]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        {token ? token.symbol : 'Select token'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-60"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    )
  }

  return (
    <>
      <div className="w-full font-geist">
        {/* ── Header strip ── */}
        <div className="px-[22px] py-[18px] flex items-center justify-between gap-3 bg-white" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <div>
            <div className="text-[18px] font-semibold text-ink leading-none tracking-[-0.02em]">Swap</div>
            <div className="text-[12.5px] text-ink-soft mt-1">Best route across chains, via LI.FI</div>
          </div>
          <ChainSelector />
        </div>

        {/* ── Content area ── */}
        <div className="bg-white p-[20px] flex flex-col gap-[10px]">

          {/* You pay */}
          <div className="rounded-[18px] p-[16px] transition-shadow duration-150 focus-within:shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_2px_rgba(91,91,230,.45)]" style={WELL}>
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[13px] text-ink-mid font-medium">You pay</span>
              {balanceFormatted && sellToken && (
                <span className="text-[12.5px] text-ink-soft font-geist-mono">
                  Balance {balanceFormatted} {sellToken.symbol}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[10px]">
              <div className="flex-1 min-w-0">
                <input
                  className="w-full bg-transparent border-0 outline-none font-geist-mono text-[28px] text-ink placeholder:text-ink-soft tracking-[-0.02em]"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  aria-label="Amount to pay"
                  value={sellAmount}
                  onChange={e => setSellAmount(e.target.value)}
                />
                {/* USD value sub-label */}
                {sellAmountUSD !== null && (
                  <div className="text-[12.5px] text-ink-soft font-geist-mono mt-[2px]">
                    ≈ ${sellAmountUSD.toFixed(2)}
                  </div>
                )}
              </div>
              {tokenButton(sellToken, () => setShowSellSelector(true))}
            </div>
            {balanceFormatted && (
              <div className="flex gap-[6px] mt-[10px]">
                {[['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['MAX', 1]].map(([label, pct]) => (
                  <button
                    key={label as string}
                    className="px-[10px] min-h-[30px] rounded-[9px] bg-white border-0 font-geist-mono text-[12px] text-ink-mid cursor-pointer hover:text-ink"
                    style={{ boxShadow: 'var(--mw-raise-sm)' }}
                    onClick={() => setPercent(pct as number)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip */}
          <div className="flex items-center justify-center -my-[18px] relative z-[1]">
            <button
              className="w-[40px] h-[40px] rounded-[12px] bg-white border-0 cursor-pointer flex items-center justify-center transition-transform duration-200 hover:rotate-180"
              style={{ boxShadow: 'var(--mw-raise-sm), 0 0 0 4px #fff', color: 'var(--mw-peri-deep)' }}
              onClick={flip}
              title="Flip tokens"
              aria-label="Flip tokens"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" /></svg>
            </button>
          </div>

          {/* You receive */}
          <div className="rounded-[18px] p-[16px]" style={WELL}>
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[13px] text-ink-mid font-medium">You receive (estimate)</span>
            </div>
            <div className="flex items-center gap-[10px]">
              <span className={`flex-1 font-geist-mono text-[28px] text-ink tracking-[-0.02em] overflow-hidden text-ellipsis whitespace-nowrap${isQuoting ? ' text-ink-soft animate-[blink_1s_step-end_infinite]' : ''}`}>
                {isQuoting ? '…' : buyAmount ? fmt(buyAmount) : <span className="text-ink-soft">0</span>}
              </span>
              {tokenButton(buyToken, () => setShowBuySelector(true))}
            </div>
          </div>

          {/* Slippage — a segmented well with the active value raised */}
          <div className="flex items-center gap-[6px] flex-wrap mt-[2px]">
            <span className="text-[13px] text-ink-mid font-medium mr-1">Slippage</span>
            <div className="inline-flex gap-1 p-1 rounded-[12px]" style={WELL}>
              {SLIPPAGE_PRESETS.map(p => {
                const on = !customSlippage && slippage === p
                return (
                  <button
                    key={p}
                    aria-pressed={on}
                    className="px-[10px] min-h-[30px] rounded-[9px] border-0 font-geist-mono text-[12.5px] cursor-pointer"
                    style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}
                    onClick={() => { setSlippage(p); setCustomSlippage('') }}
                  >
                    {p}%
                  </button>
                )
              })}
              <input
                className="w-[64px] px-[6px] min-h-[30px] rounded-[9px] border-0 bg-white font-geist-mono text-[12.5px] text-ink text-center outline-none focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
                type="number"
                min="0.01"
                max="50"
                step="0.1"
                placeholder="Custom"
                aria-label="Custom slippage percent"
                value={customSlippage}
                onChange={e => setCustomSlippage(e.target.value)}
              />
            </div>
          </div>

          {/* Route info strip — includes estimated network fee */}
          {quote && sellToken && buyToken && !isQuoting && (
            <div className="flex items-center justify-between flex-wrap gap-2 px-[14px] py-[10px] rounded-[14px]" style={{ background: 'var(--mw-band)' }}>
              <div className="flex items-center gap-[6px]">
                <span className="text-[12.5px] font-semibold" style={{ color: 'var(--mw-peri-deep)' }}>Best route</span>
                <span className="text-[12.5px] text-ink-soft">via LI.FI</span>
              </div>
              <div className="flex items-center gap-[8px] flex-wrap">
                <span className="font-geist-mono text-[12.5px] text-ink-mid">
                  1 {sellToken.symbol} ≈ {parseFloat(quote.price || '0') > 0
                    ? parseFloat(quote.price).toFixed(4)
                    : buyAmount && sellAmount
                      ? (parseFloat(buyAmount) / parseFloat(sellAmount)).toFixed(4)
                      : '—'
                  } {buyToken.symbol}
                </span>
                {priceImpact !== null && (
                  <span className={`font-geist-mono text-[12px] px-[7px] py-[2px] rounded-full ${priceImpact > 2 ? 'bg-[#FDF1EF] text-[#B42318]' : 'bg-white text-ink-mid'}`}>
                    {priceImpact > 0 ? '-' : ''}{Math.abs(priceImpact).toFixed(2)}%
                  </span>
                )}
                {/* Network fee preview — fiat-first when available */}
                {(gasCostUSD || gasCostEth) && (
                  <span className="font-geist-mono text-[12px] text-ink-soft" title="Estimated network fee">
                    {gasCostUSD
                      ? `~$${gasCostUSD} fee`
                      : `~${parseFloat(gasCostEth!).toFixed(5)} ${nativeSymbol} fee`}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gas insufficiency warning */}
          {isGasInsufficient && quote && (
            <div className={WARN} style={WARN_STYLE}>
              Your {nativeSymbol} balance may be too low to cover the network fee for this swap.
              Add some {nativeSymbol} before proceeding.
            </div>
          )}

          {/* Errors */}
          {quoteError && (
            <div className={WARN} style={WARN_STYLE}>
              {quoteError}
            </div>
          )}
          {swapError && !isSwapping && status === 'error' && (
            <div className={WARN} style={WARN_STYLE}>
              {swapError}
            </div>
          )}

          {/* High price impact warning */}
          {highImpactWarning && (
            <div className={WARN} style={WARN_STYLE}>
              High price impact ({priceImpact?.toFixed(1)}%) — consider a smaller trade
            </div>
          )}

          {quoteSummary && (
            <div className={`${NOTE} text-ink-mid`} style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
              {quoteSummary}
            </div>
          )}

          {readinessItems.length > 0 && (
            <div className="px-[14px] py-[12px] rounded-[14px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft mb-[8px]">
                Before you trade
              </div>
              <ol className="m-0 p-0 list-none flex flex-col gap-[7px]">
                {readinessItems.map((item, i) => (
                  <li key={item} className="flex items-start gap-[9px] text-[13px] text-ink-mid leading-[1.5]">
                    <span className="w-[20px] h-[20px] rounded-full grid place-items-center text-[11px] font-semibold text-white shrink-0 mt-[1px]" style={{ background: 'var(--mw-btn)' }}>{i + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Action button — "Review Swap" opens the confirmation sheet */}
          <button
            className={`w-full !min-h-[54px] !rounded-[14px] text-[16px] mt-[4px] ${isActionDisabled() ? 'mw-btn-quiet !text-ink-soft cursor-not-allowed' : 'mw-btn'}`}
            disabled={isActionDisabled()}
            onClick={handleReviewSwap}
          >
            {getActionLabel()}
          </button>
        </div>
      </div>

      {/* Token selectors */}
      {showSellSelector && (
        <TokenSelector
          tokens={availableTokens}
          selected={sellToken}
          onSelect={(t) => { setSellToken(t); setShowSellSelector(false) }}
          excludeAddress={buyToken?.address}
          onClose={() => setShowSellSelector(false)}
          chainName={chainConfig?.name ?? ''}
        />
      )}
      {showBuySelector && (
        <TokenSelector
          tokens={availableTokens}
          selected={buyToken}
          onSelect={(t) => { setBuyToken(t); setShowBuySelector(false) }}
          excludeAddress={sellToken?.address}
          onClose={() => setShowBuySelector(false)}
          chainName={chainConfig?.name ?? ''}
        />
      )}

      {/* Pre-wallet confirmation sheet */}
      {showConfirm && sellToken && buyToken && (
        <SwapConfirmSheet
          sellToken={sellToken}
          buyToken={buyToken}
          sellAmount={sellAmount}
          buyAmount={buyAmount ?? '0'}
          sellAmountUSD={sellAmountUSD !== null ? String(sellAmountUSD.toFixed(2)) : null}
          gasCostEth={gasCostEth}
          gasCostUSD={gasCostUSD}
          nativeSymbol={nativeSymbol}
          priceImpact={priceImpact}
          chainName={chainConfig?.name ?? ''}
          feeBps={chainConfig?.feeBps ?? 50}
          highImpact={highImpactWarning}
          isSwapping={isSwapping}
          showWalletHint={showWalletHint}
          onConfirm={handleConfirmSwap}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* Post-swap summary — also closes the confirm sheet */}
      {status === 'success' && txHash && (
        <PostSwapSummary
          txHash={txHash}
          buyAmount={buyAmount}
          buyToken={buyToken}
          sellAmountUSD={sellAmountUSD}
          onDismiss={() => {
            setShowConfirm(false)
            reset()
            setSellAmount('')
          }}
        />
      )}
    </>
  )
}
