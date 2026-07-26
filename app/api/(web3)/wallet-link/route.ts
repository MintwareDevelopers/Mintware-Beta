// POST /api/wallet-link
// Links a Solana wallet to a proven EVM wallet owner (dual-signature).
// Auth: inline EVM signed-message + Ed25519 Solana signature

import { createHandler } from '@/lib/web2/routeHandler'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { PublicKey }     from '@solana/web3.js'
import nacl              from 'tweetnacl'
import { recoverMessageAddress } from 'viem'
import { buildWalletLinkMessage } from '@/lib/web3/signedActionMessages'

const MAX_TS_DRIFT_MS = 5 * 60 * 1000
const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function isValidEVM(addr: string)    { return /^0x[0-9a-f]{40}$/i.test(addr) }
function isValidBase58(addr: string) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) }

export const POST = createHandler(async (req, ctx) => {
  if (!solanaEnabled) return ctx.json({ error: 'solana_wallet_linking_paused' }, 410)

  let body: Record<string, unknown>
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  const { evm_address, sol_address, signature, message, evm_auth_message, evm_auth_signature, issuedAt } = body as Record<string, string | number>

  if (!evm_address || !isValidEVM(String(evm_address)))   return ctx.json({ error: 'invalid evm_address' }, 400)
  if (!sol_address || !isValidBase58(String(sol_address))) return ctx.json({ error: 'invalid sol_address' }, 400)
  if (!signature || !message)                              return ctx.json({ error: 'signature and message required' }, 400)
  if (!evm_auth_message || !evm_auth_signature || typeof issuedAt !== 'number') return ctx.json({ error: 'evm authorization required' }, 401)
  if (Math.abs(Date.now() - issuedAt) > MAX_AUTH_AGE_MS) return ctx.json({ error: 'authorization expired' }, 401)

  const evmAddress       = String(evm_address)
  const solAddress       = String(sol_address)
  const solSignature     = String(signature)
  const solMessage       = String(message)
  const evmAuthMessage   = String(evm_auth_message)
  const evmAuthSignature = String(evm_auth_signature) as `0x${string}`

  const evmMatch = solMessage.match(/evm=(0x[0-9a-fA-F]{40})/)
  const tsMatch  = solMessage.match(/ts=(\d+)/)
  if (!evmMatch || evmMatch[1].toLowerCase() !== evmAddress.toLowerCase()) return ctx.json({ error: 'message evm address mismatch' }, 400)
  if (!tsMatch) return ctx.json({ error: 'message missing timestamp' }, 400)

  const ts = parseInt(tsMatch[1], 10) * 1000
  if (Math.abs(Date.now() - ts) > MAX_TS_DRIFT_MS) return ctx.json({ error: 'message timestamp expired' }, 400)

  const expectedEvmMessage = buildWalletLinkMessage({ evmAddress, solAddress, solMessage, issuedAt })
  if (evmAuthMessage !== expectedEvmMessage) return ctx.json({ error: 'evm authorization payload mismatch' }, 401)

  const evmSigner = await recoverMessageAddress({ message: evmAuthMessage, signature: evmAuthSignature }).catch(() => null)
  if (!evmSigner || evmSigner.toLowerCase() !== evmAddress.toLowerCase()) return ctx.json({ error: 'invalid evm authorization signature' }, 401)

  try {
    const pubkey   = new PublicKey(solAddress)
    const msgBytes = new TextEncoder().encode(solMessage)
    const sigBytes = Buffer.from(solSignature, 'base64')
    if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes())) return ctx.json({ error: 'invalid signature' }, 401)
  } catch {
    return ctx.json({ error: 'signature verification failed' }, 401)
  }

  const { error } = await ctx.supabase.from('wallet_links').upsert(
    { primary_address: evmAddress.toLowerCase(), linked_address: solAddress, linked_chain: 'solana', link_signature: solSignature, link_message: solMessage, status: 'verified', verified_at: new Date().toISOString() },
    { onConflict: 'linked_address' }
  )

  if (error) {
    ctx.log.error('wallet-link', 'upsert error', { error: error.message })
    return ctx.json({ error: 'internal error' }, 500)
  }

  return ctx.json({ ok: true })
})

export const GET = createHandler(async (_req, ctx) => {
  if (!solanaEnabled) return ctx.json({ error: 'solana_wallet_linking_paused' }, 410)
  return ctx.json({ error: 'method not allowed' }, 405)
})
