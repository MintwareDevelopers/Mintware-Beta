import { createPublicClient, http, type Chain, type PublicClient } from 'viem'

function minimalChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}

export function marketEnginePublicClient(cfg: { chainId: number; rpcUrl: string }): PublicClient {
  return createPublicClient({ chain: minimalChain(cfg.chainId, cfg.rpcUrl), transport: http(cfg.rpcUrl) })
}
