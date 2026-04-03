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

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAccount, useBalance, useReadContract, useChainId } from 'wagmi'
import { useQuote } from '@/hooks/useQuote'
import { useSwap } from '@/hooks/useSwap'
import { useCampaign } from '@/hooks/useCampaign'
import { getChainConfig } from '@/config/chains'
import { getNativeToken } from '@/config/tokens'
import { TokenSelector } from './TokenSelector'
import { CampaignBanner } from './CampaignBanner'
import { RewardPreview } from './RewardPreview'
import { AttributionScorePreview } from './AttributionScorePreview'
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

export function SwapWidget() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const chainConfig = getChainConfig(chainId)

  const { campaignId, referrer, campaign } = useCampaign()
  const { status, txHash, error: swapError, isLoading: isSwapping, executeSwap, reset } = useSwap()

  // Token state
  const native = getNativeToken(chainId)
  const [sellToken, setSellToken] = useState<Token | null>(native)
  const [buyToken, setBuyToken] = useState<Token | null>(null)
  const [sellAmount, setSellAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)
  const [customSlippage, setCustomSlippage] = useState('')
  const [showSellSelector, setShowSellSelector] = useState(false)
  const [showBuySelector, setShowBuySelector] = useState(false)

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
    campaignId,
    referrer,
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

  const estimatedScoreGain = sellAmountUSD ? Math.round(sellAmountUSD / 10) : 0

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
    if (quoteError === 'CORE_COMING_SOON') return 'Core Swaps Coming Soon'
    if (quoteError) return 'Retry Quote'
    if (!quote) return 'Enter an Amount'
    if (isSwapping) return 'Swapping…'
    return 'Review Swap'
  }

  function isActionDisabled(): boolean {
    if (!isConnected) return true
    if (!sellToken || !buyToken) return true
    if (!sellAmount || parseFloat(sellAmount) <= 0) return true
    if (quoteError === 'CORE_COMING_SOON') return true
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
      campaignId,
      referrer,
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

  return (
    <>
      <div className="w-full">
        <CampaignBanner campaignId={campaignId} referrer={referrer} campaign={campaign} />

        {/* ── Header strip ── */}
        <div className="px-[22px] py-[18px] flex items-center justify-between bg-white border-x border-t border-[rgba(79,126,247,0.14)] rounded-t-xl">
          <div>
            <div className="text-[18px] font-bold text-mw-ink font-sans leading-none mb-[3px]">Swap</div>
            <div className="text-[12px] text-mw-ink-3 font-sans">Best price across chains</div>
          </div>
          <ChainSelector />
        </div>

        {/* ── Content area ── */}
        <div className="bg-white border-x border-b border-[rgba(79,126,247,0.14)] rounded-b-xl p-[20px] flex flex-col gap-[10px]">

          {/* Slippage bar */}
          <div className="flex items-center gap-[6px] px-[12px] py-[8px] bg-[rgba(79,126,247,0.04)] border border-[rgba(79,126,247,0.14)] rounded-[10px]">
            <span className="text-[12px] text-mw-ink-4 font-sans shrink-0">Slippage:</span>
            {SLIPPAGE_PRESETS.map(p => (
              <button
                key={p}
                className={`px-[10px] py-[4px] rounded-[7px] border border-transparent font-mono text-[12px] font-semibold cursor-pointer transition-all duration-[120ms] hover:bg-[rgba(79,126,247,0.1)] hover:text-mw-brand${!customSlippage && slippage === p ? ' bg-[rgba(79,126,247,0.12)] border-[rgba(79,126,247,0.28)] text-mw-brand' : ' bg-transparent text-mw-ink-4'}`}
                onClick={() => { setSlippage(p); setCustomSlippage('') }}
              >
                {p}%
              </button>
            ))}
            <input
              className="w-[56px] px-[6px] py-[4px] rounded-[7px] border border-[rgba(79,126,247,0.18)] bg-white font-mono text-[12px] text-mw-ink text-center outline-none focus:border-[rgba(79,126,247,0.5)]"
              type="number"
              min="0.01"
              max="50"
              step="0.1"
              placeholder="Custom"
              value={customSlippage}
              onChange={e => setCustomSlippage(e.target.value)}
            />
          </div>

          {/* You pay — glass style */}
          <div className="bg-white border border-[rgba(79,126,247,0.2)] rounded-md p-[14px] shadow-[0_2px_8px_rgba(79,126,247,0.06)] transition-all duration-150 focus-within:border-[rgba(79,126,247,0.45)] focus-within:shadow-[0_2px_14px_rgba(79,126,247,0.13)]">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] text-mw-ink-4 font-sans">You pay</span>
              {balanceFormatted && sellToken && (
                <span className="text-[12px] text-mw-ink-4 font-mono">
                  Balance: {balanceFormatted} {sellToken.symbol}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[10px]">
              <div className="flex-1 min-w-0">
                <input
                  className="w-full bg-transparent border-0 outline-none font-mono text-[22px] font-semibold text-mw-ink placeholder:text-[#C4C5D0]"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={sellAmount}
                  onChange={e => setSellAmount(e.target.value)}
                />
                {/* USD value sub-label */}
                {sellAmountUSD !== null && (
                  <div className="text-[11px] text-mw-ink-4 font-sans mt-[2px]">
                    ≈ ${sellAmountUSD.toFixed(2)}
                  </div>
                )}
              </div>
              <button
                className={`inline-flex items-center gap-[6px] px-[12px] py-[7px] rounded-sm border-0 cursor-pointer font-sans text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0${sellToken ? ' bg-[rgba(79,126,247,0.07)] text-mw-ink hover:bg-[rgba(79,126,247,0.13)]' : ' bg-mw-brand text-white hover:bg-[#3A52CC]'}`}
                onClick={() => setShowSellSelector(true)}
              >
                {sellToken?.logoURI && (
                  <img
                    src={sellToken.logoURI}
                    alt={sellToken.symbol}
                    className="w-[18px] h-[18px] rounded-full object-cover bg-[#e2e8f0]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {sellToken ? sellToken.symbol : 'Select token'}
                <span className="text-[10px] opacity-60">▾</span>
              </button>
            </div>
            {balanceFormatted && (
              <div className="flex gap-[4px] mt-[8px]">
                {[['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['MAX', 1]].map(([label, pct]) => (
                  <button
                    key={label as string}
                    className="px-[8px] py-[3px] rounded-[6px] bg-[rgba(79,126,247,0.06)] border border-[rgba(79,126,247,0.15)] font-sans text-[11px] font-semibold text-mw-ink-4 cursor-pointer transition-all duration-[120ms] hover:bg-[rgba(79,126,247,0.12)] hover:text-mw-brand hover:border-[rgba(79,126,247,0.3)]"
                    onClick={() => setPercent(pct as number)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip */}
          <div className="flex items-center justify-center">
            <button
              className="w-[36px] h-[36px] rounded-[10px] bg-white border border-[rgba(79,126,247,0.2)] text-[18px] cursor-pointer flex items-center justify-center transition-all duration-150 text-mw-brand shadow-[0_1px_6px_rgba(79,126,247,0.1)] hover:bg-[rgba(79,126,247,0.08)] hover:border-[rgba(79,126,247,0.4)] hover:shadow-[0_2px_10px_rgba(79,126,247,0.2)] hover:rotate-180"
              onClick={flip}
              title="Flip tokens"
            >
              ↕
            </button>
          </div>

          {/* You receive — glass style */}
          <div className="bg-white border border-[rgba(79,126,247,0.2)] rounded-md p-[14px] shadow-[0_2px_8px_rgba(79,126,247,0.06)] transition-all duration-150">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] text-mw-ink-4 font-sans">You receive (estimate)</span>
            </div>
            <div className="flex items-center gap-[10px]">
              <span className={`flex-1 font-mono text-[22px] font-semibold text-mw-ink overflow-hidden text-ellipsis whitespace-nowrap${isQuoting ? ' text-[#C4C5D0] animate-[blink_1s_step-end_infinite]' : ''}`}>
                {isQuoting ? '…' : buyAmount ? fmt(buyAmount) : <span className="text-[#C4C5D0]">0</span>}
              </span>
              <button
                className={`inline-flex items-center gap-[6px] px-[12px] py-[7px] rounded-sm border-0 cursor-pointer font-sans text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0${buyToken ? ' bg-[rgba(79,126,247,0.07)] text-mw-ink hover:bg-[rgba(79,126,247,0.13)]' : ' bg-mw-brand text-white hover:bg-[#3A52CC]'}`}
                onClick={() => setShowBuySelector(true)}
              >
                {buyToken?.logoURI && (
                  <img
                    src={buyToken.logoURI}
                    alt={buyToken.symbol}
                    className="w-[18px] h-[18px] rounded-full object-cover bg-[#e2e8f0]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {buyToken ? buyToken.symbol : 'Select token'}
                <span className="text-[10px] opacity-60">▾</span>
              </button>
            </div>
          </div>

          {/* Route info strip — includes estimated network fee */}
          {quote && sellToken && buyToken && !isQuoting && (
            <div className="flex items-center justify-between px-[12px] py-[8px] bg-[rgba(79,126,247,0.04)] border border-[rgba(79,126,247,0.13)] rounded-[10px]">
              <div className="flex items-center gap-[6px]">
                <span className="text-[11px] font-bold text-mw-brand font-sans">Best route</span>
                <span className="text-[11px] text-mw-ink-4 font-sans">via LI.FI</span>
              </div>
              <div className="flex items-center gap-[8px]">
                <span className="font-mono text-[12px] text-mw-ink-3">
                  1 {sellToken.symbol} ≈ {parseFloat(quote.price || '0') > 0
                    ? parseFloat(quote.price).toFixed(4)
                    : buyAmount && sellAmount
                      ? (parseFloat(buyAmount) / parseFloat(sellAmount)).toFixed(4)
                      : '—'
                  } {buyToken.symbol}
                </span>
                {priceImpact !== null && (
                  <span className={`font-mono text-[12px] px-[6px] py-[2px] rounded-[5px] ${priceImpact > 2 ? 'bg-[rgba(239,68,68,0.08)] text-[#dc2626]' : 'bg-[rgba(22,163,74,0.08)] text-mw-green'}`}>
                    {priceImpact > 0 ? '-' : ''}{Math.abs(priceImpact).toFixed(2)}%
                  </span>
                )}
                {/* Network fee preview — fiat-first when available */}
                {(gasCostUSD || gasCostEth) && (
                  <span className="font-mono text-[11px] text-mw-ink-4" title="Estimated network fee">
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
            <div className="px-[12px] py-[10px] rounded-[10px] bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.25)] font-sans text-[12px] text-[#ca8a04]">
              ⚠ Your {nativeSymbol} balance may be too low to cover the network fee for this swap.
              Add some {nativeSymbol} before proceeding.
            </div>
          )}

          {/* Errors */}
          {quoteError === 'CORE_COMING_SOON' && (
            <div className="px-[14px] py-[10px] rounded-[10px] bg-[rgba(79,126,247,0.06)] border border-[rgba(79,126,247,0.18)] font-sans text-[13px] text-mw-brand text-center">
              🚧 Core swaps coming soon — Molten router deploying shortly
            </div>
          )}
          {quoteError && quoteError !== 'CORE_COMING_SOON' && (
            <div className="px-[14px] py-[10px] rounded-[10px] bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.18)] font-sans text-[13px] text-[#dc2626]">
              ⚠ {quoteError}
            </div>
          )}
          {swapError && !isSwapping && status === 'error' && (
            <div className="px-[14px] py-[10px] rounded-[10px] bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.18)] font-sans text-[13px] text-[#dc2626]">
              ⚠ {swapError}
            </div>
          )}

          {/* High price impact warning */}
          {highImpactWarning && (
            <div className="px-[12px] py-[8px] rounded-sm bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.2)] font-sans text-[12px] text-[#ca8a04]">
              ⚠ High price impact ({priceImpact?.toFixed(1)}%) — consider a smaller trade
            </div>
          )}

          {/* Reward preview */}
          <RewardPreview
            campaign={campaign}
            sellAmountUSD={sellAmountUSD}
            feeBps={chainConfig?.feeBps ?? 50}
            feeTokenSymbol={buyToken?.symbol ?? ''}
            feeAmountUSD={feeAmountUSD}
            isLoading={isQuoting}
          />

          {/* Attribution score preview */}
          <AttributionScorePreview estimatedScoreGain={estimatedScoreGain} />

          {quoteSummary && (
            <div className="px-[12px] py-[10px] rounded-[10px] bg-[rgba(79,126,247,0.04)] border border-[rgba(79,126,247,0.12)] font-sans text-[12px] text-mw-ink-4 leading-[1.55]">
              {quoteSummary}
            </div>
          )}

          {readinessItems.length > 0 && (
            <div className="px-[12px] py-[12px] rounded-[10px] bg-[rgba(26,26,46,0.03)] border border-[rgba(26,26,46,0.08)]">
              <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-mw-ink-4 font-sans mb-[8px]">
                Before you trade
              </div>
              <div className="flex flex-col gap-[6px]">
                {readinessItems.map((item) => (
                  <div key={item} className="flex items-start gap-[8px] text-[12px] text-mw-ink-4 font-sans leading-[1.5]">
                    <span className="text-mw-brand font-bold">•</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action button — "Review Swap" opens the confirmation sheet */}
          <button
            className={`w-full py-[14px] rounded-md border-0 cursor-pointer font-sans text-[15px] font-bold transition-all duration-150 mt-[2px] disabled:cursor-not-allowed${
              isActionDisabled()
                ? ' bg-[rgba(26,26,46,0.08)] text-mw-ink-4'
                : quoteError === 'CORE_COMING_SOON'
                ? ' bg-[rgba(79,126,247,0.12)] text-mw-brand'
                : ' text-white hover:-translate-y-[1px]'
            }`}
            style={
              !isActionDisabled() && quoteError !== 'CORE_COMING_SOON'
                ? { background: 'linear-gradient(135deg, #4f7ef7, #3A52CC)', boxShadow: '0 4px 24px rgba(79,126,247,0.4)' }
                : undefined
            }
            disabled={isActionDisabled()}
            onClick={handleReviewSwap}
          >
            {getActionLabel()}
          </button>

          {/* Score gain live preview */}
          {sellAmount && parseFloat(sellAmount) > 0 && campaign?.isActive && (
            <div className="flex items-center justify-center gap-[5px] text-[12px] font-sans -mt-[2px]">
              <span className="font-bold text-mw-brand">+8 pts</span>
              <span className="text-mw-ink-3">per trading day · builds your Attribution score</span>
            </div>
          )}
        </div>
      </div>

      {/* Token selectors */}
      {showSellSelector && (
        <TokenSelector
          selected={sellToken}
          onSelect={(t) => { setSellToken(t); setShowSellSelector(false) }}
          excludeAddress={buyToken?.address}
          onClose={() => setShowSellSelector(false)}
        />
      )}
      {showBuySelector && (
        <TokenSelector
          selected={buyToken}
          onSelect={(t) => { setBuyToken(t); setShowBuySelector(false) }}
          excludeAddress={sellToken?.address}
          onClose={() => setShowBuySelector(false)}
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
          campaign={campaign}
          referrer={referrer}
          estimatedScoreGain={estimatedScoreGain}
          currentScore={0}
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
