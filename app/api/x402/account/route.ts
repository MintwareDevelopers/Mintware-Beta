// GET /api/x402/account?address=0x… — an agent's capital-parking account: how much USDC is parked (and
// earning) in the YPN yield vault, and how much is spendable in place right now. Reads the Arc vault live
// (convertToAssets(shares(agent))). Spec: docs/developers/agentkit-compute-402-spec.md.

import { createHandler } from '@/lib/web2/routeHandler'
import { readAgentTreasury, formatUsdc } from '@/lib/x402/treasury'
import { rpcParkedReader } from '@/lib/x402/vaultReader'
import { httpSpendableSource } from '@/lib/x402/edgeHttp'
import { ARC_TESTNET, ARC_TESTNET_DEPLOYMENT } from '@/config/arc'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[0-9a-fA-F]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const address = new URL(req.url).searchParams.get('address')
  if (!address || !EVM_RE.test(address)) return ctx.json({ error: 'valid ?address= required' }, 400)

  const rpcUrl = process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl
  const vault = process.env.NEXT_PUBLIC_ARC_VAULT_ADDRESS ?? ARC_TESTNET_DEPLOYMENT.vault
  const reader = rpcParkedReader({ rpcUrl, vault })

  // When edge-auth is configured, spendable reflects live holds/caps (GET /available/:user); otherwise it
  // degrades to the full parked balance (parking does not lock).
  const spend =
    process.env.EDGE_AUTH_URL && process.env.EDGE_AUTH_SECRET
      ? httpSpendableSource({ url: process.env.EDGE_AUTH_URL, secret: process.env.EDGE_AUTH_SECRET })
      : undefined

  try {
    const treasury = await readAgentTreasury(address, reader, spend)
    return ctx.json({
      ...treasury,
      parkedUsdcFormatted: formatUsdc(treasury.parkedUsdc),
      spendableUsdcFormatted: formatUsdc(treasury.spendableUsdc),
      spendableLive: Boolean(spend),
      vault,
      network: 'arc',
    })
  } catch (e) {
    return ctx.json({ error: 'vault_read_failed', detail: String(e) }, 502)
  }
})
