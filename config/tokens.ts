export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  chainId: number
  logoURI?: string
}

// Core (chainId: 1116) — hardcoded launch tokens
// ETH native = zero address
export const CORE_TOKENS: Token[] = [
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'CORE',
    name: 'Core',
    decimals: 18,
    chainId: 1116,
    logoURI: '/chains/core.svg',
  },
  // USDT, WBTC, solvBTC, stCORE — populated when contract addresses confirmed
]

// Common tokens pinned at top per chain
export const COMMON_TOKENS: Record<number, string[]> = {
  1: ['ETH', 'USDC', 'USDT', 'WBTC', 'DAI'],
  8453: ['ETH', 'USDC', 'cbETH', 'cbBTC'],
  1116: ['CORE'],
}

// Uniswap default token list URL for ETH and Base
export const UNISWAP_TOKEN_LIST_URL =
  'https://gateway.ipfs.io/ipns/tokens.uniswap.org'

// Native token placeholder addresses
export const NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export function getNativeToken(chainId: number): Token {
  const symbols: Record<number, { symbol: string; name: string }> = {
    1: { symbol: 'ETH', name: 'Ethereum' },
    8453: { symbol: 'ETH', name: 'Ethereum' },
    1116: { symbol: 'CORE', name: 'Core' },
  }
  const info = symbols[chainId] ?? { symbol: 'ETH', name: 'Ethereum' }
  return {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: info.symbol,
    name: info.name,
    decimals: 18,
    chainId,
    logoURI: chainId === 1116 ? '/chains/core.svg' : '/chains/eth.svg',
  }
}
