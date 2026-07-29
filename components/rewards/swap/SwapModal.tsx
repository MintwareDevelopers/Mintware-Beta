'use client'

// =============================================================================
// SwapModal.tsx — in-page swap popup with the campaign asset pre-selected.
// Wraps the existing SwapWidget (unchanged funds path) in an overlay so a user
// can trade a campaign's token without being redirected to an empty /swap page.
// Campaign context is set on sessionStorage so useCampaign() credits the swap.
// =============================================================================

import { useEffect } from 'react'
import { SwapWidget } from './SwapWidget'

interface SwapModalProps {
  open: boolean
  onClose: () => void
  tokenContract?: string
  chainId?: number
  symbol?: string
  campaignId?: string
  campaignName?: string
}

export function SwapModal({ open, onClose, tokenContract, chainId, symbol, campaignId, campaignName }: SwapModalProps) {
  // Campaign context for reward crediting — useCampaign() reads mw_campaign_id.
  useEffect(() => {
    if (!open || !campaignId) return
    const prev = sessionStorage.getItem('mw_campaign_id')
    sessionStorage.setItem('mw_campaign_id', campaignId)
    return () => {
      if (prev) sessionStorage.setItem('mw_campaign_id', prev)
      else sessionStorage.removeItem('mw_campaign_id')
    }
  }, [open, campaignId])

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const preselectBuy = tokenContract && chainId ? { address: tokenContract, chainId, symbol } : undefined

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-atx-ink/40 backdrop-blur-[3px] py-[6vh] px-4 font-atx-display [&_*]:rounded-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[480px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-atx-mono uppercase tracking-[0.12em] text-[11px] text-white">
            {campaignName ? `Trade · ${campaignName}` : 'Trade'}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center border border-atx-ink bg-atx-bone text-atx-ink text-[15px] cursor-pointer transition-colors duration-150 hover:bg-atx-blue hover:text-white hover:border-atx-blue"
          >
            ✕
          </button>
        </div>
        <SwapWidget preselectBuy={preselectBuy} preselectChainId={chainId} />
      </div>
    </div>
  )
}
