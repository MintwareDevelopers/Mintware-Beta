// HTTP transports for the YPN facilitator ports — the real edge-auth `/authorize` client (verify = NAV hold)
// and an optional relayer client (settle). Field names match services/edge-auth/src/types.rs exactly.
// Spec: docs/developers/agentkit-compute-402-spec.md §6.2.

import { EdgeAuthorizer, Settler } from './facilitator'
import { SpendableSource } from './treasury'

/** The relayer `POST /settle` body — a field-for-field mirror of `services/relayer` `SettleReq`
 *  (→ the library `SettleParams`). Amounts/integers are decimal strings; addresses/hashes/sigs are
 *  0x-hex. `edge` is only present for charges `>= $250`; `gateway` overrides the server default. */
export interface RelayerSettleBody {
  hold_id: string
  user: string
  assets: string
  receiver: string
  permit: {
    user: string
    max_daily_spend_usdc: string
    nonce: string
    deadline: string
    signature: string
  }
  edge?: {
    hold_id: string
    user: string
    amount_usdc: string
    nonce: string
    expiry: string
    signature: string
  }
  gateway?: string
}

type FetchLike = typeof fetch

/** edge-auth `POST /authorize` → `{ approved, hold_id?, hold_usdc?, decline_reason? }`, bearer-guarded. */
export function httpEdgeAuthorizer(cfg: { url: string; secret: string; fetchImpl?: FetchLike }): EdgeAuthorizer {
  const f = cfg.fetchImpl ?? fetch
  const base = cfg.url.replace(/\/$/, '')
  return {
    async authorize({ payer, amountAtomic, ref }) {
      let res: Response
      try {
        res = await f(`${base}/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.secret}` },
          // edge-auth AuthorizeRequest: { user, amount_usdc, hold_id? }. `ref` (x402 nonce) is the hold id
          // so a replay of the same challenge is idempotent at the edge.
          body: JSON.stringify({ user: payer.toLowerCase(), amount_usdc: amountAtomic, hold_id: ref }),
        })
      } catch {
        return { approved: false, reason: 'edge_unreachable' }
      }
      if (!res.ok) return { approved: false, reason: `edge_${res.status}` }
      const j = (await res.json()) as {
        approved?: boolean
        hold_id?: string
        hold_usdc?: string
        decline_reason?: string
      }
      return {
        approved: Boolean(j.approved),
        holdId: j.hold_id,
        holdAtomic: j.hold_usdc,
        reason: j.decline_reason,
      }
    },
  }
}

/** Relayer settle client. The relayer isn't required to be up for VERIFY to work; settle is the
 *  on-chain leg. Builds the exact `services/relayer` `POST /settle` body (`RelayerSettleBody` →
 *  library `SettleParams`) and POSTs it.
 *
 *  Field provenance (traced through `facilitator.ts` → `/api/x402/settle`):
 *   - `hold_id`  ← the edge-auth hold reserved at VERIFY (`Settler.settle` `holdId`). Must be the
 *                  on-chain bytes32 hold id (`0x` + 64 hex); the relayer parses it as `B256`.
 *   - `user`     ← `payload.payload.authorization.from` (the x402 payer / EIP-3009 `from`).
 *   - `assets`   ← `payload.payload.authorization.value` (atomic USDC, 6dp), else `maxAmountRequired`.
 *   - `receiver` ← `reqs.payTo` (the settlement recipient the seller advertised).
 *   - `permit` / `edge` ← threaded in from the caller (see TODO below); NOT derivable from the x402
 *                  payload, because the x402 signature is an EIP-3009 `TransferWithAuthorization`,
 *                  a different scheme than the Gateway's long-lived `DelegatedSpendPermit`.
 *
 *  TODO(x402→gateway permit): the pure x402 agent flow does not carry the payer's `DelegatedSpendPermit`.
 *  To settle an x402 charge through `MintwarePaymentGateway.settleSpend`, the facilitator/settle route
 *  must fetch the payer's stored long-lived permit + signature (the same permit store the card flow
 *  signs into once, `lib/org/*`) and thread it here as `permit` (and `edge` for `>= $250`). Until that
 *  store is wired, we FAIL CLOSED (`settlement_permit_unavailable`) rather than POST a body the Gateway
 *  would reject on-chain — we never fabricate a signature. */
export function httpSettler(cfg: { url: string; secret?: string; fetchImpl?: FetchLike }): Settler {
  const f = cfg.fetchImpl ?? fetch
  const base = cfg.url.replace(/\/$/, '')
  return {
    async settle({ holdId, payload, reqs, permit, edge }) {
      // hold_id is both the Gateway's settle key and the relayer's idempotency key — required + bytes32.
      if (!holdId) return { success: false, errorReason: 'settlement_hold_missing' }
      const auth = payload?.payload?.authorization
      const user = auth?.from
      const assets = auth?.value ?? reqs.maxAmountRequired
      if (!user || !assets) return { success: false, errorReason: 'settlement_payload_incomplete' }
      // The Gateway's DelegatedSpendPermit is not part of the x402 payload — see the TODO above.
      if (!permit) return { success: false, errorReason: 'settlement_permit_unavailable' }

      const body: RelayerSettleBody = {
        hold_id: holdId,
        user: user.toLowerCase(),
        assets: String(assets),
        receiver: reqs.payTo,
        permit,
        ...(edge ? { edge } : {}),
      }

      let res: Response
      try {
        res = await f(`${base}/settle`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.secret ? { authorization: `Bearer ${cfg.secret}` } : {}),
          },
          body: JSON.stringify(body),
        })
      } catch {
        return { success: false, errorReason: 'relayer_unreachable' }
      }
      if (!res.ok) return { success: false, errorReason: `relayer_${res.status}` }
      const j = (await res.json()) as { success?: boolean; tx_hash?: string; error?: string }
      return { success: Boolean(j.success), txHash: j.tx_hash, errorReason: j.error }
    },
  }
}

/** Default settler when no relayer is configured — VERIFY (the hold) still works; settle is deferred. */
export const deferredSettler: Settler = {
  async settle() {
    return { success: false, errorReason: 'settlement_deferred_relayer_unconfigured' }
  },
}

/** Live spendable headroom from edge-auth `GET /available/:user` (NAV − holds − caps). Returns null on any
 *  failure so the treasury view degrades to "spendable == parked" rather than erroring. */
export function httpSpendableSource(cfg: { url: string; secret: string; fetchImpl?: FetchLike }): SpendableSource {
  const f = cfg.fetchImpl ?? fetch
  const base = cfg.url.replace(/\/$/, '')
  return {
    async headroomAtomic(agent) {
      try {
        const res = await f(`${base}/available/${agent.toLowerCase()}`, {
          headers: { authorization: `Bearer ${cfg.secret}` },
        })
        if (!res.ok) return null
        const j = (await res.json()) as { available_usdc?: string }
        return j.available_usdc != null ? BigInt(j.available_usdc) : null
      } catch {
        return null
      }
    },
  }
}
