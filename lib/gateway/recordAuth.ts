// O-10 / R-6 / HO-12: bind the SIGNED `txHash` + `pool` to the body the route acts on, and refuse a
// re-presented signature inside the 15-minute freshness window.
//
// createHandler already binds `action` + `issuedAt` to the signature (routeHandler.ts). The gateway
// deposit/withdraw messages ALSO embed `txHash` and `pool` (signedActionMessages.ts) — but the routes
// read those from the body, so one captured signature was good for any txHash / pool of that wallet on
// that route. Here the signed payload is the source of truth: the body must equal it (case-normalised)
// or the request is rejected. The replay claim is an in-process set keyed by the signature itself; the
// durable backstop is `gateway_deposit_events.tx_hash UNIQUE` (a replayed tx records once, never twice).

import { isHex, keccak256, toBytes } from 'viem'

export type BoundRecordBody = { txHash: `0x${string}`; pool: string | null }
export type BindResult = { ok: true; bound: BoundRecordBody } | { ok: false; error: 'txHash_required' | 'auth_payload_mismatch' | 'auth_replayed' }

const REPLAY_TTL_MS = 15 * 60 * 1000 // == createHandler's issuedAt freshness window
const seen = new Map<string, number>() // signature-hash → expiry (ms)

function sweep(now: number) {
  if (seen.size < 512) return
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k)
}

/** Strict-compare the signed payload's txHash/pool to the body, then claim the signature once. */
export function bindSignedRecord(body: Record<string, unknown>, now = Date.now()): BindResult {
  const txHash = typeof body.txHash === 'string' ? body.txHash.toLowerCase() : ''
  if (!txHash || !isHex(txHash) || txHash.length !== 66) return { ok: false, error: 'txHash_required' }
  const pool = typeof body.pool === 'string' && body.pool.trim() ? body.pool.trim().toLowerCase() : null

  let signed: Record<string, unknown>
  try {
    signed = JSON.parse(String(body.authMessage ?? ''))
  } catch {
    return { ok: false, error: 'auth_payload_mismatch' }
  }
  const signedTx = typeof signed.txHash === 'string' ? signed.txHash.toLowerCase() : ''
  const signedPool = typeof signed.pool === 'string' && signed.pool ? signed.pool.toLowerCase() : null
  if (signedTx !== txHash || signedPool !== pool) return { ok: false, error: 'auth_payload_mismatch' }

  // Single-use inside the freshness window (per process; the UNIQUE tx_hash ledger is the durable gate).
  const sig = String(body.authSignature ?? '')
  const key = keccak256(toBytes(sig.toLowerCase()))
  sweep(now)
  const exp = seen.get(key)
  if (exp != null && exp > now) return { ok: false, error: 'auth_replayed' }
  seen.set(key, now + REPLAY_TTL_MS)

  return { ok: true, bound: { txHash: txHash as `0x${string}`, pool } }
}

/** Test hook: forget every claimed signature. */
export function _resetReplayGuard() {
  seen.clear()
}
