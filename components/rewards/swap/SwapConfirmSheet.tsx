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
    <div className="flex items-center justify-between gap-3 py-[7px]">
      <span className="text-[13px] text-ink-mid">{label}</span>
      <span className={`text-[13px] text-ink font-geist-mono text-right ${valueClass}`}>{value}</span>
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
      className="fixed inset-0 z-[1000] bg-[rgba(21,21,29,.32)] backdrop-blur-[6px] flex items-center justify-center p-[16px] font-geist"
      onClick={(e) => { if (e.target === e.currentTarget && !isSwapping) onCancel() }}
    >
      <div className="mw-raise-lg rounded-[26px] w-full max-w-[400px] overflow-hidden">

        {/* Header */}
        <div className="px-[24px] pt-[24px] pb-[18px]" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <div className="text-[19px] font-semibold text-ink leading-none mb-[6px] tracking-[-0.02em]">Review swap</div>
          <div className="text-[13px] text-ink-mid">Check the details before your wallet opens</div>
        </div>

        {/* Token flow */}
        <div className="px-[24px] pt-[20px] pb-[4px]">

          {/* Sell row */}
          <div className="flex items-center justify-between rounded-[16px] px-[14px] py-[12px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
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
                <div className="text-[12px] text-ink-soft leading-none mb-[4px]">You send</div>
                <div className="text-[16px] text-ink font-geist-mono leading-none">{sellDisplay} {sellToken.symbol}</div>
              </div>
            </div>
            {sellAmountUSD && (
              <span className="text-[13px] text-ink-mid font-geist-mono">${parseFloat(sellAmountUSD).toFixed(2)}</span>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center my-[6px]" style={{ color: 'var(--mw-ink-3)' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg></div>

          {/* Buy row */}
          <div className="flex items-center justify-between rounded-[16px] px-[14px] py-[12px] bg-white" style={{ boxShadow: 'var(--mw-raise-sm)' }}>
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
                <div className="text-[12px] text-ink-soft leading-none mb-[4px]">You receive (estimate)</div>
                <div className="text-[16px] font-geist-mono leading-none" style={{ color: 'var(--mw-gain)' }}>~{buyDisplay} {buyToken.symbol}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-[24px] pt-[16px] pb-[4px] flex flex-col">
          <div className="pt-[10px]" style={{ borderTop: '1px solid var(--mw-line)' }}>
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
                valueClass={priceImpact > 2 ? '!text-[#B42318]' : ''}
              />
            )}
            <Row label="Route" value="LI.FI aggregator" valueClass="!text-ink-mid" />
          </div>
        </div>

        {/* Warnings */}
        {highImpact && (
          <div className="mx-[24px] mt-[12px] px-[14px] py-[11px] rounded-[14px]" style={{ background: '#FDF1EF', boxShadow: 'inset 0 0 0 1px rgba(180,35,24,.18)' }}>
            <p className="text-[13px] text-[#B42318] m-0 leading-[1.45]">
              High price impact ({priceImpact?.toFixed(1)}%) — you may receive significantly less than expected.
            </p>
          </div>
        )}

        {/* Plain-language explanation */}
        <div className="mx-[24px] mt-[12px] px-[14px] py-[11px] rounded-[14px]" style={{ background: 'var(--mw-band)' }}>
          <p className="text-[13px] text-ink-mid leading-[1.5] m-0">
            Your wallet will open to confirm this swap. The amounts shown are estimates —
            final amounts may differ slightly due to market movement. You can cancel at any time.
          </p>
        </div>

        {showWalletHint && (
          <div className="mx-[24px] mt-[12px] px-[14px] py-[11px] rounded-[14px]" style={{ background: '#FDF1EF', boxShadow: 'inset 0 0 0 1px rgba(180,35,24,.18)' }}>
            <p className="text-[13px] text-[#B42318] leading-[1.5] m-0">
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
            className={`w-full !min-h-[52px] !rounded-[14px] text-[15px] disabled:cursor-not-allowed ${
              isSwapping ? 'mw-btn-quiet !text-ink-soft' : 'mw-btn'
            }`}
          >
            {isSwapping ? 'Waiting for wallet…' : 'Open wallet to confirm →'}
          </button>
          <button
            onClick={onCancel}
            className="mw-btn-quiet w-full !rounded-[14px] text-[14px] !text-ink-mid"
          >
            {isSwapping ? 'Close this panel' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
