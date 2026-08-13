'use client'

// =============================================================================
// SwapConfirmSheet.tsx
//
// Pre-wallet confirmation panel. Shown BEFORE the wallet popup opens.
// Displays the full swap summary — tokens, amounts, fees, chain — so the
// user knows exactly what to expect before they confirm in their wallet.
//
// Design principles (per ethereum-ux-adoption-report.md):
//   - Show action verb, asset amounts, expected outcome, chain, network fee
//   - Use plain language ("network fee" not "gas", "give permission" not "approve")
//   - Warn clearly on high price impact
//   - Always give a Cancel path
// =============================================================================

import type { Token } from '@/config/tokens'

interface SwapConfirmSheetProps {
  sellToken:     Token
  buyToken:      Token
  sellAmount:    string        // display decimal, e.g. "1.5"
  buyAmount:     string        // display decimal estimate
  sellAmountUSD: string | null // from quote.fromAmountUSD
  gasCostEth:    string | null // computed: estimatedGas * gasPrice / 1e18
  gasCostUSD:    string | null // from LI.FI estimate.gasCosts[0].amountUSD (preferred display)
  nativeSymbol:  string        // "ETH", "CORE", etc.
  priceImpact:   number | null
  chainName:     string
  feeBps:        number        // e.g. 50 = 0.5%
  highImpact:    boolean
  isSwapping:    boolean
  showWalletHint: boolean
  onConfirm:     () => void
  onCancel:      () => void
}

function Row({ label, value, valueClass = '' }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-[5px]">
      <span className="text-[12px] text-ink-mid">{label}</span>
      <span className={`text-[12px] font-semibold text-ink font-mono ${valueClass}`}>{value}</span>
    </div>
  )
}

