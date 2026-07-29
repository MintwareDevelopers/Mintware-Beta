import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never expose source maps in production — prevents reverse-engineering
  productionBrowserSourceMaps: false,

  // Disable Turbopack for production builds (use webpack) — Turbopack panics on 16.1.6 prod build
  bundlePagesRouterDependencies: true,

  async redirects() {
    return [{ source: '/dashboard', destination: '/rewards', permanent: true }]
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
          // Block embedding in iframes from any origin
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
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
