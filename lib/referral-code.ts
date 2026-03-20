// =============================================================================
// lib/referral-code.ts
//
// Server-side ref code generation for new wallets.
//
// Logic (in order):
//   1. Try to resolve a Base Basename (e.g. "jake.base" → "jake")
//   2. Fallback: base58-encode the 3 bytes from address.slice(2, 8)
//   3. Collision check in wallet_profiles — append "2", "3"... if taken
//   4. Return the unique code (max 32 chars)
//
// Called only from app/api/auth/connect/route.ts on first wallet connect.
// Existing wallets keep their codes — this only runs when ref_code is null.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBasename, extractBasenameHandle } from '@/lib/identity'

// ---------------------------------------------------------------------------
// Base58 encoder — no dependency needed, implemented inline (~20 lines)
// ---------------------------------------------------------------------------
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  // Convert bytes to a big integer
  let num = 0n
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte)
  }

  // Convert to base58
  let result = ''
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result
    num = num / 58n
  }

  // Leading zero bytes → leading '1's
  for (const byte of bytes) {
    if (byte !== 0) break
    result = '1' + result
  }

  return result || '1'
}

// ---------------------------------------------------------------------------
// addressToBase58Fragment
//
// Takes address chars 2–8 (6 hex chars = 3 bytes) and base58-encodes them.
// e.g. "0x3F9A12..." → bytes [0x3F, 0x9A, 0x12] → "5Fns" (4–5 chars)
// ---------------------------------------------------------------------------
function addressToBase58Fragment(address: string): string {
  const hex   = address.slice(2, 8).toLowerCase()   // 6 hex chars
  const bytes = new Uint8Array(3)
  for (let i = 0; i < 3; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return base58Encode(bytes)
}

// ---------------------------------------------------------------------------
// isCodeTaken
//
// Checks if a ref_code is already used by a different wallet.
// Returns true if taken, false if available.
// ---------------------------------------------------------------------------
async function isCodeTaken(
  supabase:   SupabaseClient,
  code:       string,
  ownAddress: string
): Promise<boolean> {
  const { data } = await supabase
    .from('wallet_profiles')
    .select('address')
    .eq('ref_code', code)
    .neq('address', ownAddress.toLowerCase())
    .maybeSingle()

  return !!data
}

// ---------------------------------------------------------------------------
// generateRefCodeForWallet
//
// Generates a unique, permanent ref code for a new wallet.
// Should only be called when wallet_profiles.ref_code is null.
//
// @param address  Wallet address (any case — normalized internally)
// @param supabase Supabase service client for collision checks
// @returns        Unique ref code string (max 32 chars)
// ---------------------------------------------------------------------------
export async function generateRefCodeForWallet(
  address:  string,
  supabase: SupabaseClient
): Promise<string> {
  const addr = address.toLowerCase()

  // 1. Try Basename
  const basename = await resolveBasename(addr)
  const base     = basename
    ? extractBasenameHandle(basename)
    : addressToBase58Fragment(addr)

  // 2. Collision check with incrementing suffix
  let candidate = base
  let suffix    = 2

  while (await isCodeTaken(supabase, candidate, addr)) {
    candidate = `${base}${suffix}`
    suffix++
    if (suffix > 99) {
      // Extreme edge case — fall back to full address fragment
      candidate = `${base}${addr.slice(2, 6)}`
      break
    }
  }

  return candidate
}
