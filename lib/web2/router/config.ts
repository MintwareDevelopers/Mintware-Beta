// =============================================================================
// lib/web2/router/config.ts — runtime gating for the MW meta-router
//
// The router is OFF by default. With the flag unset, resolveSwapRoute short-
// circuits before any listing/quoting work and the swap flow is byte-for-byte
// the current LI.FI-only behavior. Flip NEXT_PUBLIC_MW_ROUTER_ENABLED=true only
// once Track 0 has listed pools + Slice 2 has deployed MWRouter — see
// docs/developers/phase3-router-design.md §6, §10.
// =============================================================================

import { ROUTER_FEE_BPS_DEFAULT, normalizeRouterFeeBps } from './fee'

/** Master kill switch. Unset/anything-but-"true" → router disabled → pure LI.FI. */
export function isRouterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true'
}

/** Active router fee (bps), env-overridable, always clamped to the hard cap. */
export function routerFeeBps(): number {
  const raw = Number(process.env.NEXT_PUBLIC_MW_ROUTER_FEE_BPS)
  return normalizeRouterFeeBps(Number.isFinite(raw) ? raw : ROUTER_FEE_BPS_DEFAULT)
}

/** Optional extra margin (bps) internal must beat LI.FI by. Default 0 (strict >). */
export function routerMinMarginBps(): number {
  const raw = Number(process.env.NEXT_PUBLIC_MW_ROUTER_MIN_MARGIN_BPS)
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.floor(raw)
}

/** Deployed on-chain addresses needed to quote + execute an internal swap. */
export interface OnchainRouterConfig {
  /** MWRouter address (execution target). */
  router: string
  /** V4Quoter lens address (pricing). */
  quoter: string
  /** RPC endpoint for the chain (server-only). */
  rpcUrl: string
}

/**
 * Resolve the deployed router/quoter/RPC for a chain from server env. Returns null
 * (→ router falls through to LI.FI) until all three are set — so a half-configured
 * chain can never route internally. Server-only (reads non-public env).
 */
export function onchainRouterConfig(chainId: number): OnchainRouterConfig | null {
  const table: Record<number, { r?: string; q?: string; rpc?: string }> = {
    8453: {
      r:   process.env.MW_ROUTER_ADDRESS_BASE,
      q:   process.env.MW_V4_QUOTER_BASE,
      rpc: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    },
    84532: {
      r:   process.env.MW_ROUTER_ADDRESS_BASE_SEPOLIA,
      q:   process.env.MW_V4_QUOTER_BASE_SEPOLIA,
      rpc: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    },
  }
  const c = table[chainId]
  if (!c || !c.r || !c.q || !c.rpc) return null
  return { router: c.r, quoter: c.q, rpcUrl: c.rpc }
}
