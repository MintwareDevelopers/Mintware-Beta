'use client'

import { useState, useEffect } from 'react'
import { CORE_TOKENS, UNISWAP_TOKEN_LIST_URL, getNativeToken } from '@/config/tokens'
import type { Token } from '@/config/tokens'

interface TokenListState {
  tokens: Token[]
  isLoading: boolean
  error: string | null
}

// In-memory cache per chainId
const cache: Record<number, Token[]> = {}

export function useTokenList(chainId: number | undefined): TokenListState {
  const [state, setState] = useState<TokenListState>({
    tokens: [],
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    if (!chainId) {
      setState({ tokens: [], isLoading: false, error: null })
      return
    }

    // Core chain — use hardcoded list
    if (chainId === 1116) {
      setState({
        tokens: [getNativeToken(chainId), ...CORE_TOKENS],
        isLoading: false,
        error: null,
      })
      return
    }

    // Return from cache if available
    if (cache[chainId]) {
      setState({ tokens: cache[chainId], isLoading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    fetch(UNISWAP_TOKEN_LIST_URL)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load token list')
        return res.json()
      })
      .then(data => {
        const filtered: Token[] = (data.tokens ?? []).filter(
          (t: Token) => t.chainId === chainId
        )
        // Always prepend native token
        const withNative = [getNativeToken(chainId), ...filtered]
        cache[chainId] = withNative
        setState({ tokens: withNative, isLoading: false, error: null })
      })
      .catch(err => {
        // Fallback: just native token + empty list
        const fallback = [getNativeToken(chainId)]
        setState({ tokens: fallback, isLoading: false, error: err?.message ?? 'Token list unavailable' })
      })
  }, [chainId])

  return state
}
