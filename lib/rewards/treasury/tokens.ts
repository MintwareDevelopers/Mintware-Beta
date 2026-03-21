// =============================================================================
// lib/treasury/tokens.ts — Base chain token list for treasury sweeps
//
// These are the tokens most likely to accumulate in the Mintware treasury
// from LI.FI integrator fees (0.5% of sell-side token on every swap).
//
// To add a new token: append to BASE_TOKENS with the correct decimals.
// All addresses are checksummed — verify on basescan.org before adding.
// =============================================================================

export interface BaseToken {
  symbol:   string
  address:  string  // checksummed ERC-20 address
  decimals: number
}

// ---------------------------------------------------------------------------
// Top ERC-20 tokens on Base by volume. These are the most likely to arrive
// as LI.FI fee output given common swap pairs.
// ---------------------------------------------------------------------------
export const BASE_TOKENS: readonly BaseToken[] = [
  { symbol: 'USDC',  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  },
  { symbol: 'USDT',  address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6  },
  { symbol: 'DAI',   address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
  { symbol: 'WETH',  address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8  },
  { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
  { symbol: 'AERO',  address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
  { symbol: 'BRETT', address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', decimals: 18 },
  { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
  { symbol: 'WELL',  address: '0xA88594D404727625A9437C3f886C7643872296AE', decimals: 18 },
  { symbol: 'TOSHI', address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', decimals: 18 },
]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Native ETH identifier used by the 0x API as buyToken */
export const ETH_BUY_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/** Uniswap Permit2 — same address across all EVM chains */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/** Skip tokens whose USD value is below this threshold (avoids wasted gas) */
export const DUST_THRESHOLD_USD = 1.0
