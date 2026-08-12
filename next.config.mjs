import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Content-Security-Policy — shipped in REPORT-ONLY first (reports violations,
// blocks nothing) so the allowlist can be verified against real wallet/connect/
// swap flows before switching to enforcing. Server-side hosts (li.quest, coingecko,
// zerion, nansen, pyth, easscan) are intentionally EXCLUDED — they're API-route
// calls, not browser calls. RPC hosts are pinned in lib/web3/wagmi.ts to match.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "connect-src 'self' blob: data: https://attribution-scorer.ceo-1f9.workers.dev " +
    'https://mainnet.base.org https://sepolia.base.org https://arb1.arbitrum.io https://ethereum-rpc.publicnode.com ' +
    'https://*.supabase.co wss://*.supabase.co https://*.privy.io https://*.privy.systems ' +
    'wss://relay.walletconnect.org wss://relay.walletconnect.com https://relay.walletconnect.com ' +
    'https://explorer-api.walletconnect.com https://api.web3modal.org https://pulse.walletconnect.org ' +
    'https://verify.walletconnect.com https://verify.walletconnect.org ' +
    'https://keys.coinbase.com wss://www.walletlink.org https://cca-lite.coinbase.com https://chain-proxy.wallet.coinbase.com ' +
    'https://metamask-sdk-socket.metafi.codefi.network wss://metamask-sdk-socket.metafi.codefi.network ' +
    'https://va.vercel-scripts.com',
  "img-src 'self' data: https:", // token/campaign/avatar logos are unbounded hosts
  "font-src 'self' data:",       // next/font self-hosts
  "style-src 'self' 'unsafe-inline'", // RainbowKit/Sonner/inline attrs — unavoidable
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com",
  "frame-src 'self' https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join('; ') + ';'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never expose source maps in production — prevents reverse-engineering
  productionBrowserSourceMaps: false,

  // Disable Turbopack for production builds (use webpack) — Turbopack panics on 16.1.6 prod build
  bundlePagesRouterDependencies: true,

  async redirects() {
    return [
      { source: '/dashboard', destination: '/app/rewards', permanent: true },
      // Vault action pages moved into the gated /app tier (IA Phase 1). `create`
      // must precede `:id` so it isn't captured as an id.
      { source: '/vault/create', destination: '/app/vault/create', permanent: true },
      { source: '/vault/:id', destination: '/app/vault/:id', permanent: true },
      // Functional app pages moved into the /app tier (IA Phase 1). Query params
      // (e.g. /swap?cid=, ?ref=) are preserved through Next redirects.
      { source: '/swap', destination: '/app/swap', permanent: true },
      { source: '/leaderboard', destination: '/app/leaderboard', permanent: true },
      { source: '/profile', destination: '/app/profile', permanent: true },
      { source: '/create-campaign', destination: '/app/create-campaign', permanent: true },
      { source: '/manage/:campaign_id', destination: '/app/manage/:campaign_id', permanent: true },
      { source: '/rewards', destination: '/app/rewards', permanent: true },
    ]
  },

  images: {
    unoptimized: true,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking
          { key: 'X-Frame-Options',       value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          // Block embedding in iframes from any origin (enforced)
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
          // Full CSP in report-only — observe violations, then promote to enforcing
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
        ],
      },
    ]
  },

  webpack(config, { isServer }) {
    config.resolve ??= {}
    config.resolve.alias ??= {}

    // Privy treats this as optional, but webpack still warns when it is absent.
    config.resolve.alias['@farcaster/mini-app-solana'] = path.join(
      __dirname,
      'lib/shims/farcaster-mini-app-solana.ts',
    )

    if (isServer) {
      // Torus broadcast channels are browser-only and trigger indexedDB noise during static generation.
      config.resolve.alias['@toruslabs/broadcast-channel'] = path.join(
        __dirname,
        'lib/shims/torus-broadcast-channel.ts',
      )
    }

    return config
  },
}

export default nextConfig
