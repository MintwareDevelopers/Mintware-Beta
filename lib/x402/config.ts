// Env-driven x402 DIRECT facilitator assembly. The retired vault-backed settle path is unavailable;
// the standard x402 exact mode transfers payment directly to the seller's wallet.
import { DirectFacilitator } from './directFacilitator'
import { directSettler } from './directSettler'
import type { Facilitator } from './facilitator'

export const USDC_BY_NETWORK: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
}

export function supportedNetworks(): string[] {
  const raw = process.env.X402_SUPPORTED_NETWORKS
  const list = (raw ? raw.split(',') : ['base-sepolia']).map((s) => s.trim()).filter(Boolean)
  return list.filter((network) => network in USDC_BY_NETWORK)
}

export function defaultPayTo(): string | undefined {
  return process.env.X402_PAY_TO ?? process.env.MINTWARE_TREASURY_ADDRESS
}

/** Direct is the only active facilitator; disabled modes fail closed as unconfigured. */
export function getFacilitator(): Facilitator | null {
  if ((process.env.X402_SETTLE_PROVIDER ?? '').toLowerCase() !== 'direct') return null
  return new DirectFacilitator({ supportedNetworks: supportedNetworks(), settler: directSettler() })
}

export function sellerReady(): boolean {
  return Boolean(getFacilitator() && defaultPayTo() && supportedNetworks().length)
}
