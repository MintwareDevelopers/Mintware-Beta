// GET /api/proof/vault — reads the LIVE current total assets of the Arc testnet YPN vault via a single
// eth_call, so the public /proof page can show on-chain state "as of now" alongside the recorded run.
// Public, read-only, best-effort: on any RPC hiccup it returns { ok:false } and the page falls back to
// the recorded snapshot. Testnet + unaudited.

import { createHandler } from '@/lib/web2/routeHandler'
import { LATEST_RUN } from '@/lib/proof/latestRun'

export const dynamic = 'force-dynamic'

const ARC_RPC = 'https://rpc.testnet.arc.io'
const TOTAL_ASSETS_SELECTOR = '0x01e1d114' // totalAssets()

export const GET = createHandler(async (_req, ctx) => {
  const vault = LATEST_RUN.liveVault.address
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(ARC_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: vault, data: TOTAL_ASSETS_SELECTOR }, 'latest'],
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)
    const json = (await res.json()) as { result?: string; error?: unknown }
    if (!json?.result || json.result === '0x') {
      return ctx.json({ ok: false })
    }
    // uint256 (6dp USDC) → human string with 2 decimals.
    const raw = BigInt(json.result)
    const usdc = Number(raw) / 1e6
    return ctx.json({
      ok: true,
      vault,
      totalAssetsUsdc: usdc.toFixed(2),
      totalAssetsRaw: raw.toString(),
    })
  } catch (err) {
    ctx.log.warn('proof', 'live vault read failed', { err: String(err) })
    return ctx.json({ ok: false })
  }
})
