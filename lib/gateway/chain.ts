import { createPublicClient, http, isAddress, type Chain, type PublicClient } from 'viem'

// Single-instance phase-1 config, env-driven (never hardcode an address or chain id). The quote asset
// is whatever the pool quotes in (USDG on Robinhood Chain), never assumed USDC. Unset ⇒ callers 503.
export type GatewayConfig = {
  positionManager: `0x${string}`
  staging: `0x${string}` | null
  poolAddress: string
  chainId: number
  rpcUrl: string
}

export function gatewayConfig(): GatewayConfig | null {
  const pm = process.env.LP_GATEWAY_POSITION_MANAGER
  const pool = process.env.LP_GATEWAY_POOL_ADDRESS
  const chainId = Number(process.env.LP_GATEWAY_CHAIN_ID ?? '0')
  const rpcUrl = process.env.LP_GATEWAY_RPC_URL
  if (!pm || !isAddress(pm) || !pool || !chainId || !rpcUrl) return null
  const staging = process.env.LP_GATEWAY_STAGING
  return {
    positionManager: pm as `0x${string}`,
    staging: staging && isAddress(staging) ? (staging as `0x${string}`) : null,
    poolAddress: pool.toLowerCase(),
    chainId,
    rpcUrl,
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

export function gatewayPublicClient(cfg: GatewayConfig): PublicClient {
  return createPublicClient({ chain: minimalChain(cfg.chainId, cfg.rpcUrl), transport: http(cfg.rpcUrl) })
}
