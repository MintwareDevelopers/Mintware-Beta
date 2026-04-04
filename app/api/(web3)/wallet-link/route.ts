// =============================================================================
// POST /api/wallet-link
//
// Links a Solana wallet to an authenticated EVM session.
//
// Flow:
//   1. User is authenticated via EVM wallet (evm_address from body)
//   2. User connects Solana wallet in the browser
//   3. Solana wallet signs: "Link wallet to Mintware: evm=0x... ts=<unix>"
//   4. This route verifies the Ed25519 signature and inserts wallet_links row
//
// Body: { evm_address: string, sol_address: string, signature: string, message: string }
// Returns: { ok: true } | { error: string }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { PublicKey }                   from '@solana/web3.js'
import nacl                            from 'tweetnacl'
import { recoverMessageAddress }       from 'viem'
import { buildWalletLinkMessage }      from '@/lib/web3/signedActionMessages'

const MAX_TS_DRIFT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function isValidEVM(addr: string)     { return /^0x[0-9a-f]{40}$/i.test(addr) }
function isValidBase58(addr: string)  { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) }

export async function POST(req: NextRequest) {
  if (!solanaEnabled) {
    return NextResponse.json({ error: 'solana_wallet_linking_paused' }, { status: 410 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const {
    evm_address,
    sol_address,
    signature,
    message,
    evm_auth_message,
    evm_auth_signature,
    issuedAt,
  } = body as Record<string, string | number>

  if (!evm_address || !isValidEVM(String(evm_address)))
    return NextResponse.json({ error: 'invalid evm_address' }, { status: 400 })
  if (!sol_address || !isValidBase58(String(sol_address)))
    return NextResponse.json({ error: 'invalid sol_address' }, { status: 400 })
  if (!signature || !message)
    return NextResponse.json({ error: 'signature and message required' }, { status: 400 })
  if (!evm_auth_message || !evm_auth_signature || typeof issuedAt !== 'number')
    return NextResponse.json({ error: 'evm authorization required' }, { status: 401 })
  if (Math.abs(Date.now() - issuedAt) > MAX_AUTH_AGE_MS)
    return NextResponse.json({ error: 'authorization expired' }, { status: 401 })

  const evmAddress = String(evm_address)
  const solAddress = String(sol_address)
  const solSignature = String(signature)
  const solMessage = String(message)
  const evmAuthMessage = String(evm_auth_message)
  const evmAuthSignature = String(evm_auth_signature) as `0x${string}`

  // ── Verify message format ────────────────────────────────────────────────
  // Expected: "Link wallet to Mintware: evm=0x... ts=1743000000"
  const evmMatch = solMessage.match(/evm=(0x[0-9a-fA-F]{40})/)
  const tsMatch  = solMessage.match(/ts=(\d+)/)

  if (!evmMatch || evmMatch[1].toLowerCase() !== evmAddress.toLowerCase())
    return NextResponse.json({ error: 'message evm address mismatch' }, { status: 400 })

  if (!tsMatch)
    return NextResponse.json({ error: 'message missing timestamp' }, { status: 400 })

  const ts = parseInt(tsMatch[1], 10) * 1000
  if (Math.abs(Date.now() - ts) > MAX_TS_DRIFT_MS)
    return NextResponse.json({ error: 'message timestamp expired' }, { status: 400 })

  const expectedEvmMessage = buildWalletLinkMessage({
    evmAddress,
    solAddress,
    solMessage,
    issuedAt,
  })
  if (evmAuthMessage !== expectedEvmMessage)
    return NextResponse.json({ error: 'evm authorization payload mismatch' }, { status: 401 })

  const evmSigner = await recoverMessageAddress({
    message: evmAuthMessage,
    signature: evmAuthSignature,
  }).catch(() => null)

  if (!evmSigner || evmSigner.toLowerCase() !== evmAddress.toLowerCase())
    return NextResponse.json({ error: 'invalid evm authorization signature' }, { status: 401 })

  // ── Verify Ed25519 signature ─────────────────────────────────────────────
  try {
    const pubkey  = new PublicKey(solAddress)
    const msgBytes = new TextEncoder().encode(solMessage)
    const sigBytes = Buffer.from(solSignature, 'base64')

    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes())
    if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 })
  }

  // ── Insert wallet_links row ──────────────────────────────────────────────
  const supabase = createSupabaseServiceClient()

  const { error } = await supabase
    .from('wallet_links')
    .upsert(
      {
        primary_address: evmAddress.toLowerCase(),
        linked_address:  solAddress,
        linked_chain:    'solana',
        link_signature:  solSignature,
        link_message:    solMessage,
        status:          'verified',
        verified_at:     new Date().toISOString(),
      },
      { onConflict: 'linked_address' }
    )

  if (error) {
    console.error('[wallet-link] upsert error:', error.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  if (!solanaEnabled) {
    return NextResponse.json({ error: 'solana_wallet_linking_paused' }, { status: 410 })
  }

  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}
