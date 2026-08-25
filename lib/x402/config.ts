// Env-driven assembly of the default YPN facilitator + seller config. Server-only. Returns null when the
// facilitator can't be built (edge-auth not configured) so routes can fail cleanly with 503 rather than
// pretending. Spec: docs/developers/agentkit-compute-402-spec.md.

import { YpnFacilitator, Facilitator, TrustSource } from './facilitator'
import { DirectFacilitator } from './directFacilitator'
import { httpEdgeAuthorizer, httpSettler, deferredSettler } from './edgeHttp'
import { oracleSettler } from './oracleSettler'
import { directSettler } from './directSettler'
import { parkedSizeTrustSource } from './trustSources'
import { rpcParkedReader } from './vaultReader'
import { ARC_TESTNET, ARC_TESTNET_DEPLOYMENT, ARC_CHAIN_ID } from '@/config/arc'

/** USDC (6dp) per supported network — public token addresses. */
export const USDC_BY_NETWORK: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  arc: '0x3600000000000000000000000000000000000000',
}

export function supportedNetworks(): string[] {
  const raw = process.env.X402_SUPPORTED_NETWORKS
  const list = (raw ? raw.split(',') : ['base', 'base-sepolia']).map((s) => s.trim()).filter(Boolean)
  return list.filter((n) => n in USDC_BY_NETWORK)
}

/** The settlement recipient (Gateway / treasury) for the seller side. */
export function defaultPayTo(): string | undefined {
  return process.env.X402_PAY_TO ?? process.env.NEXT_PUBLIC_ARC_GATEWAY_ADDRESS ?? process.env.MINTWARE_TREASURY_ADDRESS
}

/** Build the facilitator from env, or null if it can't be configured.
 *
 *  X402_SETTLE_PROVIDER=direct → the standard x402 "exact" model: verify a signed EIP-3009 transfer and
 *  submit it straight to `payTo` (no vault, no edge-auth, no on-chain role — the simplest/safest way for a
 *  seller to just collect the fee in a wallet). Otherwise the YPN vault-backed facilitator (edge-auth NAV
 *  hold → settleSpend), which requires EDGE_AUTH_URL/SECRET and returns null without them. */
export function getFacilitator(): Facilitator | null {
  if ((process.env.X402_SETTLE_PROVIDER ?? '').toLowerCase() === 'direct') {
    return new DirectFacilitator({ supportedNetworks: supportedNetworks(), settler: directSettler() })
  }

  const url = process.env.EDGE_AUTH_URL
  const secret = process.env.EDGE_AUTH_SECRET
  if (!url || !secret) return null

  const edge = httpEdgeAuthorizer({ url, secret })
  return new YpnFacilitator({ edge, settler: getSettler(), supportedNetworks: supportedNetworks(), trust: getTrustSource() })
}

/** Select the on-chain settle transport. Precedence:
 *   1. `X402_RELAYER_URL` set → the Rust `services/relayer` HTTP server (explicit override).
 *   2. `X402_SETTLE_PROVIDER=oracle` → the in-process `settleSpend` via `getOracleSigner('root')` — the
 *      SAME Privy/oracle signer the card flow uses (`lib/org/settleSwipe.ts`). No separate relayer service,
 *      no raw key: `ORACLE_SIGNER_PROVIDER=privy` keeps the key in Privy's enclave. This is the
 *      platform-consistent path.
 *   3. neither → `deferredSettler` (VERIFY/hold works; settle deferred). Default → deploy-gating unchanged.
 */
function getSettler() {
  if (process.env.X402_RELAYER_URL) {
    return httpSettler({ url: process.env.X402_RELAYER_URL, secret: process.env.X402_RELAYER_SECRET })
  }
  if ((process.env.X402_SETTLE_PROVIDER ?? '').toLowerCase() === 'oracle') {
    return oracleSettler({ gateway: x402PermitGateway(), chainId: x402PermitChainId() })
  }
  return deferredSettler
}

/** True when a real (fund-moving) on-chain settle transport is wired — either the Rust relayer or the
 *  in-process oracle/Privy settler. The settle route uses this to fail closed early (require a standing
 *  permit) only when settlement would actually submit on-chain; the deferred default is unaffected. */
export function x402OnchainSettleConfigured(): boolean {
  return Boolean(process.env.X402_RELAYER_URL) || (process.env.X402_SETTLE_PROVIDER ?? '').toLowerCase() === 'oracle'
}

/** OPTIONAL trust source for hold tiering. Default OFF (undefined) → authorize on NAV alone. Set
 *  `X402_TRUST_TIERING=parked` to tier by parked size (skin in the game; no Attribution). */
function getTrustSource(): TrustSource | undefined {
  if (process.env.X402_TRUST_TIERING !== 'parked') return undefined
  const rpcUrl = process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl
  const vault = process.env.NEXT_PUBLIC_ARC_VAULT_ADDRESS ?? ARC_TESTNET_DEPLOYMENT.vault
  return parkedSizeTrustSource(rpcParkedReader({ rpcUrl, vault }))
}

/** True when a seller route can price + settle (facilitator + payTo + at least one network). */
export function sellerReady(): boolean {
  return Boolean(getFacilitator() && defaultPayTo() && supportedNetworks().length)
}

/** The `MintwarePaymentGateway` an x402 standing permit authorizes — the EIP-712 `verifyingContract`
 *  the payer signs against AND the gateway the relayer runs `settleSpend` on. Must be a SINGLE value
 *  so registration (permit route) and lookup (settle route) agree. Resolves server-side from env,
 *  never from a client-supplied address. `X402_GATEWAY_ADDRESS` overrides; otherwise it falls back to
 *  the relayer's default gateway, then the Arc spend-stack gateway. Returns undefined when unset →
 *  callers fail closed. */
export function x402PermitGateway(): string | undefined {
  return (
    process.env.X402_GATEWAY_ADDRESS ??
    process.env.RELAYER_GATEWAY_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_GATEWAY_ADDRESS
  )
}

/** Chain id the x402 permit's EIP-712 domain is bound to. Must match the gateway's chain. Defaults to
 *  Arc (the x402 spend chain); overridable via `X402_PERMIT_CHAIN_ID` / `EDGE_CHAIN_ID`. */
export function x402PermitChainId(): number {
  const raw = process.env.X402_PERMIT_CHAIN_ID ?? process.env.EDGE_CHAIN_ID
  const n = raw != null ? Number(raw) : ARC_CHAIN_ID
  return Number.isFinite(n) && n > 0 ? n : ARC_CHAIN_ID
}
