import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base, arbitrum } from 'wagmi/chains'
import { coreChain } from '@/config/chains'

export const wagmiConfig = getDefaultConfig({
  appName: 'Mintware',
  projectId: '580f461c981a43d53fc25fe59b64306b',
  chains: [mainnet, base, arbitrum, coreChain],
  ssr: true,
})
