// GET /api/x402/supported — advertise the facilitator's schemes + networks (x402 discovery).
// Spec: docs/developers/agentkit-compute-402-spec.md §6.2.

import { createHandler } from '@/lib/web2/routeHandler'
import { getFacilitator, supportedNetworks } from '@/lib/x402/config'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (_req, ctx) => {
  const f = getFacilitator()
  const supported = f
    ? await f.supported()
    : { schemes: ['exact', 'deferred'] as string[], networks: supportedNetworks() }
  return ctx.json({ x402Version: 2, ...supported })
})
