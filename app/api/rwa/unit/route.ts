// GET /api/rwa/unit?unit=<slug> — V2-RWAs: LIVE on-chain state of one demo RWA liquidity unit (Base Sepolia
// `wcp7`). Reads the vault / lending adapter / appraisal hook directly
// (no DB), plus the pool's swap history, the demo router's trade events and the hook's appraisal events, so the
// market page shows the chain as of now. Public and read-only; the cache bypass is operator-only. Never blank:
// state reads and history fail independently (history is best-effort), an RPC outage serves the last good read
// (`source:'cached'`), and a cold instance with no read at all serves the recorded run (`source:'recorded'`).
// All state reads are pinned to ONE block. Testnet + unaudited.

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbi, parseAbiItem, type Log, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { canSeeRwa } from '@/lib/v2/rwaGate'
import { getUnit, tickToUsd, RWA_UNITS, type RwaUnit } from '@/lib/rwa/demo'

export const dynamic = 'force-dynamic'

// Per network: the head/state RPC and the history RPC. publicnode by default — sepolia.base.org rate-limits the
// route's parallel reads and caps eth_getLogs at 1,000 blocks.
const RPCS: Record<RwaUnit['network'], { chain: typeof baseSepolia; rpc: string; logs: string }> = {
  'base-sepolia': {
    chain: baseSepolia,
    rpc: process.env.RWA_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com',
    logs: process.env.RWA_LOGS_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com',
  },
}

const VAULT = parseAbi([
  'function totalSeniorAssets() view returns (uint256)',
  'function deployedFromSenior() view returns (uint256)',
  'function totalSeniorShares() view returns (uint256)',
  'function juniorTokens() view returns (uint256)',
  'function juniorUsdcBuffer() view returns (uint256)',
  'function lockExpiry() view returns (uint256)',
])
const LEND = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function pendingInterest() view returns (uint256)',
  'function aprBps() view returns (uint256)',
  'function totalInterestMinted() view returns (uint256)',
])
const HOOK = parseAbi([
  'function bandStatus() view returns (int24 spotTick, int24 appraisal, uint256 deviationTicks, bool inCore, bool inSpec, bool fresh)',
  'function appraisedAt() view returns (uint64)',
  'function tradingPaused() view returns (bool)',
  'function oracleReady() view returns (bool)',
])
const SWAP_EVT = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)')
const DEMO_SWAP_EVT = parseAbiItem('event DemoSwap(address indexed trader, bool zeroForOne, uint256 amountIn, uint256 amountOut)')
const APPRAISAL_EVT = parseAbiItem('event AppraisalPosted(int24 tick, int24 previousTick, uint64 at, address indexed by)')

const usd6 = (v: bigint) => Number(v) / 1e6
const prop18 = (v: bigint) => Number(v) / 1e18
const A = (s: string) => s as `0x${string}`

async function logsInChunks<T>(get: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, step = 49_999n): Promise<T[]> {
  const ranges: [bigint, bigint][] = []
  for (let a = from; a <= to; a += step + 1n) ranges.push([a, a + step > to ? to : a + step])
  const out: T[][] = []
  for (let i = 0; i < ranges.length; i += 6) out.push(...(await Promise.all(ranges.slice(i, i + 6).map(([a, b]) => get(a, b)))))
  return out.flat()
}