export function SwapConfirmSheet({
  sellToken, buyToken, sellAmount, buyAmount, sellAmountUSD,
  gasCostEth, gasCostUSD, nativeSymbol, priceImpact, chainName, feeBps, highImpact,
  isSwapping, showWalletHint, onConfirm, onCancel,
}: SwapConfirmSheetProps) {
  const feeUSD = sellAmountUSD
    ? ((parseFloat(sellAmountUSD) * feeBps) / 10000).toFixed(2)
    : null

  const sellDisplay = (() => {
    const n = parseFloat(sellAmount)
    return isNaN(n) ? sellAmount : n.toFixed(n < 1 ? 6 : n < 100 ? 4 : 2)
  })()

  const buyDisplay = (() => {
    const n = parseFloat(buyAmount)
    return isNaN(n) ? buyAmount : n.toFixed(n < 1 ? 6 : n < 100 ? 4 : 2)
  })()

  return (
    <div
      className="fixed inset-0 z-[1000] bg-ink/40 backdrop-blur-[6px] flex items-center justify-center p-[16px]"
      onClick={(e) => { if (e.target === e.currentTarget && !isSwapping) onCancel() }}
    >
      <div className="bg-white border border-hair rounded-[var(--radius-panel)] w-full max-w-[380px] shadow-lift overflow-hidden">

        {/* Header */}
        <div className="px-[24px] pt-[24px] pb-[18px] border-b border-hair-soft">
          <div className="text-[17px] font-medium text-ink font-atx-display leading-none mb-[4px] tracking-[-0.01em]">Review swap</div>
          <div className="text-[12px] text-ink-mid">Check the details before your wallet opens</div>
        </div>

        {/* Token flow */}
        <div className="px-[24px] pt-[20px] pb-[4px]">

          {/* Sell row */}
          <div className="flex items-center justify-between rounded-xl bg-ground-cool border border-hair px-[14px] py-[12px] mb-[8px]">
            <div className="flex items-center gap-[8px]">
              {sellToken.logoURI && (
                <img
                  src={sellToken.logoURI}
                  alt={sellToken.symbol}
                  className="w-[28px] h-[28px] rounded-full bg-[#e2e8f0]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div>
                <div className="text-[11px] text-ink-soft uppercase tracking-[0.08em] leading-none mb-[2px]">You send</div>
                <div className="text-[15px] font-semibold text-ink font-mono leading-none">{sellDisplay} {sellToken.symbol}</div>
              </div>
            </div>
            {sellAmountUSD && (
              <span className="text-[12px] text-ink-mid font-mono">${parseFloat(sellAmountUSD).toFixed(2)}</span>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center text-ink-soft text-[16px] my-[2px]">↓</div>

          {/* Buy row */}
          <div className="flex items-center justify-between rounded-xl bg-ground-cool border border-hair px-[14px] py-[12px] mt-[8px]">
            <div className="flex items-center gap-[8px]">
              {buyToken.logoURI && (
                <img
                  src={buyToken.logoURI}
                  alt={buyToken.symbol}
                  className="w-[28px] h-[28px] rounded-full bg-[#e2e8f0]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div>
                <div className="text-[11px] text-ink-soft uppercase tracking-[0.08em] leading-none mb-[2px]">You receive (estimate)</div>
                <div className="text-[15px] font-semibold text-coral2-deep font-mono leading-none">~{buyDisplay} {buyToken.symbol}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-[24px] pt-[16px] pb-[4px] flex flex-col">
          <div className="border-t border-hair-soft pt-[12px]">
            {chainName && <Row label="Network" value={chainName} valueClass="font-mono" />}
            <Row
              label="Network fee (estimate)"
              value={
                gasCostUSD
                  ? `~$${gasCostUSD}${gasCostEth ? ` (~${parseFloat(gasCostEth).toFixed(5)} ${nativeSymbol})` : ''}`
                  : gasCostEth
                    ? `~${parseFloat(gasCostEth).toFixed(5)} ${nativeSymbol}`
                    : 'Shown in wallet'
              }
            />
            <Row
              label="Platform fee"
              value={`${feeBps / 100}%${feeUSD ? ` (~$${feeUSD})` : ''}`}
            />
            {priceImpact !== null && (
              <Row
                label="Price impact"
                value={`${priceImpact.toFixed(2)}%`}
                valueClass={priceImpact > 2 ? 'text-[#D14343]' : ''}
              />
            )}
            <Row label="Route" value="LI.FI aggregator" valueClass="font-mono text-ink-mid font-medium" />
          </div>
        </div>

        {/* Warnings */}
        {highImpact && (
          <div className="mx-[24px] mt-[12px] px-[12px] py-[10px] rounded-xl bg-[rgba(209,67,67,0.05)] border border-[rgba(209,67,67,0.3)]">
            <p className="text-[12px] text-[#D14343] m-0 leading-[1.45]">
              High price impact ({priceImpact?.toFixed(1)}%) — you may receive significantly less than expected.
            </p>
          </div>
        )}

        {/* Plain-language explanation */}
        <div className="mx-[24px] mt-[12px] px-[12px] py-[10px] rounded-xl bg-ground-cool border border-hair">
          <p className="text-[11px] text-ink-mid leading-[1.55] m-0">
            Your wallet will open to confirm this swap. The amounts shown are estimates —
            final amounts may differ slightly due to market movement. You can cancel at any time.
          </p>
        </div>

        {showWalletHint && (
          <div className="mx-[24px] mt-[12px] px-[12px] py-[10px] rounded-xl bg-[rgba(209,67,67,0.05)] border border-[rgba(209,67,67,0.3)]">
            <p className="text-[11px] text-[#D14343] leading-[1.55] m-0">
              Still waiting? Check your wallet app or browser extension. If you do not see a prompt,
              open your wallet manually and look for a pending confirmation request.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="px-[24px] pt-[16px] pb-[24px] flex flex-col gap-[8px]">
          <button
            onClick={onConfirm}
            disabled={isSwapping}
            className={`w-full py-[14px] rounded-full text-[15px] font-semibold cursor-pointer disabled:cursor-not-allowed transition-all duration-150 ${
              isSwapping
                ? 'bg-ground-cool text-ink-soft'
                : 'bg-peri text-white hover:bg-peri-deep'
            }`}
          >
            {isSwapping ? 'Waiting for wallet…' : 'Open wallet to confirm →'}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-[10px] rounded-full border border-hair bg-white text-[13px] font-medium text-ink-mid cursor-pointer hover:text-ink hover:border-[rgba(108,108,240,0.4)] transition-all duration-150"
          >
            {isSwapping ? 'Close this panel' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
