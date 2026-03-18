/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Explicitly set Turbopack workspace root to prevent it from picking up
  // route files from .claude/worktrees/hungry-moore (which has its own
  // pnpm-lock.yaml and app/api/ overrides).
  turbopack: {
    root: '/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build',
  },
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/index.html',
      },
    ]
  },
}

export default nextConfig