/** Everything one unit needs, built once per warm instance: clients, pool id, incremental history, response cache. */
function makeContext(u: RwaUnit) {
  const net = RPCS[u.network]
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpc, { timeout: 8_000 }) }) as PublicClient
  const logsClient = createPublicClient({ chain: net.chain, transport: http(net.logs, { timeout: 10_000 }) }) as PublicClient
  const d = u.demo
  const c = d.contracts
  const poolId = keccak256(encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }],
    [d.poolKey as never],
  ))
  const getSwaps = (a: bigint, b: bigint) => logsClient.getLogs({ address: A(c.poolManager), event: SWAP_EVT, args: { id: poolId }, fromBlock: a, toBlock: b })
  const getDemoSwaps = (a: bigint, b: bigint) => logsClient.getLogs({ address: A(c.router), event: DEMO_SWAP_EVT, fromBlock: a, toBlock: b })
  const getAppraisals = (a: bigint, b: bigint) => logsClient.getLogs({ address: A(c.hook), event: APPRAISAL_EVT, fromBlock: a, toBlock: b })
  type Hist = {
    scannedTo: bigint
    swaps: Awaited<ReturnType<typeof getSwaps>>
    demoSwaps: Awaited<ReturnType<typeof getDemoSwaps>>
    appraisals: Awaited<ReturnType<typeof getAppraisals>>
  }
  let fromBlockCache: bigint | null = null
  let hist: Hist | null = null
  const ctx = {
    unit: u, client, cache: null as { at: number; body: unknown } | null,
    /** block → timestamp, kept across requests so each block is fetched once per warm instance */
    stamps: new Map<bigint, number>(),
    async fromBlock(): Promise<bigint> {
      if (fromBlockCache !== null) return fromBlockCache
      const known = d.deployTxs.map((t) => t.block).filter((b): b is number => typeof b === 'number')
      fromBlockCache = known.length ? BigInt(Math.min(...known))
        : (await client.getTransactionReceipt({ hash: A(d.deployTxs[0].hash) })).blockNumber
      return fromBlockCache
    },
    async history(head: bigint): Promise<Hist> {
      const start = hist ? hist.scannedTo + 1n : await ctx.fromBlock()
      const h: Hist = hist ?? { scannedTo: start - 1n, swaps: [], demoSwaps: [], appraisals: [] }
      if (start > head) return h
      const [swaps, demoSwaps, appraisals] = await Promise.all([
        logsInChunks(getSwaps, start, head), logsInChunks(getDemoSwaps, start, head), logsInChunks(getAppraisals, start, head),
      ])
      hist = { scannedTo: head, swaps: [...h.swaps, ...swaps], demoSwaps: [...h.demoSwaps, ...demoSwaps], appraisals: [...h.appraisals, ...appraisals] }
      return hist
    },
  }
  return ctx
}
const contexts = new Map<string, ReturnType<typeof makeContext>>()
const contextFor = (u: RwaUnit) => contexts.get(u.slug) ?? (contexts.set(u.slug, makeContext(u)), contexts.get(u.slug)!)

