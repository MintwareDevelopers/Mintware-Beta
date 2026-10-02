// GET /api/rwa/unit?unit=<slug> — V2-RWAs: LIVE on-chain state of one demo RWA liquidity unit (Base Sepolia
// `wcp7` by default; XRPL EVM testnet `wcp7-xrpl`). Reads the vault / lending adapter / appraisal hook directly
// (no DB), plus the pool's swap history, the demo router's trade events and the hook's appraisal events, so the
// market page shows the chain as of now. Gated: 404 unless the V2-RWAs flag is on AND the visitor passes the V2
// gate. Best-effort: an RPC hiccup returns { ok:false }; the page then shows its recorded proof run (legs +
// contracts) but no live numbers. All state reads are pinned to ONE block. Testnet + unaudited.

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbi, parseAbiItem, defineChain, type Log, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { canSeeRwa } from '@/lib/v2/rwaGate'
import { getUnit, tickToUsd, RWA_UNITS, type RwaUnit } from '@/lib/rwa/demo'

export const dynamic = 'force-dynamic'

const xrplEvmTestnet = defineChain({
  id: 1449000, name: 'XRPL EVM Testnet', nativeCurrency: { name: 'XRP', symbol: 'XRP', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.xrplevm.org'] } },
})

// Per network: the head/state RPC and the history RPC (sepolia.base.org caps eth_getLogs at 1,000 blocks).
const RPCS: Record<RwaUnit['network'], { chain: typeof baseSepolia | typeof xrplEvmTestnet; rpc: string; logs: string }> = {
  'base-sepolia': {
    chain: baseSepolia,
    rpc: process.env.RWA_RPC_URL ?? 'https://sepolia.base.org',
    logs: process.env.RWA_LOGS_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com',
  },
  'xrpl-evm-testnet': {
    chain: xrplEvmTestnet,
    rpc: process.env.RWA_XRPL_RPC_URL ?? 'https://rpc.testnet.xrplevm.org',
    logs: process.env.RWA_XRPL_LOGS_RPC_URL ?? process.env.RWA_XRPL_RPC_URL ?? 'https://rpc.testnet.xrplevm.org',
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

async function logsInChunks<T>(get: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, step = 9_000n): Promise<T[]> {
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
  if (!canSeeRwa(req.cookies)) return ctx.json({ ok: false, error: 'not_found' }, 404)
  const u = getUnit(req.nextUrl.searchParams.get('unit') ?? RWA_UNITS[0].slug)
  if (!u) return ctx.json({ ok: false, error: 'unknown_unit' }, 404)
  const k = contextFor(u)
  const fresh = req.nextUrl.searchParams.get('fresh') === '1' // right after a live trade: skip the cache
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

    // Logs node may trail the head node by a block or two — scan to a safe depth behind head.
    const { swaps, demoSwaps, appraisals } = await k.history(head.number - 2n)

    // Block timestamps for every block that carries an event (bounded: a demo market, not a busy pool).
    const blocks = [...new Set([...swaps, ...appraisals].map((l) => l.blockNumber as bigint))].slice(-200)
    const stamps = new Map<bigint, number>()
    await Promise.all(blocks.map(async (n) => stamps.set(n, Number((await client.getBlock({ blockNumber: n })).timestamp))))
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
    return ctx.json({ ok: false })
  }
}, { rateLimit: { max: 60, windowMs: 60_000 } })
