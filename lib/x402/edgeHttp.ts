// HTTP transports for the YPN facilitator ports — the real edge-auth `/authorize` client (verify = NAV hold)
// and an optional relayer client (settle). Field names match services/edge-auth/src/types.rs exactly.
// Spec: docs/developers/agentkit-compute-402-spec.md §6.2.

import { EdgeAuthorizer, Settler } from './facilitator'

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

/** Relayer settle client. The relayer isn't required to be up for VERIFY to work; settle is the on-chain
 *  leg and is wired here so it's a config flip once the relayer exposes an HTTP settle endpoint. */
export function httpSettler(cfg: { url: string; secret?: string; fetchImpl?: FetchLike }): Settler {
  const f = cfg.fetchImpl ?? fetch
  const base = cfg.url.replace(/\/$/, '')
  return {
    async settle({ holdId, payload, reqs }) {
      let res: Response
      try {
        res = await f(`${base}/settle`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.secret ? { authorization: `Bearer ${cfg.secret}` } : {}),
          },
          body: JSON.stringify({ hold_id: holdId, payload, network: reqs.network, pay_to: reqs.payTo }),
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
