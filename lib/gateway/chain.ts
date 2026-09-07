import { createPublicClient, http, isAddress, type Chain, type PublicClient } from 'viem'

// Chain-level config (env-driven; never hardcode a chain id). Pool instances come from the registry
// (gateway_instances) — many pools, curated. The single-env instance below is a legacy/phase-1 fallback
// used only when the registry has no match. Unset chain ⇒ callers 503.
export type GatewayConfig = {
  chainId: number
  rpcUrl: string
  // optional single-env instance — fallback before the registry is populated
  positionManager: `0x${string}` | null
  staging: `0x${string}` | null
  poolAddress: string | null
}

export function gatewayConfig(): GatewayConfig | null {
  const chainId = Number(process.env.LP_GATEWAY_CHAIN_ID ?? '0')
  const rpcUrl = process.env.LP_GATEWAY_RPC_URL
  if (!chainId || !rpcUrl) return null
  const pm = process.env.LP_GATEWAY_POSITION_MANAGER
  const staging = process.env.LP_GATEWAY_STAGING
  const pool = process.env.LP_GATEWAY_POOL_ADDRESS
  return {
    chainId,
    rpcUrl,
    positionManager: pm && isAddress(pm) ? (pm as `0x${string}`) : null,
    staging: staging && isAddress(staging) ? (staging as `0x${string}`) : null,
    poolAddress: pool ? pool.toLowerCase() : null,
  }
}

function minimalChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}

export function gatewayPublicClient(cfg: { chainId: number; rpcUrl: string }): PublicClient {
  return createPublicClient({ chain: minimalChain(cfg.chainId, cfg.rpcUrl), transport: http(cfg.rpcUrl) })
}
