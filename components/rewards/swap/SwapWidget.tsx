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
      <style>{`
        .mw-swap-wrap { max-width: 440px; margin: 0 auto; width: 100%; }

        /* Card */
        .mw-swap-card {
          background: #fff;
          border-radius: 16px;
          border: 1px solid rgba(26,26,46,0.08);
          box-shadow: 0 4px 24px rgba(26,26,46,0.07);
          padding: 20px;
        }

        /* Header */
        .mw-swap-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .mw-swap-title { font-family: Georgia, serif; font-size: 18px; font-weight: 700; color: #1A1A2E; }
        .mw-swap-header-right { display: flex; align-items: center; gap: 8px; }

        /* Slippage */
        .mw-slippage-bar {
          display: flex; align-items: center; gap: 6px;
          margin-bottom: 14px;
          padding: 8px 12px;
          background: rgba(26,26,46,0.03);
          border: 1px solid rgba(26,26,46,0.07);
          border-radius: 10px;
        }
        .mw-slippage-label { font-size: 12px; color: #8A8C9E; font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; flex-shrink: 0; }
        .mw-slip-btn {
          padding: 4px 10px; border-radius: 7px;
          border: 1px solid transparent;
          background: transparent;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; font-weight: 600; color: #8A8C9E;
          cursor: pointer; transition: all 0.12s;
        }
        .mw-slip-btn:hover { background: rgba(0,82,255,0.07); color: #0052FF; }
        .mw-slip-btn.active { background: rgba(0,82,255,0.12); border-color: rgba(0,82,255,0.25); color: #0052FF; }
        .mw-slip-custom {
          width: 56px; padding: 4px 6px;
          border-radius: 7px; border: 1px solid rgba(26,26,46,0.12);
          background: rgba(26,26,46,0.03);
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; color: #1A1A2E; text-align: center;
          outline: none;
        }
        .mw-slip-custom:focus { border-color: rgba(0,82,255,0.4); }

        /* Token cards */
        .mw-token-card {
          background: rgba(26,26,46,0.03);
          border: 1px solid rgba(26,26,46,0.08);
          border-radius: 12px;
          padding: 14px;
          transition: border-color 0.15s;
        }
        .mw-token-card:focus-within { border-color: rgba(0,82,255,0.3); }
        .mw-token-card-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .mw-token-card-label { font-size: 12px; color: #8A8C9E; font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; }
        .mw-token-card-balance { font-size: 12px; color: #8A8C9E; font-family: var(--font-mono), 'DM Mono', monospace; }
        .mw-token-input-row { display: flex; align-items: center; gap: 10px; }
        .mw-token-amount-input {
          flex: 1;
          background: none; border: none; outline: none;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 22px; font-weight: 600; color: #1A1A2E;
          min-width: 0;
        }
        .mw-token-amount-input::placeholder { color: #C4C5D0; }
        .mw-token-amount-readonly {
          flex: 1;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 22px; font-weight: 600; color: #1A1A2E;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mw-token-amount-readonly.loading { color: #C4C5D0; animation: mw-blink 1s step-end infinite; }
        @keyframes mw-blink { 50%{ opacity: 0.4 } }

        /* Token select button */
        .mw-token-select {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px;
          border-radius: 8px;
          background: #1A1A2E; color: #fff;
          border: none; cursor: pointer;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 600;
          transition: background 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .mw-token-select.has-token { background: rgba(26,26,46,0.07); color: #1A1A2E; }
        .mw-token-select.has-token:hover { background: rgba(26,26,46,0.12); }
        .mw-token-select:not(.has-token):hover { background: #2d2d48; }
        .mw-token-select-icon { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; background: #e2e8f0; }
        .mw-token-select-chevron { font-size: 10px; opacity: 0.6; }

        /* Quick amount buttons */
        .mw-quick-btns { display: flex; gap: 4px; margin-top: 8px; }
        .mw-quick-btn {
          padding: 3px 8px;
          border-radius: 6px;
          background: rgba(26,26,46,0.05);
          border: 1px solid rgba(26,26,46,0.09);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 11px; font-weight: 600; color: #8A8C9E;
          cursor: pointer; transition: all 0.12s;
        }
        .mw-quick-btn:hover { background: rgba(0,82,255,0.08); color: #0052FF; border-color: rgba(0,82,255,0.2); }

        /* Flip button */
        .mw-flip-row { display: flex; align-items: center; justify-content: center; margin: 8px 0; }
        .mw-flip-btn {
          width: 36px; height: 36px; border-radius: 10px;
          background: #fff;
          border: 1px solid rgba(26,26,46,0.12);
          font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s; color: #3A3C52;
          box-shadow: 0 1px 4px rgba(26,26,46,0.06);
        }
        .mw-flip-btn:hover { background: rgba(0,82,255,0.06); border-color: rgba(0,82,255,0.2); color: #0052FF; transform: rotate(180deg); }

        /* Price impact */
        .mw-impact {
          margin: 6px 0;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(234,179,8,0.08);
          border: 1px solid rgba(234,179,8,0.2);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; color: #ca8a04;
        }
        .mw-impact.error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.2); color: #dc2626; }

        /* Error */
        .mw-swap-error {
          margin: 8px 0;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(239,68,68,0.07);
          border: 1px solid rgba(239,68,68,0.18);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; color: #dc2626;
        }
        .mw-coming-soon {
          margin: 8px 0;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(0,82,255,0.06);
          border: 1px solid rgba(0,82,255,0.15);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; color: #0052FF;
          text-align: center;
        }

        /* Action button */
        .mw-swap-btn {
          width: 100%; padding: 14px;
          border-radius: 12px;
          background: #0052FF; color: #fff;
          border: none; cursor: pointer;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 15px; font-weight: 700;
          transition: background 0.15s, transform 0.15s;
          margin-top: 12px;
        }
        .mw-swap-btn:hover:not(:disabled) { background: #0040cc; transform: translateY(-1px); }
        .mw-swap-btn:disabled { background: rgba(26,26,46,0.12); color: #8A8C9E; cursor: not-allowed; transform: none; }
        .mw-swap-btn.coming-soon { background: rgba(0,82,255,0.12); color: #0052FF; }

        /* Price info row */
        .mw-price-info {
          display: flex; align-items: center; justify-content: space-between;
          margin: 4px 0 8px;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; color: #8A8C9E;
        }

        @media (max-width: 480px) {
          .mw-swap-card { padding: 14px; border-radius: 12px; }
          .mw-token-amount-input { font-size: 18px; }
        }
      `}</style>

      <div className="mw-swap-wrap">
        <CampaignBanner campaignId={campaignId} referrer={referrer} campaign={campaign} />

        <div className="mw-swap-card">
          {/* Header */}
          <div className="mw-swap-header">
            <span className="mw-swap-title">Swap</span>
            <div className="mw-swap-header-right">
              <ChainSelector />
            </div>
          </div>

          {/* Slippage bar */}
          <div className="mw-slippage-bar">
            <span className="mw-slippage-label">Slippage:</span>
            {SLIPPAGE_PRESETS.map(p => (
              <button
                key={p}
                className={`mw-slip-btn${!customSlippage && slippage === p ? ' active' : ''}`}
                onClick={() => { setSlippage(p); setCustomSlippage('') }}
              >
                {p}%
              </button>
            ))}
            <input
              className="mw-slip-custom"
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
          <div className="mw-token-card">
            <div className="mw-token-card-header">
              <span className="mw-token-card-label">You pay</span>
              {balanceFormatted && sellToken && (
                <span className="mw-token-card-balance">
                  Balance: {balanceFormatted} {sellToken.symbol}
                </span>
              )}
            </div>
            <div className="mw-token-input-row">
              <input
                className="mw-token-amount-input"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={sellAmount}
                onChange={e => setSellAmount(e.target.value)}
              />
              <button
                className={`mw-token-select${sellToken ? ' has-token' : ''}`}
                onClick={() => setShowSellSelector(true)}
              >
                {sellToken?.logoURI && (
                  <img
                    src={sellToken.logoURI}
                    alt={sellToken.symbol}
                    className="mw-token-select-icon"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {sellToken ? sellToken.symbol : 'Select token'}
                <span className="mw-token-select-chevron">▾</span>
              </button>
            </div>
            {balanceFormatted && (
              <div className="mw-quick-btns">
                {[['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['MAX', 1]].map(([label, pct]) => (
                  <button key={label as string} className="mw-quick-btn" onClick={() => setPercent(pct as number)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip */}
          <div className="mw-flip-row">
            <button className="mw-flip-btn" onClick={flip} title="Flip tokens">
              ↕
            </button>
          </div>

          {/* You receive */}
          <div className="mw-token-card">
            <div className="mw-token-card-header">
              <span className="mw-token-card-label">You receive</span>
            </div>
            <div className="mw-token-input-row">
              <span className={`mw-token-amount-readonly${isQuoting ? ' loading' : ''}`}>
                {isQuoting ? '…' : buyAmount ? fmt(buyAmount) : <span style={{ color: '#C4C5D0' }}>0</span>}
              </span>
              <button
                className={`mw-token-select${buyToken ? ' has-token' : ''}`}
                onClick={() => setShowBuySelector(true)}
              >
                {buyToken?.logoURI && (
                  <img
                    src={buyToken.logoURI}
                    alt={buyToken.symbol}
                    className="mw-token-select-icon"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {buyToken ? buyToken.symbol : 'Select token'}
                <span className="mw-token-select-chevron">▾</span>
              </button>
            </div>
          </div>

          {/* Price info */}
          {quote && sellToken && buyToken && !isQuoting && (
            <div className="mw-price-info">
              <span>1 {sellToken.symbol} ≈ {parseFloat(quote.price).toFixed(6)} {buyToken.symbol}</span>
              {priceImpact !== null && (
                <span style={{ color: priceImpact > 2 ? '#dc2626' : '#8A8C9E' }}>
                  Impact: {priceImpact.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Errors */}
          {quoteError === 'CORE_COMING_SOON' && (
            <div className="mw-coming-soon">
              🚧 Core swaps coming soon — Molten router deploying shortly
            </div>
          )}
          {quoteError && quoteError !== 'CORE_COMING_SOON' && (
            <div className="mw-swap-error">⚠ {quoteError}</div>
          )}
          {swapError && !isSwapping && status === 'error' && (
            <div className="mw-swap-error">⚠ {swapError}</div>
          )}

          {/* High price impact warning */}
          {highImpactWarning && (
            <div className="mw-impact">
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
            className={`mw-swap-btn${quoteError === 'CORE_COMING_SOON' ? ' coming-soon' : ''}`}
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
