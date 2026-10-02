// GET /api/rwa/unit — V2-RWAs: LIVE on-chain state of the demo RWA liquidity unit on Base Sepolia.
// Reads the vault / lending adapter / appraisal hook directly (no DB), plus the pool's swap history, the
// demo router's trade events and the hook's appraisal events, so the market page shows the chain as of
// now. Gated: 404 unless the V2-RWAs flag is on AND the visitor passes the V2 gate. Best-effort: an RPC
// hiccup returns { ok:false } and the page falls back to the recorded proof run. Testnet + unaudited.

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbi, parseAbiItem, type Log } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible } from '@/lib/v2/rwaGate'
import { RWA_DEMO, tickToUsd } from '@/lib/rwa/demo'

export const dynamic = 'force-dynamic'

const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC, { timeout: 8_000 }) })
// History needs wide eth_getLogs ranges: sepolia.base.org caps them at 1,000 blocks, publicnode allows ~10k.
const LOGS_RPC = process.env.RWA_LOGS_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com'
const logsClient = createPublicClient({ chain: baseSepolia, transport: http(LOGS_RPC, { timeout: 10_000 }) })

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
])
const SWAP_EVT = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)')
const DEMO_SWAP_EVT = parseAbiItem('event DemoSwap(address indexed trader, bool zeroForOne, uint256 amountIn, uint256 amountOut)')
const APPRAISAL_EVT = parseAbiItem('event AppraisalPosted(int24 tick, int24 previousTick, uint64 at, address indexed by)')

const c = RWA_DEMO.contracts
const POOL_ID = keccak256(encodeAbiParameters(
  [{ type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }],
  [RWA_DEMO.poolKey as never],
))

const usd6 = (v: bigint) => Number(v) / 1e6
const prop18 = (v: bigint) => Number(v) / 1e18

let fromBlockCache: bigint | null = null
async function fromBlock(): Promise<bigint> {
  if (fromBlockCache !== null) return fromBlockCache
  const known = RWA_DEMO.deployTxs.map((t) => t.block).filter((b): b is number => typeof b === 'number')
  if (known.length) fromBlockCache = BigInt(Math.min(...known))
  else fromBlockCache = (await client.getTransactionReceipt({ hash: RWA_DEMO.deployTxs[0].hash as `0x${string}` })).blockNumber
  return fromBlockCache
}

async function logsInChunks<T>(get: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, step = 9_000n): Promise<T[]> {
  const ranges: [bigint, bigint][] = []
  for (let a = from; a <= to; a += step + 1n) ranges.push([a, a + step > to ? to : a + step])
  const out: T[][] = []
  for (let i = 0; i < ranges.length; i += 6) out.push(...(await Promise.all(ranges.slice(i, i + 6).map(([a, b]) => get(a, b)))))
  return out.flat()
}

// Incremental history: a warm instance only scans blocks it has not seen yet (a cold one scans from deploy).
const getSwaps = (a: bigint, b: bigint) => logsClient.getLogs({ address: c.poolManager as `0x${string}`, event: SWAP_EVT, args: { id: POOL_ID }, fromBlock: a, toBlock: b })
const getDemoSwaps = (a: bigint, b: bigint) => logsClient.getLogs({ address: c.router as `0x${string}`, event: DEMO_SWAP_EVT, fromBlock: a, toBlock: b })
const getAppraisals = (a: bigint, b: bigint) => logsClient.getLogs({ address: c.hook as `0x${string}`, event: APPRAISAL_EVT, fromBlock: a, toBlock: b })
type Hist = {
  scannedTo: bigint
  swaps: Awaited<ReturnType<typeof getSwaps>>
  demoSwaps: Awaited<ReturnType<typeof getDemoSwaps>>
  appraisals: Awaited<ReturnType<typeof getAppraisals>>
}
let hist: Hist | null = null
async function history(head: bigint): Promise<Hist> {
  const start = hist ? hist.scannedTo + 1n : await fromBlock()
  const h: Hist = hist ?? { scannedTo: start - 1n, swaps: [], demoSwaps: [], appraisals: [] }
  if (start > head) return h
  const [swaps, demoSwaps, appraisals] = await Promise.all([
    logsInChunks(getSwaps, start, head), logsInChunks(getDemoSwaps, start, head), logsInChunks(getAppraisals, start, head),
  ])
  hist = { scannedTo: head, swaps: [...h.swaps, ...swaps], demoSwaps: [...h.demoSwaps, ...demoSwaps], appraisals: [...h.appraisals, ...appraisals] }
  return hist
}

let cache: { at: number; body: unknown } | null = null

