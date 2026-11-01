import deployments from '@/config/deployments.json'
import { MARKET_CHAINS } from '@/lib/chains/marketChains'
import { RWA_STACK_CONTRACTS } from '@/lib/rwa/units'

type Deployment = { address: string | null; chainId: number; status: string; verified?: string; deployed?: string }

// Admission is by current product family AND recorded status. Some retired families still have
// "testnet" entries, so status filtering alone would re-publish obsolete demos and deployers.
const CURRENT_PRODUCT = /^(?:MintwareMarketEngine$|MintwareMarketAdapter_|MintwareMarketLifecycleModule(?:_|$)|MintwareFixedTestMark$|RwaOwnedPool_|MintwareYieldVault$|AgentPark(?:Vault|IdleAdapter)$|AIAttribution$)/

const environments: Record<string, Record<string, Record<string, Deployment>>> = {
  mainnet: deployments.mainnet,
  testnet: deployments.testnet,
}

export const CONTRACT_GROUPS = Object.entries(environments).flatMap(
  ([environment, chains]) => Object.entries(chains).map(([chain, contracts]) => ({
    chain,
    environment,
    name: chain === 'base' ? 'Base mainnet' : Object.values(MARKET_CHAINS).find((item) => item.id === Object.values(contracts)[0]?.chainId)?.name ?? chain,
    contracts: Object.entries(contracts)
      .filter(([name, entry]) => CURRENT_PRODUCT.test(name) && !name.includes('_superseded')
        && ['live', 'testnet'].includes(entry.status) && entry.address != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => {
        const sharedRwa = entry.chainId === 84532
          ? RWA_STACK_CONTRACTS.find((item) => item.address.toLowerCase() === entry.address?.toLowerCase())
          : undefined
        const explorer = sharedRwa?.explorer ?? MARKET_CHAINS[entry.chainId]?.explorer
          ?? (entry.chainId === 8453 ? 'https://basescan.org' : null)
        return { name, ...entry, explorer, recordedAt: entry.verified ?? entry.deployed ?? 'Not recorded' }
      }),
  })),
).filter((group) => group.contracts.length > 0)
