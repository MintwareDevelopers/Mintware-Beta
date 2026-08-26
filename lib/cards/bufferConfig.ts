// Validation/normalization for a card spend-buffer config write (the user-controls surface, spec §6).
// Pure — turns an untrusted request body into a safe partial DB patch for card_spend_buffers, or an
// error. All amounts are atomic USDC (6dp) and stored as numeric strings. Every field is optional so
// a caller can tune one control at a time; only provided fields appear in the patch.
//
// These are the OFF-CHAIN tuning knobs (target sizing inputs, per-tx cap, refill-rate cap, enable).
// The on-chain per-user caps (setBufferAddress / setUserDailyRefillCap on the Gateway) are signed
// separately by the member/admin; this never moves money — it only shapes future refill behavior,
// which is itself bounded by the on-chain caps + the refill-rate breaker.

const BPS = 10_000

export type BufferConfigPatch = Record<string, string | number | boolean>

export type ParseResult =
  | { ok: true; patch: BufferConfigPatch }
  | { ok: false; error: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Parse a non-negative atomic-USDC amount (accepts number or string), else null. */
function nonNegAtomic(v: unknown): bigint | null {
  try {
    const b = BigInt(typeof v === 'number' ? Math.trunc(v) : String(v))
    return b >= 0n ? b : null
  } catch {
    return null
  }
}

/** Parse a positive integer (seconds), else null. */
function posInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/

export function parseBufferConfig(body: unknown): ParseResult {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' }
  const patch: BufferConfigPatch = {}
  const amountFields: Array<[string, string]> = [
    ['perTxCapAtomic', 'per_tx_cap_atomic'],
    ['minRefillAtomic', 'min_refill_atomic'],
    ['refillRateCapAtomic', 'refill_rate_cap_atomic'],
    ['meanDemandLeadtimeAtomic', 'mean_demand_leadtime_atomic'],
    ['demandStdevAtomic', 'demand_stdev_atomic'],
  ]
  const secsFields: Array<[string, string]> = [
    ['refillWindowSecs', 'refill_window_secs'],
    ['sigmaPeriodSecs', 'sigma_period_secs'],
    ['leadTimeSecs', 'lead_time_secs'],
  ]

  if ('autoRefillEnabled' in body) {
    if (typeof body.autoRefillEnabled !== 'boolean') return { ok: false, error: 'autoRefillEnabled must be a boolean' }
    patch.auto_refill_enabled = body.autoRefillEnabled
  }
  if ('serviceLevelBps' in body) {
    const n = typeof body.serviceLevelBps === 'number' ? body.serviceLevelBps : Number(body.serviceLevelBps)
    if (!Number.isInteger(n) || n < 1 || n > BPS - 1) return { ok: false, error: 'serviceLevelBps must be an integer in [1, 9999]' }
    patch.service_level_bps = n
  }
  for (const [key, col] of amountFields) {
    if (key in body) {
      const a = nonNegAtomic(body[key])
      if (a === null) return { ok: false, error: `${key} must be a non-negative integer amount` }
      patch[col] = a.toString()
    }
  }
  for (const [key, col] of secsFields) {
    if (key in body) {
      const s = posInt(body[key])
      if (s === null) return { ok: false, error: `${key} must be a positive integer (seconds)` }
      patch[col] = s
    }
  }
  if ('bufferAddress' in body) {
    const addr = String(body.bufferAddress)
    if (!EVM_RE.test(addr)) return { ok: false, error: 'bufferAddress must be a 0x EVM address' }
    patch.buffer_address = addr.toLowerCase()
  }
  if ('breakerOpen' in body) {
    if (typeof body.breakerOpen !== 'boolean') return { ok: false, error: 'breakerOpen must be a boolean' }
    patch.breaker_open = body.breakerOpen
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'no recognized config fields provided' }
  return { ok: true, patch }
}
