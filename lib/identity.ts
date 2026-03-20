// =============================================================================
// lib/identity.ts
//
// Basename resolution for wallet addresses on Base L2.
//
// Basenames are the Base Name Service (BNS) — ENS-compatible names with a
// .base TLD, resolved through Base's L2 universal resolver.
//
// Usage:
//   import { resolveBasename } from '@/lib/identity'
//   const name = await resolveBasename('0x3F9A...')  // "jake.base" or null
//
// Notes:
//   - Uses viem (already a project dependency) — no new packages required
//   - Module-level singletons: one client, one cache
//   - Always returns null on failure — never throws
//   - Safe to call from both client components and server-side code
// =============================================================================

import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

// ---------------------------------------------------------------------------
// Base L2 Universal Resolver
// Resolves .base names on the Base L2 chain
// ---------------------------------------------------------------------------
const BASE_L2_UNIVERSAL_RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as const

// ---------------------------------------------------------------------------
// Module-level client — singleton, avoids creating a new HTTP client per call
// ---------------------------------------------------------------------------
const baseClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
})

// ---------------------------------------------------------------------------
// In-memory cache — prevents duplicate RPC calls for the same address
// (especially useful in the leaderboard which resolves 10–100 addresses)
// ---------------------------------------------------------------------------
const basenameCache = new Map<string, string | null>()

// ---------------------------------------------------------------------------
// resolveBasename
//
// Resolves a wallet address to its Basename if one exists.
// Returns "jake.base" or null. Never throws.
//
// @param address  Checksummed or lowercased 0x address
// @returns        Basename string (e.g. "jake.base") or null
// ---------------------------------------------------------------------------
export async function resolveBasename(address: string): Promise<string | null> {
  const normalized = address.toLowerCase()

  if (basenameCache.has(normalized)) {
    return basenameCache.get(normalized) ?? null
  }

  try {
    const name = await baseClient.getEnsName({
      address:                  address as `0x${string}`,
      universalResolverAddress: BASE_L2_UNIVERSAL_RESOLVER,
    })
    basenameCache.set(normalized, name ?? null)
    return name ?? null
  } catch {
    // RPC failure, resolver not found, or no name registered — all silently null
    basenameCache.set(normalized, null)
    return null
  }
}

// ---------------------------------------------------------------------------
// extractBasenameHandle
//
// Given a full Basename like "jake.base", returns the handle "jake".
// Used for building ref codes from Basenames.
//
// @param basename  Full Basename string (e.g. "jake.base")
// @returns         Handle before the first dot (e.g. "jake")
// ---------------------------------------------------------------------------
export function extractBasenameHandle(basename: string): string {
  const dotIdx = basename.indexOf('.')
  return dotIdx > 0 ? basename.slice(0, dotIdx) : basename
}
