'use client'

import { useState, useEffect, useRef } from 'react'
import { useChainId } from 'wagmi'
import { getChainConfig } from '@/config/chains'
import { getQuote as getLifiQuote } from '@/lib/web2/providers/lifi'
import { fetchBestRoute, type MwInternalQuote } from '@/lib/web2/providers/mwInternal'
import type { Token } from '@/config/tokens'
import type { LifiQuote } from '@/lib/web2/providers/lifi'

export type Quote = LifiQuote | MwInternalQuote

interface QuoteState {
  quote: Quote | null
  buyAmount: string
  priceImpact: number | null
  isLoading: boolean
  error: string | null
  highImpactWarning: boolean
}

interface UseQuoteParams {
  sellToken: Token | null
  buyToken: Token | null
  sellAmount: string // raw decimal string e.g. "1.5"
  taker: string
  feeRecipient?: string
  feeBps?: number
  campaignId?: string | null
  referrer?: string | null
  enabled?: boolean
}

const DEBOUNCE_MS = 500

export function useQuote(params: UseQuoteParams): QuoteState {
  const chainId = useChainId()
  const [state, setState] = useState<QuoteState>({
    quote: null,
    buyAmount: '',
    priceImpact: null,
    isLoading: false,
    error: null,
    highImpactWarning: false,
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { sellToken, buyToken, sellAmount, taker, feeRecipient, feeBps, campaignId, referrer, enabled = true } = params

  useEffect(() => {
    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current)

    // Reset if inputs invalid
    if (
      !enabled ||
      !sellToken ||
      !buyToken ||
      !sellAmount ||
      parseFloat(sellAmount) <= 0 ||
      !taker ||
      sellToken.address === buyToken.address
    ) {
      setState({
        quote: null,
        buyAmount: '',
        priceImpact: null,
        isLoading: false,
        error: null,
        highImpactWarning: false,
      })
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    timerRef.current = setTimeout(async () => {
      // Cancel previous in-flight request
      abortRef.current?.abort()
      abortRef.current = new AbortController()

      try {
        const chainConfig = getChainConfig(chainId)
        if (!chainConfig) {
          throw new Error('Unsupported chain — please switch to Ethereum, Base, or Arbitrum')
        }

        // Convert decimal amount to wei
        const sellAmountWei = toWei(sellAmount, sellToken.decimals)

        const lifiQuote = await getLifiQuote({
          chainId,
          sellToken:  sellToken.address,
          buyToken:   buyToken.address,
          sellAmount: sellAmountWei,
          taker,
          feeBps:     feeBps ?? chainConfig.feeBps,
          campaignId: campaignId ?? undefined,
          referrer:   referrer   ?? undefined,
        })
        let quote: Quote = lifiQuote

        // ── MW meta-router augmentation (flag-gated, best-effort) ──────────
        // Ask whether a Mintware V4 pool beats LI.FI for this pair. Any failure
        // or non-internal winner leaves the LI.FI quote untouched. Inert until
        // the router is deployed + a pool is listed. See lib/web2/router.
        try {
          const internal = await fetchBestRoute({
            chainId,
            tokenIn:          sellToken.address,
            tokenOut:         buyToken.address,
            amountInWei:      sellAmountWei,
            buyTokenDecimals: buyToken.decimals,
            lifiBuyAmount:    lifiQuote.buyAmount,
            lifiGasCostUsd:   lifiQuote.gasCostUSD ? Number(lifiQuote.gasCostUSD) : null,
            fromAmountUsd:    lifiQuote.fromAmountUSD ? Number(lifiQuote.fromAmountUSD) : null,
            signal:           abortRef.current?.signal,
          })
          if (internal) quote = internal
        } catch { /* keep LI.FI */ }

        const buyAmountDecimal = fromWei(quote.buyAmount, buyToken.decimals)

        // Price impact: LI.FI returns price='0' so impact will be null (no warning shown)
        const impact = estimatePriceImpact(
          parseFloat(sellAmount),
          parseFloat(buyAmountDecimal),
          parseFloat(quote.price)
        )

        setState({
          quote,
          buyAmount: buyAmountDecimal,
          priceImpact: impact,
          isLoading: false,
          error: null,
          highImpactWarning: impact !== null && impact > 2,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Quote failed'
        setState({
          quote: null,
          buyAmount: '',
          priceImpact: null,
          isLoading: false,
          error: msg.includes('insufficient') ? 'Insufficient liquidity for this trade' : msg,
          highImpactWarning: false,
        })
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [chainId, sellToken?.address, buyToken?.address, sellAmount, taker, enabled, feeRecipient, feeBps, campaignId, referrer]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

function toWei(amount: string, decimals: number): string {
  const [whole, frac = ''] = amount.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  const raw = BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0')
  return raw.toString()
}

function fromWei(amount: string, decimals: number): string {
  const big     = BigInt(amount)
  const divisor = BigInt(10 ** decimals)
  const whole   = big / divisor
  const frac    = big % divisor
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

function estimatePriceImpact(
  sellAmt: number,
  buyAmt:  number,
  price:   number
): number | null {
  if (!sellAmt || !buyAmt || !price) return null
  const expected = sellAmt * price
  if (!expected) return null
  return Math.abs(((expected - buyAmt) / expected) * 100)
}
