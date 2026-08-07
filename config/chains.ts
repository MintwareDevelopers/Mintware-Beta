import { mainnet, base, arbitrum } from 'wagmi/chains'
import type { Chain } from 'viem'

export type SwapProvider = 'lifi'

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
]

export const getChainConfig = (chainId: number): ChainConfig | undefined =>
  SUPPORTED_CHAINS.find(c => c.chain.id === chainId)
