import deployments from '@/config/deployments.json'

export const RWA_UNITS = [{ slug: 'wcp7', name: 'Property unit', symbol: 'WCP7', chainId: 84532, chainName: 'Base Sepolia' }] as const
export const getUnit = (slug: string) => RWA_UNITS.find((unit) => unit.slug === slug.toLowerCase())
export type RwaUnitDefinition = (typeof RWA_UNITS)[number]
export const RWA_QUOTE_ASSET = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const

export const RWA_STACK = [
  { label: 'Uniswap Permissioned Pools', status: 'Audited', lines: ['The standard for markets with holder rules.', 'Shared market and compliance plumbing.'] },
  { label: 'The issuer', status: 'Built', lines: ['The issuer supplies the asset, holder rules and dated appraisal.', 'This role is a test fixture today.'] },
  { label: 'Mintware', status: 'Live on testnet', lines: ['The shared MarketEngine runs each asset’s market.', 'Our hook enforces appraisal and permission rules.', 'The app brings the unit into view.'] },
] as const

export const RWA_STACK_DISCLOSURE = 'Testnet demonstration on Base Sepolia, with a fictional asset and valueless test tokens. Uniswap’s own contracts are audited; Mintware’s composition with them is unaudited.'

const rwaDeployment = deployments.testnet['base-sepolia']
export const RWA_STACK_CONTRACTS = [
  { name: 'MarketEngine', address: rwaDeployment.RwaOwnedPool_Engine.address, explorer: 'https://sepolia.basescan.org' },
  // Preserve the former demo.ts explorer convention for the CREATE2-deployed hook.
  { name: 'Appraisal / permission hook', address: rwaDeployment.RwaOwnedPool_AppraisalHook.address, explorer: 'https://base-sepolia.blockscout.com' },
  { name: 'Permissions adapter', address: rwaDeployment.RwaOwnedPool_PermissionsAdapter.address, explorer: 'https://sepolia.basescan.org' },
  { name: 'Permissions adapter factory', address: rwaDeployment.RwaOwnedPool_PermissionsAdapterFactory.address, explorer: 'https://sepolia.basescan.org' },
] as const
