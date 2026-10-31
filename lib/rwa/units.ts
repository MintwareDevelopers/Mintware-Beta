export const RWA_UNITS = [{ slug: 'wcp7', name: 'Property unit', symbol: 'WCP7', chainId: 84532, chainName: 'Base Sepolia' }] as const
export const getUnit = (slug: string) => RWA_UNITS.find((unit) => unit.slug === slug.toLowerCase())
export type RwaUnitDefinition = (typeof RWA_UNITS)[number]
export const RWA_QUOTE_ASSET = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const
