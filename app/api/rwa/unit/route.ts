import { createPublicClient, http, isAddress, zeroAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getUnit } from '@/lib/rwa/units'
import { readRwaUnit, type RwaUnitLive } from '@/lib/rwa/read'

export const dynamic = 'force-dynamic'
const cache = new Map<string, { at: number; body: RwaUnitLive }>()

export const GET = createHandler(async (req, ctx) => {
  const unit = getUnit(req.nextUrl.searchParams.get('unit') ?? 'wcp7')
  if (!unit) return ctx.json({ ok: false, error: 'unit_not_found' }, 404)
  const engine = process.env.RWA_OWNED_ENGINE_ADDRESS
  if (!engine) return ctx.json({ ok: true, source: 'undeployed', block: null, blockTime: null, engine: null, hook: null })
  if (!isAddress(engine) || engine === zeroAddress) return ctx.json({ ok: false, error: 'engine_configuration_invalid' }, 503)
  const account = req.nextUrl.searchParams.get('account')
  if (account && !isAddress(account)) return ctx.json({ ok: false, error: 'invalid_account' }, 400)
  const key = `${engine.toLowerCase()}:${account?.toLowerCase() ?? ''}`
  const previous = cache.get(key)
  if (previous && Date.now() - previous.at < 10_000) return ctx.json(previous.body)
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RWA_RPC_URL ?? 'https://sepolia.base.org', { timeout: 10_000 }) })
    // Refuse an RPC on another chain, even if addresses happen to contain code there.
    if (await client.getChainId() !== unit.chainId) throw new Error('wrong_chain')
    const body = await readRwaUnit(client, engine, account && isAddress(account) ? account : undefined)
    if (cache.size >= 100) cache.delete(cache.keys().next().value!)
    cache.set(key, { at: Date.now(), body })
    return ctx.json(body)
  } catch (error) {
    ctx.log.warn('rwa', 'owned engine read failed', { error: String(error) })
    return previous ? ctx.json({ ...previous.body, source: 'cached' }) : ctx.json({ ok: false, error: 'read_unavailable' }, 503)
  }
}, { rateLimit: { max: 60, windowMs: 60_000 } })
