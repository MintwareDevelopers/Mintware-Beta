// =============================================================================
// lib/web3/verifySolanaTx.ts
//
// Server-side Solana transaction verifier for campaign swap attribution.
//
// Verifies:
//   1. Transaction exists and is confirmed (no error, slot is set)
//   2. Fee payer (first account) matches the claimed wallet address
//   3. At least one known DEX program appears in the transaction accounts
//
// Known DEX programs (Jupiter, Raydium, Orca):
//   Any swap routed through a major Solana DEX will include one of these
//   program IDs in accountKeys.
//
// Fail-open on RPC errors — never blocks a legitimate user due to RPC flakiness.
// Called from POST /api/campaigns/sol-swap-event before points are credited.
//
// @param signature   Base58 transaction signature
// @param wallet      Solana base58 wallet address (fee payer to check against)
// @param rpcUrl      Optional RPC override — defaults to mainnet-beta public endpoint
// =============================================================================

import { Connection, PublicKey } from '@solana/web3.js'

// ---------------------------------------------------------------------------
// Known Solana DEX program IDs
// ---------------------------------------------------------------------------
const SOLANA_DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter Aggregator V6 (current)
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  // Jupiter V4
  'JUP3c2Uh3WA4Ng34tw6kPd2G4LFxQapl2Mi13TimrKe',  // Jupiter V3
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM V4
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', // Raydium AMM V5
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca V2
  'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ',  // Saber
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca V1
])

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com'

export interface SolanaTxVerification {
  valid:    boolean
  error?:   string
  /** true when RPC call failed — caller should fail open */
  rpcError: boolean
}

// ---------------------------------------------------------------------------
// isValidBase58Signature
// Solana tx signatures are 64 bytes, base58-encoded → 87–88 chars
// ---------------------------------------------------------------------------
function isValidBase58Signature(sig: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(sig)
}

// ---------------------------------------------------------------------------
// verifySolanaTx
// ---------------------------------------------------------------------------
export async function verifySolanaTx(
  signature: string,
  wallet:    string,
  rpcUrl:    string = DEFAULT_RPC
): Promise<SolanaTxVerification> {

  // Basic format validation before hitting the RPC
  if (!isValidBase58Signature(signature)) {
    return { valid: false, error: 'invalid_signature_format', rpcError: false }
  }

  try {
    const walletPubkey = new PublicKey(wallet)

    const connection = new Connection(rpcUrl, 'confirmed')
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })

    // Transaction not found or not yet confirmed
    if (!tx) {
      return { valid: false, error: 'tx_not_found', rpcError: false }
    }

    // Transaction errored on-chain
    if (tx.meta?.err) {
      return { valid: false, error: 'tx_failed_on_chain', rpcError: false }
    }

    // ── Check fee payer ──────────────────────────────────────────────────────
    // The fee payer is the first account in accountKeys — this is who signed
    // and paid for the tx. It must match the wallet claiming the swap.
    const accountKeys = tx.transaction.message.accountKeys
    if (!accountKeys || accountKeys.length === 0) {
      return { valid: false, error: 'no_account_keys', rpcError: false }
    }

    const feePayer = accountKeys[0].pubkey
    if (!feePayer.equals(walletPubkey)) {
      return { valid: false, error: 'wallet_mismatch', rpcError: false }
    }

    // ── Check for known DEX program ──────────────────────────────────────────
    // At least one of the accounts in the tx must be a known DEX program.
    // Covers Jupiter, Raydium, Orca routes.
    const accountAddresses = accountKeys.map(k => k.pubkey.toBase58())
    const hasDex = accountAddresses.some(addr => SOLANA_DEX_PROGRAMS.has(addr))

    if (!hasDex) {
      return { valid: false, error: 'no_dex_program', rpcError: false }
    }

    return { valid: true, rpcError: false }

  } catch (err) {
    // RPC unavailable, rate-limited, or network error — fail open
    console.warn('[verifySolanaTx] RPC error — failing open:', err)
    return { valid: true, error: 'rpc_error_fail_open', rpcError: true }
  }
}
