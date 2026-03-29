// =============================================================================
// lib/web3/solanaPublisher.ts
//
// Phase 7 — Solana distributor: off-chain oracle publisher.
//
// Signs a Merkle root for a campaign epoch using the Solana oracle keypair
// (Ed25519). The signature is verified on-chain by the Anchor program via the
// Ed25519SigVerify native program + Instructions sysvar pattern.
//
// Oracle message format (must match programs/mintware-distributor-sol exactly):
//   merkle_root[32] || deadline_i64_le[8] || epoch_number_u64_le[8] || campaign_id_utf8[N]
//
// Environment:
//   SOL_ORACLE_PRIVATE_KEY — JSON array of 64 numbers (Solana keypair bytes).
//                            First 32 bytes = private key seed.
//                            Last 32 bytes  = public key.
//                            Generate with: solana-keygen new --outfile oracle-sol.json
//
// Usage (server-side only — never import in client components):
//   import { publishSolEpoch } from '@/lib/web3/solanaPublisher'
// =============================================================================

import nacl from 'tweetnacl'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

// ---------------------------------------------------------------------------
// Keypair loading
// ---------------------------------------------------------------------------
function loadOracleKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const raw = process.env.SOL_ORACLE_PRIVATE_KEY
  if (!raw) throw new Error('[solanaPublisher] SOL_ORACLE_PRIVATE_KEY not set')
  let bytes: number[]
  try {
    bytes = JSON.parse(raw)
  } catch {
    throw new Error('[solanaPublisher] SOL_ORACLE_PRIVATE_KEY must be a JSON array of 64 numbers')
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error('[solanaPublisher] SOL_ORACLE_PRIVATE_KEY must be 64 bytes')
  }
  const secretKey = new Uint8Array(bytes)
  // nacl keypair from seed (first 32 bytes)
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey)
  return { publicKey: keypair.publicKey, secretKey: keypair.secretKey }
}

// ---------------------------------------------------------------------------
// Build oracle message — must match Rust `build_oracle_message` exactly
//   merkle_root[32] || deadline_i64_le[8] || epoch_number_u64_le[8] || campaign_id_utf8[N]
// ---------------------------------------------------------------------------
function buildOracleMessage(params: {
  merkleRoot:   Buffer | Uint8Array  // 32 bytes
  deadline:     bigint               // i64 unix timestamp
  epochNumber:  bigint               // u64
  campaignId:   string
}): Uint8Array {
  const { merkleRoot, deadline, epochNumber, campaignId } = params
  const idBytes  = new TextEncoder().encode(campaignId)
  const msg      = new Uint8Array(32 + 8 + 8 + idBytes.length)
  const view     = new DataView(msg.buffer)

  msg.set(merkleRoot, 0)

  // deadline as i64 little-endian
  const dl = BigInt.asIntN(64, deadline)
  view.setBigInt64(32, dl, /* littleEndian */ true)

  // epochNumber as u64 little-endian
  view.setBigUint64(40, BigInt.asUintN(64, epochNumber), /* littleEndian */ true)

  msg.set(idBytes, 48)
  return msg
}

// ---------------------------------------------------------------------------
// publishSolEpoch
//
// Signs a Solana distribution epoch and stores the record in sol_distributions.
// Returns the hex oracle signature and deadline.
//
// Called by the admin oracle CLI / cron after building a Merkle tree.
// ---------------------------------------------------------------------------
export async function publishSolEpoch(params: {
  campaignId:  string
  epochNumber: number
  merkleRoot:  string   // hex string (64 chars, no 0x)
  treeJson:    object   // { root, leaves: [{wallet, amount, proof}] }
  ipfsCid?:    string
}): Promise<{ oracleSig: string; deadline: number; publicKey: string }> {
  const { campaignId, epochNumber, merkleRoot, treeJson, ipfsCid } = params

  const keypair = loadOracleKeypair()

  // Deadline: 90 days from now (matches EVM distributor default)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60)

  const rootBytes = Buffer.from(merkleRoot.replace('0x', ''), 'hex')
  if (rootBytes.length !== 32) throw new Error('[solanaPublisher] merkleRoot must be 32 bytes hex')

  const message = buildOracleMessage({
    merkleRoot:  rootBytes,
    deadline,
    epochNumber: BigInt(epochNumber),
    campaignId,
  })

  const sig = nacl.sign.detached(message, keypair.secretKey)
  const oracleSig = Buffer.from(sig).toString('hex')
  const publicKeyHex = Buffer.from(keypair.publicKey).toString('hex')

  // Persist to sol_distributions
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('sol_distributions').upsert(
    {
      campaign_id:  campaignId,
      epoch_number: epochNumber,
      merkle_root:  merkleRoot,
      tree_json:    treeJson,
      ipfs_cid:     ipfsCid ?? null,
      oracle_sig:   oracleSig,
      deadline:     Number(deadline),
      status:       'published',
    },
    { onConflict: 'campaign_id,epoch_number' }
  )
  if (error) throw new Error(`[solanaPublisher] DB upsert failed: ${error.message}`)

  // Log with truncated sig (never log full key material)
  console.log(
    `[solanaPublisher] published campaign=${campaignId} epoch=${epochNumber}` +
    ` deadline=${deadline} sig=${oracleSig.slice(0, 12)}...{REDACTED}` +
    ` oracle_pubkey=${publicKeyHex.slice(0, 12)}...`
  )

  return { oracleSig, deadline: Number(deadline), publicKey: publicKeyHex }
}

// ---------------------------------------------------------------------------
// getOraclePublicKey — returns the hex public key for the loaded oracle keypair.
// Used by admin routes to verify which key is active.
// ---------------------------------------------------------------------------
export function getOraclePublicKey(): string {
  const { publicKey } = loadOracleKeypair()
  return Buffer.from(publicKey).toString('hex')
}
