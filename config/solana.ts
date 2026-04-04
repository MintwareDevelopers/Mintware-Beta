// =============================================================================
// config/solana.ts
//
// Shared Solana config for client and server paths.
//
// Goals:
//   - Centralize RPC defaults instead of hardcoding them in components/routes
//   - Keep wallet-link messages consistent between client and verifier flows
// =============================================================================

const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

export const SOLANA_CLIENT_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC

export const SOLANA_SERVER_RPC_URL =
  process.env.SOLANA_RPC_URL?.trim() ||
  process.env.SOLANA_RPC_FALLBACK_URL?.trim() ||
  DEFAULT_SOLANA_RPC

export function buildSolanaWalletLinkMessage(evmAddress: string, timestamp: number): string {
  return `Link wallet to Mintware: evm=${evmAddress.toLowerCase()} ts=${timestamp}`
}