export const GET = createHandler(async (req, ctx) => {
  const u = getUnit(req.nextUrl.searchParams.get('unit') ?? RWA_UNITS[0].slug)
  if (!u) return ctx.json({ ok: false, error: 'unknown_unit' }, 404)
  const k = contextFor(u)
  // Public read (the /v1/rwas demo). Only an unlocked operator (the live-trade path) may bypass the cache.
  const fresh = req.nextUrl.searchParams.get('fresh') === '1' && canSeeRwa(req.cookies)
  if (!fresh && k.cache && Date.now() - k.cache.at < 10_000) return ctx.json(k.cache.body)

  const d = u.demo
  const c = d.contracts
  const propIs0 = d.propertyIsCurrency0
  const px = (t: number) => tickToUsd(t, propIs0)
  try {
    const client = k.client
    const head = await client.getBlock()
    const pinned = head.number - 1n // one block back: a load-balanced backend may not have `head` yet
    const read = <T,>(address: string, abi: typeof VAULT | typeof LEND | typeof HOOK, functionName: string) =>
      client.readContract({ address: A(address), abi, functionName, blockNumber: pinned } as never) as Promise<T>
    const [senior, deployed, shares, juniorTokens, juniorUsd, lockExpiry, lendAssets, pending, apr, minted, band, appraisedAt, paused, oracleReadyRaw] =
      await Promise.all([
        read<bigint>(c.vault, VAULT, 'totalSeniorAssets'), read<bigint>(c.vault, VAULT, 'deployedFromSenior'),
        read<bigint>(c.vault, VAULT, 'totalSeniorShares'), read<bigint>(c.vault, VAULT, 'juniorTokens'),
        read<bigint>(c.vault, VAULT, 'juniorUsdcBuffer'), read<bigint>(c.vault, VAULT, 'lockExpiry'),
        read<bigint>(c.adapter, LEND, 'totalAssets'), read<bigint>(c.adapter, LEND, 'pendingInterest'),
        read<bigint>(c.adapter, LEND, 'aprBps'), read<bigint>(c.adapter, LEND, 'totalInterestMinted'),
        read<readonly [number, number, bigint, boolean, boolean, boolean]>(c.hook, HOOK, 'bandStatus'),
        read<bigint>(c.hook, HOOK, 'appraisedAt'), read<boolean>(c.hook, HOOK, 'tradingPaused'),
        read<boolean>(c.hook, HOOK, 'oracleReady').catch(() => null),
      ])
    const [spotTick, appraisalTick, deviationTicks, inCore, inSpec, freshAppraisal] = band

    // History is best-effort: a logs-RPC failure must not blank the state reads above. Logs node may trail the
    // head node by a block or two — scan to a safe depth behind head.
    const { swaps, demoSwaps, appraisals, historyOk } = await k.history(head.number - 2n)
      .then((h) => ({ ...h, historyOk: true }))
      .catch((err) => {
        ctx.log.warn('rwa', 'history read failed', { unit: u.slug, err: String(err) })
        return { swaps: [], demoSwaps: [], appraisals: [], historyOk: false }
      })

    // Block timestamps for the most recent event blocks (bounded, cached across requests).
    const stamps = k.stamps
    const blocks = [...new Set([...swaps, ...appraisals].map((l) => l.blockNumber as bigint))].slice(-200).filter((n) => !stamps.has(n))
    await Promise.all(blocks.slice(-60).map(async (n) => {
      const b = await client.getBlock({ blockNumber: n }).catch(() => null)
      if (b) stamps.set(n, Number(b.timestamp))
    }))
    const ts = (l: Log) => stamps.get(l.blockNumber as bigint) ?? null

    const traderByTx = new Map(demoSwaps.map((l) => [l.transactionHash, l.args.trader as string]))
    const trades = swaps
      .filter((l) => l.args.sender?.toLowerCase() === c.router.toLowerCase())
      .map((l) => {
        const a0 = l.args.amount0 as bigint
        const a1 = l.args.amount1 as bigint
        // v4's Swap event reports the SWAPPER's balance delta: negative = the trader paid that currency.
        const propDelta = propIs0 ? a0 : a1
        const usdDelta = propIs0 ? a1 : a0
        return {
          tx: l.transactionHash, block: Number(l.blockNumber), ts: ts(l),
          trader: traderByTx.get(l.transactionHash) ?? null,
          side: propDelta < 0n ? 'sell' : 'buy',
          usd: Math.abs(usd6(usdDelta)),
          units: Math.abs(prop18(propDelta)),
          priceUsd: px(Number(l.args.tick)),
        }
      })
      .reverse()

    const priceSeries = swaps.map((l) => ({ block: Number(l.blockNumber), ts: ts(l), usd: px(Number(l.args.tick)), tick: Number(l.args.tick), byVault: l.args.sender?.toLowerCase() === c.vault.toLowerCase() }))
    const appraisalSeries = appraisals.map((l) => ({ block: Number(l.blockNumber), ts: ts(l), usd: px(Number(l.args.tick)), tick: Number(l.args.tick) }))

    const cfg = d.hookConfig
    const bandUsd = (t: number) => {
      const lo = px(Number(appraisalTick) - t), hi = px(Number(appraisalTick) + t)
      return [Math.min(lo, hi), Math.max(lo, hi)]
    }

    const body = {
      ok: true,
      source: 'live' as const,
      historyOk,
      unit: u.slug,
      chainId: d.chainId,
      chainName: u.chain.name,
      block: Number(head.number),
      blockTime: Number(head.timestamp),
      appraisal: {
        tick: Number(appraisalTick), usd: px(Number(appraisalTick)), at: Number(appraisedAt), fresh: freshAppraisal,
        oracleReady: oracleReadyRaw ?? freshAppraisal, // older hooks (no exit window) ⇒ ready iff fresh
        maxAgeSecs: cfg?.maxAppraisalAge ?? null, minUpdateSecs: cfg?.minUpdateInterval ?? null,
      },
      spot: { tick: Number(spotTick), usd: px(Number(spotTick)), deviationTicks: Number(deviationTicks), inCore, inSpec },
      band: cfg ? { core: bandUsd(cfg.coreBandTicks), spec: bandUsd(cfg.specBandTicks), coreFeePct: cfg.coreFeePips / 1e4, specFeePct: cfg.specFeePips / 1e4 } : null,
      tradingPaused: paused,
      vault: {
        seniorUsd: usd6(senior), deployedUsd: usd6(deployed), seniorShares: shares.toString(),
        juniorUnits: prop18(juniorTokens), juniorUsd: usd6(juniorUsd), lockExpiry: Number(lockExpiry),
      },
      lending: {
        balanceUsd: usd6(lendAssets), pendingUsd: usd6(pending), aprPct: Number(apr) / 100,
        interestMintedUsd: usd6(minted), simulated: true,
      },
      trades: trades.slice(0, 40),
      tradeCount: trades.length,
      priceSeries,
      appraisalSeries,
    }
    k.cache = { at: Date.now(), body }
    return ctx.json(body)
  } catch (err) {
    ctx.log.warn('rwa', 'live unit read failed', { unit: u.slug, err: String(err) })
    // Never blank the page: the last good read on this instance, else the recorded run.
    if (k.cache) return ctx.json({ ...(k.cache.body as object), source: 'cached' })
    return ctx.json(recordedBody(u))
  }
}, { rateLimit: { max: 60, windowMs: 60_000 } })

