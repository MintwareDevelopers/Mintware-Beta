'use client'

import { useState, useCallback } from 'react'
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
import type { Token } from '@/config/tokens'

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

  const isNative =
    !sellToken ||
    sellToken.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ||
    sellToken.address === '0x0000000000000000000000000000000000000000'

  // Native balance (ETH/CORE)
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
    feeBps: chainConfig?.feeBps ?? 10,
    campaignId,
    referrer,
    enabled: isConnected && !!sellToken && !!buyToken && !!sellAmount,
  })

  // Estimated trade USD value (rough)
  const sellAmountUSD: number | null = null // wire to price feed if available

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
    return 'Swap'
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

  async function handleSwap() {
    if (!quote || !sellToken || !buyToken) return
    await executeSwap({
      quote,
      sellToken,
      buyToken,
      sellAmount: toWei(sellAmount, sellToken.decimals),
      campaignId,
      referrer,
    })
  }

  function toWei(amount: string, decimals: number): string {
    const [whole, frac = ''] = amount.split('.')
    const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
    const raw = BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0')
    return raw.toString()
  }

  const activeSlippage = customSlippage ? parseFloat(customSlippage) : slippage

  return (
    <>
      <div className="max-w-[440px] mx-auto w-full">
        <CampaignBanner campaignId={campaignId} referrer={referrer} campaign={campaign} />

        <div className="bg-white rounded-lg border border-[rgba(26,26,46,0.08)] shadow-[0_4px_24px_rgba(26,26,46,0.07)] p-[20px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-[16px]">
            <span className="font-serif text-[18px] font-bold text-mw-ink">Swap</span>
            <div className="flex items-center gap-[8px]">
              <ChainSelector />
            </div>
          </div>

          {/* Slippage bar */}
          <div className="flex items-center gap-[6px] mb-[14px] px-[12px] py-[8px] bg-[rgba(26,26,46,0.03)] border border-[rgba(26,26,46,0.07)] rounded-[10px]">
            <span className="text-[12px] text-mw-ink-4 font-sans shrink-0">Slippage:</span>
            {SLIPPAGE_PRESETS.map(p => (
              <button
                key={p}
                className={`px-[10px] py-[4px] rounded-[7px] border border-transparent font-mono text-[12px] font-semibold cursor-pointer transition-all duration-[120ms] hover:bg-[rgba(0,82,255,0.07)] hover:text-mw-brand${!customSlippage && slippage === p ? ' bg-[rgba(0,82,255,0.12)] border-[rgba(0,82,255,0.25)] text-mw-brand' : ' bg-transparent text-mw-ink-4'}`}
                onClick={() => { setSlippage(p); setCustomSlippage('') }}
              >
                {p}%
              </button>
            ))}
            <input
              className="w-[56px] px-[6px] py-[4px] rounded-[7px] border border-[rgba(26,26,46,0.12)] bg-[rgba(26,26,46,0.03)] font-mono text-[12px] text-mw-ink text-center outline-none focus:border-[rgba(0,82,255,0.4)]"
              type="number"
              min="0.01"
              max="50"
              step="0.1"
              placeholder="Custom"
              value={customSlippage}
              onChange={e => setCustomSlippage(e.target.value)}
            />
          </div>

          {/* You pay */}
          <div className="bg-[rgba(26,26,46,0.03)] border border-[rgba(26,26,46,0.08)] rounded-md p-[14px] transition-colors duration-150 focus-within:border-[rgba(0,82,255,0.3)]">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] text-mw-ink-4 font-sans">You pay</span>
              {balanceFormatted && sellToken && (
                <span className="text-[12px] text-mw-ink-4 font-mono">
                  Balance: {balanceFormatted} {sellToken.symbol}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[10px]">
              <input
                className="flex-1 bg-transparent border-0 outline-none font-mono text-[22px] font-semibold text-mw-ink min-w-0 placeholder:text-[#C4C5D0]"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={sellAmount}
                onChange={e => setSellAmount(e.target.value)}
              />
              <button
                className={`inline-flex items-center gap-[6px] px-[12px] py-[7px] rounded-sm border-0 cursor-pointer font-sans text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0${sellToken ? ' bg-[rgba(26,26,46,0.07)] text-mw-ink hover:bg-[rgba(26,26,46,0.12)]' : ' bg-mw-ink text-white hover:bg-[#2d2d48]'}`}
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
                    className="px-[8px] py-[3px] rounded-[6px] bg-[rgba(26,26,46,0.05)] border border-[rgba(26,26,46,0.09)] font-sans text-[11px] font-semibold text-mw-ink-4 cursor-pointer transition-all duration-[120ms] hover:bg-[rgba(0,82,255,0.08)] hover:text-mw-brand hover:border-[rgba(0,82,255,0.2)]"
                    onClick={() => setPercent(pct as number)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip */}
          <div className="flex items-center justify-center my-[8px]">
            <button
              className="w-[36px] h-[36px] rounded-[10px] bg-white border border-[rgba(26,26,46,0.12)] text-[18px] cursor-pointer flex items-center justify-center transition-all duration-150 text-[#3A3C52] shadow-[0_1px_4px_rgba(26,26,46,0.06)] hover:bg-[rgba(0,82,255,0.06)] hover:border-[rgba(0,82,255,0.2)] hover:text-mw-brand hover:rotate-180"
              onClick={flip}
              title="Flip tokens"
            >
              ↕
            </button>
          </div>

          {/* You receive */}
          <div className="bg-[rgba(26,26,46,0.03)] border border-[rgba(26,26,46,0.08)] rounded-md p-[14px] transition-colors duration-150 focus-within:border-[rgba(0,82,255,0.3)]">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] text-mw-ink-4 font-sans">You receive</span>
            </div>
            <div className="flex items-center gap-[10px]">
              <span className={`flex-1 font-mono text-[22px] font-semibold text-mw-ink overflow-hidden text-ellipsis whitespace-nowrap${isQuoting ? ' text-[#C4C5D0] animate-[blink_1s_step-end_infinite]' : ''}`}>
                {isQuoting ? '…' : buyAmount ? fmt(buyAmount) : <span className="text-[#C4C5D0]">0</span>}
              </span>
              <button
                className={`inline-flex items-center gap-[6px] px-[12px] py-[7px] rounded-sm border-0 cursor-pointer font-sans text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0${buyToken ? ' bg-[rgba(26,26,46,0.07)] text-mw-ink hover:bg-[rgba(26,26,46,0.12)]' : ' bg-mw-ink text-white hover:bg-[#2d2d48]'}`}
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

          {/* Price info */}
          {quote && sellToken && buyToken && !isQuoting && (
            <div className="flex items-center justify-between my-[4px] mb-[8px] font-mono text-[12px] text-mw-ink-4">
              <span>1 {sellToken.symbol} ≈ {parseFloat(quote.price).toFixed(6)} {buyToken.symbol}</span>
              {priceImpact !== null && (
                <span className={priceImpact > 2 ? 'text-[#dc2626]' : 'text-mw-ink-4'}>
                  Impact: {priceImpact.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Errors */}
          {quoteError === 'CORE_COMING_SOON' && (
            <div className="my-[8px] px-[14px] py-[10px] rounded-[10px] bg-[rgba(0,82,255,0.06)] border border-[rgba(0,82,255,0.15)] font-sans text-[13px] text-mw-brand text-center">
              🚧 Core swaps coming soon — Molten router deploying shortly
            </div>
          )}
          {quoteError && quoteError !== 'CORE_COMING_SOON' && (
            <div className="my-[8px] px-[14px] py-[10px] rounded-[10px] bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.18)] font-sans text-[13px] text-[#dc2626]">
              ⚠ {quoteError}
            </div>
          )}
          {swapError && !isSwapping && status === 'error' && (
            <div className="my-[8px] px-[14px] py-[10px] rounded-[10px] bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.18)] font-sans text-[13px] text-[#dc2626]">
              ⚠ {swapError}
            </div>
          )}

          {/* High price impact warning */}
          {highImpactWarning && (
            <div className="my-[6px] px-[12px] py-[8px] rounded-sm bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.2)] font-sans text-[12px] text-[#ca8a04]">
              ⚠ High price impact ({priceImpact?.toFixed(1)}%) — consider a smaller trade
            </div>
          )}

          {/* Reward preview */}
          <RewardPreview
            campaign={campaign}
            sellAmountUSD={sellAmountUSD}
            feeBps={chainConfig?.feeBps ?? 10}
            feeTokenSymbol={buyToken?.symbol ?? ''}
            feeAmountUSD={feeAmountUSD}
            isLoading={isQuoting}
          />

          {/* Attribution score preview */}
          <AttributionScorePreview estimatedScoreGain={estimatedScoreGain} />

          {/* Action button */}
          <button
            className={`w-full py-[14px] rounded-md border-0 cursor-pointer font-sans text-[15px] font-bold transition-[background,transform] duration-150 mt-[12px] hover:not-disabled:-translate-y-[1px] disabled:cursor-not-allowed disabled:translate-y-0${quoteError === 'CORE_COMING_SOON' ? ' bg-[rgba(0,82,255,0.12)] text-mw-brand' : ' bg-mw-brand text-white hover:not-disabled:bg-[#0040cc] disabled:bg-[rgba(26,26,46,0.12)] disabled:text-mw-ink-4'}`}
            disabled={isActionDisabled()}
            onClick={handleSwap}
          >
            {getActionLabel()}
          </button>
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

      {/* Post-swap summary */}
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
            reset()
            setSellAmount('')
          }}
        />
      )}
    </>
  )
}
