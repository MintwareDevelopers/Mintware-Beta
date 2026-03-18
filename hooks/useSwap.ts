'use client'

import { useState } from 'react'
import { useChainId, useWalletClient } from 'wagmi'
import { getChainConfig } from '@/config/chains'
import { executeSwap as executeLifi } from '@/lib/providers/lifi'
import { executeSwap as executeMolten, isMoltenReady } from '@/lib/providers/molten'
import type { LifiQuote } from '@/lib/providers/lifi'
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

    const chainConfig = getChainConfig(chainId)
    if (!chainConfig) {
      setError('Unsupported chain')
      return
    }

    setError(null)
    setStatus('swapping')

    try {
      let hash: `0x${string}`

      if (chainConfig.swapProvider === 'lifi') {
        // LI.FI — quote contains the signed transaction envelope from the aggregator
        hash = await executeLifi(args.quote as LifiQuote, walletClient)
      } else {
        // Molten (Core DAO)
        if (!isMoltenReady()) {
          throw new Error('Core swaps coming soon — Molten router not deployed yet')
        }
        hash = await executeMolten(
          {
            sellToken:  args.sellToken,
            buyToken:   args.buyToken,
            sellAmount: args.sellAmount,
            taker:      walletClient.account.address,
            campaignId: args.campaignId ?? undefined,
            referrer:   args.referrer   ?? undefined,
          },
          walletClient
        )
      }

      setTxHash(hash)
      setStatus('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Swap failed'
      setError(msg)
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
