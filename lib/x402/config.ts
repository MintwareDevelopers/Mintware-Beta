// Env-driven assembly of the default YPN facilitator + seller config. Server-only. Returns null when the
// facilitator can't be built (edge-auth not configured) so routes can fail cleanly with 503 rather than
// pretending. Spec: docs/developers/agentkit-compute-402-spec.md.

import { YpnFacilitator, Facilitator } from './facilitator'
import { httpEdgeAuthorizer, httpSettler, deferredSettler } from './edgeHttp'

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

/** Build the facilitator from env, or null if edge-auth isn't configured. */
export function getFacilitator(): Facilitator | null {
  const url = process.env.EDGE_AUTH_URL
  const secret = process.env.EDGE_AUTH_SECRET
  if (!url || !secret) return null

  const edge = httpEdgeAuthorizer({ url, secret })
  const settler =
    process.env.X402_RELAYER_URL
      ? httpSettler({ url: process.env.X402_RELAYER_URL, secret: process.env.X402_RELAYER_SECRET })
      : deferredSettler

  return new YpnFacilitator({ edge, settler, supportedNetworks: supportedNetworks() })
}

/** True when a seller route can price + settle (facilitator + payTo + at least one network). */
export function sellerReady(): boolean {
  return Boolean(getFacilitator() && defaultPayTo() && supportedNetworks().length)
}
