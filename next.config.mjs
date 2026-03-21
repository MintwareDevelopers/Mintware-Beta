/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never expose source maps in production — prevents reverse-engineering
  productionBrowserSourceMaps: false,

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
}

export default nextConfig
