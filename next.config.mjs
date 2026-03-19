/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Set Turbopack workspace root to this worktree so that route discovery
  // uses this worktree's app/ directory, not the main repo's app/.
  // Node module resolution still finds node_modules via parent directory walk.
  turbopack: {
    root: '/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/.claude/worktrees/ecstatic-lewin',
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
