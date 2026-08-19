import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Content-Security-Policy — now ENFORCED (was report-only; promoted after validating the
// allowlist against wallet-connect + swap flows — no connect/frame/img violations). Server-side
// hosts (li.quest, coingecko, zerion, nansen, pyth, easscan) are intentionally EXCLUDED — they're
// API-route calls, not browser calls. RPC hosts are pinned in lib/web3/wagmi.ts to match.
// Note: `script-src` still allows 'unsafe-inline' (Next/wallet inline attrs) — a follow-up can
// tighten it to nonces. 'unsafe-eval' is deliberately NOT allowed (the dev-only HMR eval
// violations don't occur in a production build).
const CSP_ENFORCED = [
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
        // Everything EXCEPT the read-only public solvency badge stays frame-blocked.
        source: '/((?!org/[^/]+/badge).*)',
        headers: [
          // Prevent clickjacking
          { key: 'X-Frame-Options',       value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 2 years incl. subdomains (no `preload` yet — that's a separate,
          // hard-to-reverse submission). Safe: the app is already HTTPS-only on Vercel.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Deny powerful features this DeFi app's own origin never uses (wallet QR scanning
          // happens in the wallet app, not our page) + opt out of Topics/FLoC. Deliberately does
          // NOT set Cross-Origin-Opener-Policy: that would break Privy's popup login flow.
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), browsing-topics=()' },
          // Full CSP now ENFORCED (promoted from report-only). Validated against wallet-connect
          // + swap flows: no connect-src/frame-src/img-src violations. The only report-only
          // violations were dev-only `unsafe-eval` from HMR/Fast Refresh (not emitted by a prod
          // build) — deliberately NOT allowed, so eval-based XSS stays blocked. This policy
          // includes `frame-ancestors 'none'`, so the separate frame-only header is now redundant.
          { key: 'Content-Security-Policy', value: CSP_ENFORCED },
        ],
      },
      {
        // The embeddable treasury badge (#6): read-only public data, no auth, no actions → safe to frame
        // anywhere. Deliberately omits X-Frame-Options (which has no "allow-any") and opens frame-ancestors.
        source: '/org/:slug/badge',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
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
