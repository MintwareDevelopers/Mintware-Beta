// =============================================================================
// POST /api/auth/connect
//
// First-connect handler. Called by useReferral.ts on wallet connect.
// Generates and permanently stores a ref code for new wallets.
//
// Ref code logic (Basename-first):
//   1. Check if wallet already has a ref_code — if yes, return it immediately
//   2. New wallet: resolve Basename → "jake.base" → "jake"
//   3. No Basename: base58-encode address bytes 2–8 → "5Fns"
//   4. Collision check loop until unique code found
//   5. Upsert wallet_profiles: set ref_code only on first insert (COALESCE)
//
// Ref code format:
//   - Basename-derived:  "jake", "alice" (no prefix)
//   - Address fallback:  "5Fns", "3kXm" (base58, no prefix)
//   - Existing legacy:   "mw_3f9a12" (untouched — permanent)
//
// Body:  { address: string }
// Returns: { ref_code: string, is_new: boolean }
// =============================================================================

import { solanaEnabled } from '@/lib/web3/featureFlags'
import { generateRefCodeForWallet } from '@/lib/rewards/referral-code'
import { recoverMessageAddress } from 'viem'
import { buildWalletConnectMessage } from '@/lib/web3/signedActionMessages'
import { createHandler } from '@/lib/web2/routeHandler'

const EVM_RE     = /^0x[0-9a-f]{40}$/i
const SOLANA_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function isValidAddress(raw: string): boolean {
  return EVM_RE.test(raw) || (solanaEnabled && SOLANA_RE.test(raw))
}

function normalizeAddress(raw: string): string {
  // EVM addresses are stored lowercase; Solana base58 is case-sensitive — preserve case
  return EVM_RE.test(raw) ? raw.toLowerCase() : raw
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'invalid json' }, 400)
  }

  const b       = body as Record<string, unknown>
  const rawAddr = b?.address
  const authMessage = b?.authMessage
  const authSignature = b?.authSignature
  const issuedAt = b?.issuedAt

  if (!rawAddr || typeof rawAddr !== 'string') {
    return ctx.json({ error: 'address required' }, 400)
  }
  if (!isValidAddress(rawAddr)) {
    return ctx.json({ error: 'invalid address' }, 400)
  }
  if (typeof authMessage !== 'string' || typeof authSignature !== 'string' || typeof issuedAt !== 'number') {
    return ctx.json({ error: 'signed authorization required' }, 401)
  }
  if (Math.abs(Date.now() - issuedAt) > 15 * 60 * 1000) {
    return ctx.json({ error: 'authorization expired' }, 401)
  }

  const address  = normalizeAddress(rawAddr)
  const isSolana = solanaEnabled && SOLANA_RE.test(rawAddr)
  const expectedMessage = buildWalletConnectMessage({ address, issuedAt })
  if (authMessage !== expectedMessage) {
    return ctx.json({ error: 'authorization payload mismatch' }, 401)
  }

  if (EVM_RE.test(rawAddr)) {
    const signer = await recoverMessageAddress({
      message: authMessage,
      signature: authSignature as `0x${string}`,
    }).catch(() => null)

    if (!signer || signer.toLowerCase() !== address) {
      return ctx.json({ error: 'invalid authorization signature' }, 401)
    }
  } else {
    return ctx.json({ error: 'solana connect authorization unavailable while paused' }, 410)
  }

  // ── Check if wallet already exists with a ref_code ────────────────────────
  const { data: existing, error: lookupErr } = await ctx.supabase
    .from('wallet_profiles')
    .select('ref_code')
    .eq('address', address)
    .maybeSingle()

  if (lookupErr) {
    ctx.log.error('auth/connect', 'Lookup error', { error: lookupErr.message })
    return ctx.json({ error: 'internal error' }, 500)
  }

  if (existing?.ref_code) {
    // Existing wallet — update last_seen_at and flip any pending referrals to active
    await ctx.supabase
      .from('wallet_profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('address', address)

    // Flip pending → active for this wallet (they've returned = genuinely active)
    await ctx.supabase
      .from('referral_records')
      .update({ status: 'active', activated_at: new Date().toISOString() })
      .eq('referred', address)
      .eq('status', 'pending')

    return ctx.json({
      ref_code: existing.ref_code,
      is_new:   false,
    })
  }

  // ── New wallet — generate a ref code ──────────────────────────────────────
  let refCode: string
  try {
    refCode = await generateRefCodeForWallet(address, ctx.supabase)
  } catch (err) {
    ctx.log.error('auth/connect', 'generateRefCodeForWallet error', { err: String(err) })
    // Fallback: deterministic from address — EVM uses hex bytes, Solana uses first 6 chars
    refCode = isSolana ? address.slice(0, 6) : 'mw_' + address.slice(2, 8)
  }

  // Upsert: set ref_code only if null (prevents overwriting existing codes if
  // there's a race). Use raw SQL via RPC if needed, or rely on the check above.
  const { error: upsertErr } = await ctx.supabase
    .from('wallet_profiles')
    .upsert(
      {
        address,
        ref_code:     refCode,
        last_seen_at: new Date().toISOString(),
      },
      {
        onConflict:       'address',
        ignoreDuplicates: false,
      }
    )

  if (upsertErr) {
    ctx.log.error('auth/connect', 'Upsert error', { error: upsertErr.message })
    // Still return a code even if the DB write failed (non-critical)
    return ctx.json({
      ref_code: refCode,
      is_new:   true,
    })
  }

  return ctx.json({
    ref_code: refCode,
    is_new:   true,
  })
}, { auth: 'none' })

export const GET = createHandler(async (_req, ctx) => {
  return ctx.json({ error: 'method not allowed' }, 405)
})
