// =============================================================================
// Admin auth — allowlisted-wallet gate for the RWA review surface.
//
// Browser-safe: the admin connects a wallet and signs a short-lived session
// message (buildAdminMessage); the page sends it as X-Admin-Message /
// X-Admin-Signature headers on every admin request. The server recovers the
// signer and checks it against ADMIN_WALLETS. No server secret ever reaches
// the client.
//
// Dev bypass mirrors MwAuthGuard: in development, admin auth is skipped so the
// surface is usable locally without an allowlist configured.
// =============================================================================

import type { NextRequest } from 'next/server'
import { recoverMessageAddress } from 'viem'

const MAX_AGE_MS = 15 * 60 * 1000

/** Is this wallet an allowlisted admin? Reads ADMIN_WALLETS at call time. */
export function isAdminWallet(addr?: string | null): boolean {
  if (process.env.NODE_ENV === 'development') return true // dev bypass
  if (!addr) return false
  const admins = (process.env.ADMIN_WALLETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(addr.toLowerCase())
}

/**
 * Verify an admin request from its signed-session headers.
 * Returns the admin address (lowercased) or null if unauthorized.
 */
export async function verifyAdmin(req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV === 'development') return 'dev-admin' // dev bypass

  const message = req.headers.get('x-admin-message')
  const signature = req.headers.get('x-admin-signature') as `0x${string}` | null
  if (!message || !signature) return null

  let issuedAt = 0
  try { issuedAt = Number(JSON.parse(message).issuedAt) } catch { return null }
  if (!issuedAt || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) return null

  const signer = await recoverMessageAddress({ message, signature }).catch(() => null)
  if (!signer || !isAdminWallet(signer)) return null
  return signer.toLowerCase()
}