export const GET = createHandler(async (req, ctx) => {
  if (!isV2RwaVisible(req.cookies.get(V2_COOKIE)?.value)) return ctx.json({ ok: false, error: 'not_found' }, 404)
  const fresh = req.nextUrl.searchParams.get('fresh') === '1' // right after a live trade: skip the cache
  if (!fresh && cache && Date.now() - cache.at < 10_000) return ctx.json(cache.body)

  try {
    const head = await client.getBlock()
    const [senior, deployed, shares, juniorTokens, juniorUsd, lockExpiry, lendAssets, pending, apr, minted, band, appraisedAt, paused] =
      await Promise.all([
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'totalSeniorAssets' }),
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'deployedFromSenior' }),
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'totalSeniorShares' }),
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'juniorTokens' }),
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'juniorUsdcBuffer' }),
        client.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'lockExpiry' }),
        client.readContract({ address: c.adapter as `0x${string}`, abi: LEND, functionName: 'totalAssets' }),
        client.readContract({ address: c.adapter as `0x${string}`, abi: LEND, functionName: 'pendingInterest' }),
        client.readContract({ address: c.adapter as `0x${string}`, abi: LEND, functionName: 'aprBps' }),
        client.readContract({ address: c.adapter as `0x${string}`, abi: LEND, functionName: 'totalInterestMinted' }),
        client.readContract({ address: c.hook as `0x${string}`, abi: HOOK, functionName: 'bandStatus' }),
        client.readContract({ address: c.hook as `0x${string}`, abi: HOOK, functionName: 'appraisedAt' }),
        client.readContract({ address: c.hook as `0x${string}`, abi: HOOK, functionName: 'tradingPaused' }),
      ])
    const [spotTick, appraisalTick, deviationTicks, inCore, inSpec, fresh] = band

    // Logs node may trail the head node by a block or two — scan to a safe depth behind head.
    const { swaps, demoSwaps, appraisals } = await history(head.number - 2n)

    // Block timestamps for every block that carries an event (bounded: a demo market, not a busy pool).
    const blocks = [...new Set([...swaps, ...appraisals].map((l) => l.blockNumber as bigint))].slice(-200)
    const stamps = new Map<bigint, number>()
    await Promise.all(blocks.map(async (n) => stamps.set(n, Number((await client.getBlock({ blockNumber: n })).timestamp))))
    const ts = (l: Log) => stamps.get(l.blockNumber as bigint) ?? null

    const traderByTx = new Map(demoSwaps.map((l) => [l.transactionHash, l.args.trader as string]))
    const propIs0 = RWA_DEMO.propertyIsCurrency0
    const trades = swaps
      .filter((l) => l.args.sender?.toLowerCase() === c.router.toLowerCase())
      .map((l) => {
        const a0 = l.args.amount0 as bigint
        const a1 = l.args.amount1 as bigint
        // v4's Swap event reports the SWAPPER's balance delta: negative = the trader paid that currency.
        const propDelta = propIs0 ? a0 : a1
        const usdDelta = propIs0 ? a1 : a0
        const side = propDelta < 0n ? 'sell' : 'buy'
        return {
          tx: l.transactionHash, block: Number(l.blockNumber), ts: ts(l),
          trader: traderByTx.get(l.transactionHash) ?? null,
          side,
          usd: Math.abs(usd6(usdDelta)),
          units: Math.abs(prop18(propDelta)),
          priceUsd: tickToUsd(Number(l.args.tick)),
        }
      })
      .reverse()

    const priceSeries = swaps.map((l) => ({ block: Number(l.blockNumber), ts: ts(l), usd: tickToUsd(Number(l.args.tick)), tick: Number(l.args.tick), byVault: l.args.sender?.toLowerCase() === c.vault.toLowerCase() }))
    const appraisalSeries = appraisals.map((l) => ({ block: Number(l.blockNumber), ts: ts(l), usd: tickToUsd(Number(l.args.tick)), tick: Number(l.args.tick) }))

    const cfg = RWA_DEMO.hookConfig
    const bandUsd = (t: number) => {
      const lo = tickToUsd(Number(appraisalTick) - t), hi = tickToUsd(Number(appraisalTick) + t)
      return [Math.min(lo, hi), Math.max(lo, hi)]
    }

    const body = {
      ok: true,
      chainId: RWA_DEMO.chainId,
      block: Number(head.number),
      blockTime: Number(head.timestamp),
      appraisal: {
        tick: Number(appraisalTick), usd: tickToUsd(Number(appraisalTick)), at: Number(appraisedAt), fresh,
        maxAgeSecs: cfg?.maxAppraisalAge ?? null, minUpdateSecs: cfg?.minUpdateInterval ?? null,
      },
      spot: { tick: Number(spotTick), usd: tickToUsd(Number(spotTick)), deviationTicks: Number(deviationTicks), inCore, inSpec },
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
    cache = { at: Date.now(), body }
    return ctx.json(body)
  } catch (err) {
    ctx.log.warn('rwa', 'live unit read failed', { err: String(err) })
    return ctx.json({ ok: false })
  }
}, { rateLimit: { max: 60, windowMs: 60_000 } })
