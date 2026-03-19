import { mainnet, base, arbitrum } from 'wagmi/chains'
import type { Chain } from 'viem'

export const coreChain: Chain = {
  id: 1116,
  name: 'Core',
  nativeCurrency: { name: 'CORE', symbol: 'CORE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.coredao.org'] },
    public:  { http: ['https://rpc.coredao.org'] },
  },
  blockExplorers: {
    default: { name: 'Core Explorer', url: 'https://scan.coredao.org' },
  },
}

export type SwapProvider = 'lifi' | 'molten'

export interface ChainConfig {
  chain:        Chain
  swapProvider: SwapProvider
  feeRecipient: string
  feeBps:       number
  name:         string
  logoUrl:      string
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chain:        mainnet,
    swapProvider: 'lifi',
    feeRecipient: process.env.NEXT_PUBLIC_MINTWARE_TREASURY || '',
    feeBps:       50,
    name:         'Ethereum',
    logoUrl:      '/chains/eth.svg',
  },
  {
    chain:        base,
    swapProvider: 'lifi',
    feeRecipient: process.env.NEXT_PUBLIC_MINTWARE_TREASURY || '',
    feeBps:       50,
    name:         'Base',
    logoUrl:      '/chains/base.svg',
  },
  {
    chain:        arbitrum,
    swapProvider: 'lifi',
    feeRecipient: process.env.NEXT_PUBLIC_MINTWARE_TREASURY || '',
    feeBps:       50,
    name:         'Arbitrum',
    logoUrl:      '/chains/arbitrum.svg',
  },
  {
    chain:        coreChain,
    swapProvider: 'molten',
    feeRecipient: process.env.NEXT_PUBLIC_MINTWARE_TREASURY || '',
    feeBps:       50,
    name:         'Core',
    logoUrl:      '/chains/core.svg',
  },
]

export const getChainConfig = (chainId: number): ChainConfig | undefined =>
  SUPPORTED_CHAINS.find(c => c.chain.id === chainId)
