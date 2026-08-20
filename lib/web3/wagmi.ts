import { createConfig } from '@privy-io/wagmi'
import { mainnet, base, arbitrum, baseSepolia } from 'wagmi/chains'
import { cookieStorage, createStorage, http } from 'wagmi'

// Privy is the single wallet/auth layer. It manages connectors (external wallets
// + embedded) itself, so we build the wagmi config with Privy's createConfig —
// no RainbowKit getDefaultConfig, no manually-declared connectors. The WalletConnect
// project id lives in the Privy dashboard, not here.
export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, baseSepolia],
  // Pinned public RPCs — browser-reachable (CORS-enabled) and matched to the CSP
  // connect-src allowlist. Mainnet uses publicnode: eth.merkle.io sends no CORS
  // header and cloudflare-eth.com is deprecated (both broke browser mainnet reads,
  // e.g. ENS/basename resolution).
  transports: {
    [mainnet.id]:     http('https://ethereum-rpc.publicnode.com'),
    [base.id]:        http('https://mainnet.base.org'),
    [arbitrum.id]:    http('https://arb1.arbitrum.io/rpc'),
    // sepolia.base.org is unreliable (load-balanced nodes drop reads) — publicnode is stable.
    [baseSepolia.id]: http('https://base-sepolia-rpc.publicnode.com'),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
})
