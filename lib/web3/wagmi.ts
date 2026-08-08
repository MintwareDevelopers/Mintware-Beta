import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base, arbitrum, baseSepolia } from 'wagmi/chains'
import { cookieStorage, createStorage, http } from 'wagmi'

export const wagmiConfig = getDefaultConfig({
  appName: 'Mintware',
  projectId: '580f461c981a43d53fc25fe59b64306b',
  chains: [mainnet, base, arbitrum, baseSepolia],
  // Pin the public RPC per chain so the browser's connect-src hosts are
  // deterministic + match the CSP allowlist (these are the current viem defaults).
  transports: {
    [mainnet.id]:     http('https://eth.merkle.io'),
    [base.id]:        http('https://mainnet.base.org'),
    [arbitrum.id]:    http('https://arb1.arbitrum.io/rpc'),
    [baseSepolia.id]: http('https://sepolia.base.org'),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
})
