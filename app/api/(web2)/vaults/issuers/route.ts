// GET /api/vaults/issuers            — list issuers (for the RWA create dropdown)
// GET /api/vaults/issuers?verified=1 — only VERIFIED issuers (eligible to publish)
// Auth: none (public issuer directory).

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const verifiedOnly = ['1', 'true'].includes(req.nextUrl.searchParams.get('verified') ?? '')
  try {
    const { dbListIssuers } = await import('@/lib/rwa/db')
    const issuers = await dbListIssuers(verifiedOnly)
    if (issuers) return ctx.json({ issuers })
  } catch { /* table missing → fall through to empty */ }
  // No issuers table / none yet — return empty so the UI shows the honest
  // "no verified issuers — contact Mintware to onboard" state.
  return ctx.json({ issuers: [] })
})
