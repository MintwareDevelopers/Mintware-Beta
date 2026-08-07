export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  chainId: number
  logoURI?: string
}

// Common tokens pinned at top per chain
export const COMMON_TOKENS: Record<number, string[]> = {
  1: ['ETH', 'USDC', 'USDT', 'WBTC', 'DAI'],
  8453: ['ETH', 'USDC', 'cbETH', 'cbBTC'],
}

// Uniswap default token list URL for ETH and Base.
// Use the canonical host (clean 200 + CORS) — the ipfs.io gateway 301-redirects
// to a target without CORS headers, which fails the browser fetch.
export const UNISWAP_TOKEN_LIST_URL =
  'https://tokens.uniswap.org'

// Native token placeholder addresses
export const NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export function getNativeToken(chainId: number): Token {
  const symbols: Record<number, { symbol: string; name: string }> = {
    1: { symbol: 'ETH', name: 'Ethereum' },
    8453: { symbol: 'ETH', name: 'Ethereum' },
  }
  const info = symbols[chainId] ?? { symbol: 'ETH', name: 'Ethereum' }
  return {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: info.symbol,
    name: info.name,
    decimals: 18,
    chainId,
    logoURI: '/chains/eth.svg',
  }
}
