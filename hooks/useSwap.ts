'use client'

import { useState } from 'react'
import { parseUnits } from 'viem'
import { useChainId, useWalletClient, usePublicClient } from 'wagmi'
import { getChainConfig } from '@/config/chains'
import { executeSwap as executeLifi } from '@/lib/web2/providers/lifi'
import { executeSwap as executeInternal } from '@/lib/web2/providers/mwInternal'
import { createTxToast, type TxToast } from '@/lib/web3/txToast'
import type { LifiQuote } from '@/lib/web2/providers/lifi'
import type { Quote } from './useQuote'
import type { Token } from '@/config/tokens'

// LI.FI represents the chain's native asset with these sentinels — no approval needed.
const NATIVE_SENTINELS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
])
const isNative = (addr: string) => NATIVE_SENTINELS.has(addr.toLowerCase())

const ERC20_ABI = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

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

    // ── Internal (MW meta-router) path ────────────────────────────────────────
    // The quote is an internal Mintware V4-pool route (the router beat LI.FI). It carries its own
    // execution payload; mwInternal.executeSwap handles approve → MWRouter.swapExactInputSingle.
    if ('provider' in args.quote && args.quote.provider === 'mw-internal') {
      const itx = createTxToast({ chainId, label: 'Swap' })
      try {
        setStatus('swapping')
        const hash = await executeInternal(args.quote, walletClient, publicClient)
        itx.submitted(hash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Swap transaction reverted on-chain')
        setTxHash(hash)
        setStatus('success')
        itx.success(hash)
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : 'Swap failed'
        const friendly = raw.includes('execution reverted')
          ? 'This route is no longer valid. Refresh the quote and try again.'
          : raw
        setError(friendly)
        setStatus('error')
        itx.error(friendly)
      }
      return
    }

    // ── LI.FI aggregator path (default) ───────────────────────────────────────
    const lifiQuote = args.quote as LifiQuote
    const owner   = walletClient.account.address
    const spender = lifiQuote._txReq.to as `0x${string}`
    let tx: TxToast | null = null

    try {
      // ── ERC-20 approval (native sells need none) ──────────────────────────
      // The aggregator's transactionRequest assumes the router already has
      // allowance; without this an ERC-20 sell reverts on first use.
      if (!isNative(args.sellToken.address)) {
        const sellWei = parseUnits(args.sellAmount, args.sellToken.decimals)
        const allowance = await publicClient.readContract({
          address: args.sellToken.address as `0x${string}`,
          abi: ERC20_ABI, functionName: 'allowance', args: [owner, spender],
        }) as bigint

        if (allowance < sellWei) {
          setStatus('approving')
          const appr = createTxToast({ chainId, label: `Approve ${args.sellToken.symbol}` })
          try {
            const approveHash = await walletClient.writeContract({
              address: args.sellToken.address as `0x${string}`,
              abi: ERC20_ABI, functionName: 'approve', args: [spender, sellWei],
              account: walletClient.account, chain: walletClient.chain,
            })
            appr.submitted(approveHash)
            const ar = await publicClient.waitForTransactionReceipt({ hash: approveHash })
            if (ar.status !== 'success') throw new Error('Token approval reverted')
            appr.success(approveHash)
          } catch (e) {
            appr.error(e instanceof Error ? e.message : 'Approval failed')
            throw e
          }
        }
      }

      // ── Swap ──────────────────────────────────────────────────────────────
      setStatus('swapping')
      tx = createTxToast({ chainId, label: 'Swap' })
      // Static preflight so an already-doomed route fails before the wallet prompt
      await publicClient.call({
        account: owner,
        to:      spender,
        data:    lifiQuote._txReq.data as `0x${string}`,
        value:   BigInt(lifiQuote._txReq.value ?? '0x0'),
      })
      const hash: `0x${string}` = await executeLifi(lifiQuote, walletClient)
      tx.submitted(hash)

      // Confirm on-chain BEFORE calling it a success — a submitted tx can revert.
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        throw new Error('Swap transaction reverted on-chain')
      }

      setTxHash(hash)
      setStatus('success')
      tx.success(hash)

    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Swap failed'
      const friendly = raw.includes('execution reverted')
        ? 'This route is no longer valid. Refresh the quote and try again.'
        : raw
      setError(friendly)
      setStatus('error')
      tx?.error(friendly)
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