/** The recorded run as a read: launch appraisal + the lifecycle script's final vault/lending snapshot. */
function recordedBody(u: RwaUnit) {
  const d = u.demo
  const propIs0 = d.propertyIsCurrency0
  const appraisalUsd = d.property.appraisalUsdAtLaunch
  const tick = Math.round(Math.log(propIs0 ? appraisalUsd / 1e12 : 1e12 / appraisalUsd) / Math.log(1.0001))
  const n = (k: string) => Number(d.snapshot[k] ?? 0)
  const at = Math.floor(new Date(d.generatedAt).getTime() / 1000)
  const cfg = d.hookConfig
  const bandUsd = (t: number) => {
    const lo = tickToUsd(tick - t, propIs0), hi = tickToUsd(tick + t, propIs0)
    return [Math.min(lo, hi), Math.max(lo, hi)]
  }
  return {
    ok: true,
    source: 'recorded' as const,
    historyOk: false,
    unit: u.slug,
    chainId: d.chainId,
    chainName: u.chain.name,
    block: 0,
    blockTime: at,
    appraisal: { tick, usd: appraisalUsd, at, fresh: true, oracleReady: true, maxAgeSecs: cfg?.maxAppraisalAge ?? null, minUpdateSecs: cfg?.minUpdateInterval ?? null },
    spot: { tick, usd: appraisalUsd, deviationTicks: 0, inCore: true, inSpec: true },
    band: cfg ? { core: bandUsd(cfg.coreBandTicks), spec: bandUsd(cfg.specBandTicks), coreFeePct: cfg.coreFeePips / 1e4, specFeePct: cfg.specFeePips / 1e4 } : null,
    tradingPaused: false,
    vault: { seniorUsd: n('seniorAssets'), deployedUsd: n('deployedFromSenior'), seniorShares: '0', juniorUnits: 0, juniorUsd: 0, lockExpiry: 0 },
    lending: { balanceUsd: n('lendingBalance'), pendingUsd: 0, aprPct: 0, interestMintedUsd: n('interestMinted'), simulated: true },
    trades: [],
    tradeCount: 0,
    priceSeries: [],
    appraisalSeries: [],
  }
}
