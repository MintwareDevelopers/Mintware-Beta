// The one home for the chains the app shows markets on: Base and Robinhood. UI labels, explorers and the
// public read RPC per chain. Server reads prefer the configured MARKET_ENGINE_RPC_URL for the deployment's
// own chain (marketEngineConfig) and fall back to these public endpoints for the others.

export type MarketChain = {
  id: number
  name: string
  /** short label for chips and tags */
  short: string
  explorer: string
  rpc: string
  testnet: boolean
}

export const MARKET_CHAINS: Record<number, MarketChain> = {
  84532: { id: 84532, name: 'Base Sepolia', short: 'Base', explorer: 'https://sepolia.basescan.org', rpc: 'https://base-sepolia-rpc.publicnode.com', testnet: true },
  46630: { id: 46630, name: 'Robinhood Chain Testnet', short: 'Robinhood', explorer: 'https://explorer.testnet.chain.robinhood.com', rpc: 'https://rpc.testnet.chain.robinhood.com', testnet: true },
}

export const marketChain = (id: number | null | undefined): MarketChain | null => (id != null ? MARKET_CHAINS[id] ?? null : null)

export const chainLabel = (id: number | null | undefined) => marketChain(id)?.name ?? (id != null ? `Chain ${id}` : 'Unknown chain')
