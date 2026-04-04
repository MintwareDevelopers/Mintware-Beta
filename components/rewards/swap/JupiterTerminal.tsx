'use client'

// =============================================================================
// components/rewards/swap/JupiterTerminal.tsx
//
// Embeds Jupiter Terminal — the hosted Solana swap widget.
//
// On mount: injects the Jupiter Terminal script from the CDN (once), then
// initialises the widget in "integrated" mode inside #jupiter-terminal-container.
//
// onSuccess callback: POSTs the completed swap to /api/campaigns/sol-swap-event
// for campaign point credit.
//
// Props:
//   wallet      — Solana wallet base58 address (fee payer)
//   campaignId  — optional campaign to credit (omit to auto-resolve from participants)
// =============================================================================

import { useEffect, useRef } from 'react'
import { SOLANA_CLIENT_RPC_URL } from '@/config/solana'

interface JupiterTerminalProps {
  wallet:      string
  campaignId?: string
}

// Jupiter Terminal CDN script (pinned to v2 — stable, actively maintained)
const JUPITER_TERMINAL_SCRIPT = 'https://terminal.jup.ag/main-v2.js'
const CONTAINER_ID             = 'jupiter-terminal-container'

// ---------------------------------------------------------------------------
// Jupiter Terminal globals (injected via script tag)
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    Jupiter?: {
      init:  (config: JupiterInitConfig) => void
      close: () => void
    }
  }
}

interface JupiterInitConfig {
  displayMode:          'integrated' | 'modal' | 'widget'
  integratedTargetId:   string
  endpoint:             string
  defaultExplorer?:     'Solana Explorer' | 'Solscan' | 'SolanaFM' | 'XRAY'
  platformFeeAndAccounts?: Record<string, unknown>
  onSuccess?:           (props: JupiterSwapSuccess) => void
  onSwapError?:         (props: JupiterSwapError)   => void
}

interface JupiterSwapSuccess {
  txid:        string
  inputMint:   string
  outputMint:  string
  inAmount:    number
  outAmount:   number
  quoteResponse?: {
    swapUsdValue?: number
    inAmount?:     number
  }
}

interface JupiterSwapError {
  error?:    Error
  quoteResponse?: unknown
}

// ---------------------------------------------------------------------------
// Inject Jupiter Terminal script (idempotent)
// ---------------------------------------------------------------------------
function injectJupiterScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded
    if (window.Jupiter) { resolve(); return }

    const existing = document.getElementById('jupiter-terminal-script')
    if (existing) {
      // Script tag exists but Jupiter not yet available — wait for it
      existing.addEventListener('load',  () => resolve())
      existing.addEventListener('error', (e) => reject(e))
      return
    }

    const script       = document.createElement('script')
    script.id          = 'jupiter-terminal-script'
    script.src         = JUPITER_TERMINAL_SCRIPT
    script.async       = true
    script.crossOrigin = 'anonymous'
    script.onload      = () => resolve()
    script.onerror     = (e) => reject(e)
    document.head.appendChild(script)
  })
}

// ---------------------------------------------------------------------------
// POST completed swap to the sol-swap-event reward route
// ---------------------------------------------------------------------------
async function reportSolSwap(params: {
  tx_signature: string
  wallet:       string
  token_in:     string
  token_out:    string
  amount_usd:   number
  campaign_id?: string
}) {
  try {
    await fetch('/api/campaigns/sol-swap-event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    })
  } catch (err) {
    // Best-effort — don't surface reward errors to the user's swap UI
    console.warn('[JupiterTerminal] Failed to report swap for rewards:', err)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function JupiterTerminal({ wallet, campaignId }: JupiterTerminalProps) {
  const initialisedRef = useRef(false)

  useEffect(() => {
    if (initialisedRef.current) return
    initialisedRef.current = true

    injectJupiterScript()
      .then(() => {
        if (!window.Jupiter) {
          console.error('[JupiterTerminal] window.Jupiter not available after script load')
          return
        }

        window.Jupiter.init({
          displayMode:        'integrated',
          integratedTargetId: CONTAINER_ID,
          endpoint:           SOLANA_CLIENT_RPC_URL,
          defaultExplorer:    'Solscan',

          onSuccess: ({ txid, inputMint, outputMint, inAmount, quoteResponse }) => {
            // Derive USD value — Jupiter provides swapUsdValue in quoteResponse
            const amountUsd =
              quoteResponse?.swapUsdValue ??
              // fallback: treat inAmount as lamports → SOL × $150 rough estimate
              (inAmount / 1e9) * 150

            void reportSolSwap({
              tx_signature: txid,
              wallet,
              token_in:     inputMint,
              token_out:    outputMint,
              amount_usd:   amountUsd,
              campaign_id:  campaignId,
            })
          },

          onSwapError: ({ error }) => {
            if (error) {
              console.warn('[JupiterTerminal] Swap error:', error.message)
            }
          },
        })
      })
      .catch((err) => {
        console.error('[JupiterTerminal] Failed to load Jupiter Terminal script:', err)
      })

    // Cleanup: close Jupiter Terminal when component unmounts
    return () => {
      window.Jupiter?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // Run once on mount — wallet/campaignId captured at first render

  return (
    <div
      id={CONTAINER_ID}
      style={{ width: '100%', minHeight: 480 }}
    />
  )
}
