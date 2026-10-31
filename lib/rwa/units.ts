export const RWA_UNITS = [{ slug: 'wcp7', name: 'Property unit', symbol: 'WCP7', chainId: 84532, chainName: 'Base Sepolia' }] as const
export const getUnit = (slug: string) => RWA_UNITS.find((unit) => unit.slug === slug.toLowerCase())
