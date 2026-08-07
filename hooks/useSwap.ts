'use client'

import { useState } from 'react'
import { useChainId, useWalletClient, usePublicClient } from 'wagmi'
import { getChainConfig } from '@/config/chains'
import { executeSwap as executeLifi } from '@/lib/web2/providers/lifi'
import type { LifiQuote } from '@/lib/web2/providers/lifi'
import type { Quote } from './useQuote'
import type { Token } from '@/config/tokens'

type SwapStatus = 'idle' | 'approving' | 'swapping' | 'success' | 'error'

interface SwapState {
  status:      SwapStatus
  txHash:      `0x${string}` | null
  error:       string | null
  isLoading:   boolean
  executeSwap: (args: ExecuteArgs) => Promise<void>
  reset:       () => void
}

interface ExecuteArgs {
  quote:       Quote
  sellToken:   Token
  buyToken:    Token
  sellAmount:  string
  campaignId?: string | null
  referrer?:   string | null
}

export function useSwap(): SwapState {
  const chainId                = useChainId()
  const { data: walletClient } = useWalletClient()
  const publicClient           = usePublicClient()

  const [status,  setStatus]  = useState<SwapStatus>('idle')
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const reset = () => {
    setStatus('idle')
    setTxHash(null)
    setError(null)
  }

  const executeSwap = async (args: ExecuteArgs) => {
    if (!walletClient) {
      setError('Wallet not connected')
      return
    }
    if (!publicClient) {
      setError('Network client unavailable')
      return
    }

    const chainConfig = getChainConfig(chainId)
    if (!chainConfig) {
      setError('Unsupported chain')
      return
    }

    setError(null)
    setStatus('swapping')

    try {
      // LI.FI — quote contains the signed transaction envelope from the aggregator
      const lifiQuote = args.quote as LifiQuote
      await publicClient.call({
        account: walletClient.account.address,
        to:      lifiQuote._txReq.to as `0x${string}`,
        data:    lifiQuote._txReq.data as `0x${string}`,
        value:   BigInt(lifiQuote._txReq.value ?? '0x0'),
      })
      const hash: `0x${string}` = await executeLifi(lifiQuote, walletClient)

      setTxHash(hash)
      setStatus('success')

      // ── Credit campaign points (fire-and-forget, non-fatal) ───────────────
      // Parse USD value from the LI.FI quote.
      // Falls back to 0.01 if the field is absent so the webhook never rejects.
      const amountUsd =
        parseFloat((args.quote as LifiQuote).fromAmountUSD ?? '0') || 0.01

      void fetch('/api/campaigns/swap-event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet:      walletClient.account.address.toLowerCase(),
          tx_hash:     hash,
          chain:       chainConfig.name.toLowerCase(),
          token_in:    args.sellToken.address,
          token_out:   args.buyToken.address,
          amount_usd:  amountUsd,
          timestamp:   new Date().toISOString(),
          campaign_id: args.campaignId  ?? undefined,
          is_bridge:   false,
        }),
      }).catch(() => { /* non-fatal — swap succeeded even if points don't credit */ })

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Swap failed'
      setError(msg.includes('execution reverted') ? 'This route is no longer valid. Refresh the quote and try again.' : msg)
      setStatus('error')
    }
  }

  return {
    status,
    txHash,
    error,
    isLoading:   status === 'swapping' || status === 'approving',
    executeSwap,
    reset,
  }
}
