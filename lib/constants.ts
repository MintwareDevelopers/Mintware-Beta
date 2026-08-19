// =============================================================================
// lib/constants.ts — Single source of truth for all shared constants
//
// Rules:
//   - Never hardcode these values in routes or lib files — import from here
//   - Env vars are read once at module load (server-side only)
//   - Add new constants here; do not scatter them across route handlers
// =============================================================================

// ---------------------------------------------------------------------------
// External APIs
// ---------------------------------------------------------------------------

// Single source of truth for the Attribution worker URL lives in lib/web2/api.ts.
export { API as ATTRIBUTION_API } from './web2/api'

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

export const TREASURY_ADDRESS = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()

// ---------------------------------------------------------------------------
// LI.FI — Known router addresses for on-chain tx verification
//
// Any swap tx routed through an address NOT in this set will be rejected
// as ineligible for rewards. Keep in sync with LI.FI deployments:
// https://github.com/lifinance/contracts/blob/main/deployments/
// ---------------------------------------------------------------------------

export const LIFI_ROUTERS: ReadonlySet<string> = new Set([
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LI.FI Diamond (EVM) — primary
  '0x341e94069f53234fe6dabef707ad424830525715', // LI.FI Diamond v2 (Base, BNB)
  '0xde1e598b81620773454588b85d6b5d4eec32573e', // LI.FI relayer (cross-chain)
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch v5 (used by LI.FI DEX aggregation)
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter (LI.FI DEX step)
])

// ---------------------------------------------------------------------------
// Chain RPC URLs
//
// chainRpc.ts owns the full RPC client abstraction (eth_getLogs, batching, etc.)
// This map is the canonical env-var → URL lookup for simple RPC calls.
// ---------------------------------------------------------------------------

export const CHAIN_RPC: Record<string, string> = {
  base:         process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org',
  base_sepolia: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
  bnb:          process.env.BNB_RPC_URL          ?? 'https://bsc-dataseed.binance.org',
}

// ---------------------------------------------------------------------------
// MintwareDistributor contract addresses by chain ID
// ---------------------------------------------------------------------------

export const DISTRIBUTOR_ADDRESSES: Record<number, string> = {
  8453:  process.env.NEXT_PUBLIC_MW_TREASURY_ADDRESS ?? '', // Base mainnet
  84532: '',                                                // Base Sepolia
  56:    '',                                                // BNB Chain
}

// Human-readable chain labels
export const CHAIN_LABELS: Record<number, string> = {
  8453:  'Base',
  84532: 'Base Sepolia',
  56:    'BNB Chain',
}

// ---------------------------------------------------------------------------
// Auth secrets
// ---------------------------------------------------------------------------

export const CRON_SECRET                 = process.env.CRON_SECRET                  ?? ''
// Dedicated secret for the privileged (admin)/oracle deploy/rotation routes, so a leaked
// CRON_SECRET can no longer authorize contract deploys or oracle rotation. Fails CLOSED
// when unset (routes 500 in prod) — set ADMIN_SECRET in Vercel to use those routes.
export const ADMIN_SECRET                = process.env.ADMIN_SECRET                 ?? ''
export const CLAIM_MARK_SECRET           = process.env.CLAIM_MARK_SECRET            ?? ''
export const SWAP_WEBHOOK_SECRET         = process.env.SWAP_WEBHOOK_SECRET          ?? ''
export const TRADE_SIGNAL_INGEST_SECRET  = process.env.TRADE_SIGNAL_INGEST_SECRET   ?? ''
export const AI_ATTRIBUTION_ORACLE_SECRET = process.env.AI_ATTRIBUTION_ORACLE_SECRET ?? ''

// ---------------------------------------------------------------------------
// BigInt-safe JSON serialization
//
// JSON.stringify() throws on BigInt values. Use toJsonSafe() before any
// NextResponse.json() call that may contain on-chain amounts or block numbers.
// Routehandler.ctx.json() applies this automatically — prefer that over
// calling NextResponse.json() directly.
// ---------------------------------------------------------------------------

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as T
}
