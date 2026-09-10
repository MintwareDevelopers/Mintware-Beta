// Unit tests for the paired-fee → quote conversion seam (user directive, 2026-09-10: "finish paired-token
// fee conversion"). No live chain access — everything here runs against injected fake viem-shaped clients,
// same pattern as the rest of lib/gateway/*.test.ts. buildV4SwapCalldata is tested by DECODING its own
// output back into components (never a hardcoded magic hex string) so the assertions stay meaningful if
// viem's own encoding internals ever change formatting.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics } from 'viem'
import { buildV4SwapCalldata, swapPairedToQuote } from './routerSwap'
import { pairedToQuoteAtSpot, applyToleranceBps } from './v4Math'

const POOL_KEY = {
  currency0: ('0x' + 'aa'.repeat(20)) as `0x${string}`,
  currency1: ('0x' + 'bb'.repeat(20)) as `0x${string}`,
  fee: 3000,
  tickSpacing: 60,
  hooks: ('0x' + '00'.repeat(20)) as `0x${string}`,
}
const QUOTE = POOL_KEY.currency0 // quote == currency0 in these fixtures
const PAIRED = POOL_KEY.currency1
const OWNER = ('0x' + 'cc'.repeat(20)) as `0x${string}`
const ROUTER = ('0x' + 'dd'.repeat(20)) as `0x${string}`
const POOL_MANAGER = ('0x' + 'ee'.repeat(20)) as `0x${string}`

const TRANSFER_EVENT_ABI = [
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
] as const

/** Builds a real, decodable ERC-20 Transfer log — same shape a real viem TransactionReceipt.logs entry
 *  has — so tests exercise the actual decodeEventLog path in measureSwapProceeds, not a hand-rolled stub. */
function transferLog(token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TRANSFER_EVENT_ABI, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  }
}

describe('buildV4SwapCalldata — pure, deterministic; decoded back to verify, never a magic hex string', () => {
  it('encodes a single V4_SWAP command byte', () => {
    const { commands } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 123n,
    })
    expect(commands).toBe('0x10') // V4_SWAP
  })

  it('produces exactly one input blob decoding to (actions, [swapParams, settleParams, takeParams])', () => {
    const { inputs } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 123n,
    })
    expect(inputs.length).toBe(1)
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0])
    expect(actions).toBe('0x060c0f') // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    expect(params.length).toBe(3)
  })

  it('the swap-params blob decodes to the exact ExactInputSingleParams passed in, with minHopPriceX36 disabled (0)', () => {
    const { inputs } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: true, amountIn: 12345n, amountOutMinimum: 6789n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 999n,
    })
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0])
    const [decoded] = decodeAbiParameters(
      [{
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: [
            { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
          ] },
          { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' },
        ],
      }],
      params[0],
    )
    // viem returns EIP-55 checksummed addresses on decode — compare case-insensitively rather than
    // asserting an exact casing the encoder never promised.
    expect({
      ...decoded,
      poolKey: {
        ...decoded.poolKey,
        currency0: decoded.poolKey.currency0.toLowerCase(),
        currency1: decoded.poolKey.currency1.toLowerCase(),
        hooks: decoded.poolKey.hooks.toLowerCase(),
      },
    }).toMatchObject({
      zeroForOne: true, amountIn: 12345n, amountOutMinimum: 6789n, minHopPriceX36: 0n, hookData: '0x',
      poolKey: { currency0: POOL_KEY.currency0.toLowerCase(), currency1: POOL_KEY.currency1.toLowerCase(), fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing, hooks: POOL_KEY.hooks.toLowerCase() },
    })
  })

  it('the settle-params blob decodes to (inputCurrency, amountIn) — SETTLE_ALL pays the input leg', () => {
    const { inputs } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: false, amountIn: 500n, amountOutMinimum: 400n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 1n,
    })
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0])
    const [currency, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1])
    expect(currency.toLowerCase()).toBe(PAIRED.toLowerCase())
    expect(amount).toBe(500n)
  })

  it('the take-params blob decodes to (outputCurrency, amountOutMinimum) — TAKE_ALL claims the output leg', () => {
    const { inputs } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: false, amountIn: 500n, amountOutMinimum: 400n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 1n,
    })
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0])
    const [currency, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2])
    expect(currency.toLowerCase()).toBe(QUOTE.toLowerCase())
    expect(amount).toBe(400n)
  })

  it('passes the deadline through unchanged (not part of the inner V4 encoding, just returned alongside)', () => {
    const { deadline } = buildV4SwapCalldata({
      poolKey: POOL_KEY, zeroForOne: true, amountIn: 1n, amountOutMinimum: 1n,
      inputCurrency: PAIRED, outputCurrency: QUOTE, deadline: 777777n,
    })
    expect(deadline).toBe(777777n)
  })
})

describe('swapPairedToQuote', () => {
  const ORIGINAL_ENV = { ...process.env }
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED = 'true'
    process.env.LP_GATEWAY_ROUTER_ADDRESS = ROUTER
  })
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('no-ops immediately for a non-positive paired amount, without touching the network at all', async () => {
    const publicClient = { readContract: vi.fn() }
    const r = await swapPairedToQuote({ positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: {}, wallet: {}, publicClient, pairedAmount: 0n })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(publicClient.readContract).not.toHaveBeenCalled()
  })

  it('no-ops when NEXT_PUBLIC_MW_ROUTER_ENABLED is not "true"', async () => {
    process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED = 'false'
    const publicClient = { readContract: vi.fn() }
    const r = await swapPairedToQuote({ positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: {}, wallet: {}, publicClient, pairedAmount: 1000n })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(publicClient.readContract).not.toHaveBeenCalled()
  })

  it('no-ops when LP_GATEWAY_ROUTER_ADDRESS is unset — the actual state of the current testnet deployment', async () => {
    delete process.env.LP_GATEWAY_ROUTER_ADDRESS
    const publicClient = { readContract: vi.fn() }
    const r = await swapPairedToQuote({ positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: {}, wallet: {}, publicClient, pairedAmount: 1000n })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(publicClient.readContract).not.toHaveBeenCalled()
  })

  // Packs a Slot0 word the way readCurrentTick (poolState.ts) expects to unpack it: low 160 bits
  // sqrtPriceX96, next 24 bits signed tick.
  function packSlot0(sqrtPriceX96: bigint, tick = 0): `0x${string}` {
    const tickBits = BigInt.asUintN(24, BigInt(tick))
    const word = (tickBits << 160n) | sqrtPriceX96
    return ('0x' + word.toString(16).padStart(64, '0')) as `0x${string}`
  }

  function fakeClient(overrides: { allowance?: bigint; sqrtPriceX96?: bigint; quoteBalances?: bigint[]; swapLogs?: unknown[] } = {}) {
    const sqrtPriceX96 = overrides.sqrtPriceX96 ?? (1n << 96n) // price 1:1
    const allowance = overrides.allowance ?? 0n
    let balanceCallCount = 0
    const quoteBalances = overrides.quoteBalances ?? [1_000_000n, 1_500_000n] // before, after
    const swapLogs = overrides.swapLogs ?? [] // no Transfer log by default — exercises the balance-diff fallback

    const readContract = vi.fn(async (args: any) => {
      if (args.functionName === 'poolKey') return POOL_KEY
      if (args.functionName === 'poolManager') return POOL_MANAGER
      if (args.functionName === 'quoteAsset') return QUOTE
      if (args.functionName === 'pairedAsset') return PAIRED
      if (args.functionName === 'extsload') return packSlot0(sqrtPriceX96)
      if (args.functionName === 'allowance') return allowance
      if (args.functionName === 'balanceOf') {
        const v = quoteBalances[Math.min(balanceCallCount, quoteBalances.length - 1)]
        balanceCallCount++
        return v
      }
      throw new Error(`unexpected readContract call: ${args.functionName}`)
    })
    const writeContract = vi.fn(async (args: any) => (args.functionName === 'approve' ? '0xapprovetx' : '0xswaptx'))
    const waitForTransactionReceipt = vi.fn(async ({ hash }: { hash: string }) => ({
      status: 'success', transactionHash: hash,
      // Only the swap tx (not the approve tx) carries the swap's own logs.
      logs: hash === '0xswaptx' ? swapLogs : [],
    }))
    const estimateContractGas = vi.fn(async () => 100_000n)
    return { readContract, writeContract, waitForTransactionReceipt, estimateContractGas, chain: { id: 46630 } }
  }

  it('sizes and submits a real swap end-to-end when everything resolves cleanly, and measures output from the swap receipt\'s own Transfer log', async () => {
    const client = fakeClient({ allowance: 10n ** 30n, swapLogs: [transferLog(QUOTE, ROUTER, OWNER, 500_000n)] }) // allowance already sufficient
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(500_000n)
    expect(r.txHash).toBe('0xswaptx')
    // No approve call needed — allowance was already sufficient.
    expect(client.writeContract).toHaveBeenCalledTimes(1)
  })

  // Codex live-watch finding (2026-09-10): the OLD balance-diff-only measurement was two separate RPC
  // reads bracketing the swap — non-atomic, contaminable by any unrelated activity on the shared oracle
  // seat wallet in between. Fixed: the PRIMARY measurement now sums the swap receipt's OWN ERC-20
  // Transfer(quoteAsset → owner) logs — genuinely transaction-scoped. These tests prove that path is used
  // when available, and that it is immune to exactly the contamination scenario Codex described.
  it('measures proceeds from the swap receipt\'s own Transfer log (primary method) — ignores the wallet balance-diff entirely when a qualifying log is present', async () => {
    const owner = OWNER
    // Deliberately WRONG balance-diff numbers (would report 900,000 if balance-diff were used) — the
    // Transfer log is the only correct source here, proving it takes priority.
    const client = fakeClient({
      allowance: 10n ** 30n, quoteBalances: [1_000_000n, 1_900_000n],
      swapLogs: [transferLog(QUOTE, ROUTER, owner, 500_000n)],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(500_000n) // the Transfer log's own value, NOT the 900,000 balance delta
  })

  it('is immune to a concurrent, unrelated incoming transfer landing between the before/after balance reads — the exact contamination scenario Codex flagged', async () => {
    const owner = OWNER
    // The balance went up by 800,000 total — 500,000 from this swap (the Transfer log) plus 300,000 from
    // some UNRELATED concurrent transfer (e.g. a different pool's harvest hitting the same shared oracle
    // seat). A balance-diff-only measurement would wrongly attribute the full 800,000 to this swap.
    const client = fakeClient({
      allowance: 10n ** 30n, quoteBalances: [1_000_000n, 1_800_000n],
      swapLogs: [transferLog(QUOTE, ROUTER, owner, 500_000n)],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(500_000n) // correctly excludes the unrelated 300,000
  })

  it('sums multiple qualifying Transfer logs in the same receipt (a multi-hop or split settlement)', async () => {
    const owner = OWNER
    const client = fakeClient({
      allowance: 10n ** 30n,
      swapLogs: [transferLog(QUOTE, ROUTER, owner, 300_000n), transferLog(QUOTE, ROUTER, owner, 200_000n)],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(500_000n)
  })

  // Codex live-watch finding, third pass (2026-09-10): counting gross INCOMING transfers alone overstates
  // proceeds whenever the SAME transaction also moves quoteAsset OUT of owner (fee-on-transfer, a
  // self-transfer artifact, an intermediate-hop detail — none independently verified for this router).
  // Fixed: measureSwapProceeds NETS incoming minus outgoing quoteAsset transfers within the same receipt.
  it('nets an outgoing quoteAsset transfer within the same receipt against the incoming one, rather than reporting the gross inflow', async () => {
    const owner = OWNER
    const client = fakeClient({
      allowance: 10n ** 30n,
      swapLogs: [
        transferLog(QUOTE, ROUTER, owner, 500_000n), // incoming: the swap's own payout
        transferLog(QUOTE, owner, ROUTER, 50_000n), // outgoing: e.g. a fee-on-transfer skim within the same tx
      ],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(450_000n) // net, not the gross 500,000
  })

  it('clamps a net-negative result to 0 (never reports negative proceeds) — a defensive floor, not expected in a genuine payout', async () => {
    const owner = OWNER
    const client = fakeClient({
      allowance: 10n ** 30n,
      swapLogs: [
        transferLog(QUOTE, ROUTER, owner, 100_000n),
        transferLog(QUOTE, owner, ROUTER, 300_000n), // more went out than in, within this same receipt
      ],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(0n)
  })

  it('ignores a Transfer log for the WRONG token or to a DIFFERENT recipient — neither qualifies, so quoteOut is 0 (never falls back to a wallet balance diff)', async () => {
    const owner = OWNER
    const someoneElse = ('0x' + 'ff'.repeat(20)) as `0x${string}`
    const client = fakeClient({
      allowance: 10n ** 30n,
      swapLogs: [
        transferLog(PAIRED, ROUTER, owner, 999_999n), // wrong token (the input leg, not quoteAsset) — ignored
        transferLog(QUOTE, ROUTER, someoneElse, 999_999n), // right token, wrong recipient — ignored
      ],
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(0n) // neither log qualified — never guesses via balance-diff, reports honestly unmeasured
  })

  // Codex live-watch finding, second pass (2026-09-10): an earlier version kept the balance-diff as a
  // "weaker but logged" fallback when no qualifying Transfer log was found — Codex flagged that fallback
  // as itself unsafe (non-atomic, could OVERSTATE proceeds from unrelated concurrent activity on the
  // shared oracle seat). Removed entirely: no qualifying log ⇒ quoteOut: 0, always, never a guess.
  it('warns and reports quoteOut: 0 (never falls back to a wallet balance diff) when the receipt has logs but none is a qualifying Transfer', async () => {
    const owner = OWNER
    const client = fakeClient({
      allowance: 10n ** 30n,
      swapLogs: [transferLog(PAIRED, ROUTER, owner, 999_999n)], // some log present, just not a qualifying one
    })
    const log = { warn: vi.fn() }
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: owner }, wallet: client, publicClient: client, pairedAmount: 500_000n, log,
    })
    expect(r.quoteOut).toBe(0n)
    expect(r.txHash).toBe('0xswaptx') // the hash is still preserved — only the proceeds are unmeasured
    expect(log.warn).toHaveBeenCalledWith('gateway.harvest', expect.stringContaining('honestly unmeasured'), expect.objectContaining({ swapTx: '0xswaptx' }))
  })

  it('approves the router first when the current allowance is insufficient, then swaps', async () => {
    const client = fakeClient({ allowance: 0n })
    await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(client.writeContract).toHaveBeenCalledTimes(2) // approve, then execute
    const [approveCall] = client.writeContract.mock.calls[0]
    expect(approveCall.functionName).toBe('approve')
    expect(approveCall.args).toEqual([ROUTER, 500_000n])
  })

  it('skips the approve call entirely when the existing allowance already covers the amount', async () => {
    const client = fakeClient({ allowance: 1_000_000n })
    await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(client.writeContract).toHaveBeenCalledTimes(1) // execute only
    expect(client.writeContract.mock.calls[0][0].functionName).toBe('execute')
  })

  it('never guesses proceeds from a wallet balance change under any circumstance — even a real, large balance increase is ignored without a qualifying Transfer log', async () => {
    // The pool math would suggest ~500,000 quote out at 1:1 spot, and the wallet balance genuinely DID go
    // up by 100,000 — but with no Transfer log to prove it came from THIS swap, quoteOut must still be 0.
    const client = fakeClient({ allowance: 10n ** 30n, quoteBalances: [1_000_000n, 1_100_000n] })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(0n)
  })

  it('reports quoteOut:0 even if the wallet balance somehow went DOWN — confirms the balance is never consulted at all now, not even as a sanity check', async () => {
    const client = fakeClient({ allowance: 10n ** 30n, quoteBalances: [1_000_000n, 900_000n] })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r.quoteOut).toBe(0n)
    expect(client.readContract.mock.calls.some((c: any[]) => c[0].functionName === 'balanceOf')).toBe(false)
  })

  it('leaves paired fees unconverted (never guesses a size) when the pool price is unreadable', async () => {
    const client = fakeClient()
    client.readContract = vi.fn(async (args: any) => {
      if (args.functionName === 'poolKey') return POOL_KEY
      if (args.functionName === 'poolManager') return POOL_MANAGER
      if (args.functionName === 'quoteAsset') return QUOTE
      if (args.functionName === 'pairedAsset') return PAIRED
      if (args.functionName === 'extsload') throw new Error('rpc unavailable')
      throw new Error('unexpected call')
    })
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(client.writeContract).not.toHaveBeenCalled()
  })

  it('does NOT swap when the router approval transaction itself reverts', async () => {
    const client = fakeClient({ allowance: 0n })
    client.waitForTransactionReceipt = vi.fn(async () => ({ status: 'reverted', transactionHash: '0xswaptx', logs: [] }))
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(client.writeContract).toHaveBeenCalledTimes(1) // only the approve was attempted
  })

  it('reports the swap tx hash but quoteOut:0 when the swap itself reverts on-chain — a definitive terminal outcome, never flagged for reconciliation', async () => {
    const client = fakeClient({ allowance: 10n ** 30n })
    client.waitForTransactionReceipt = vi.fn(async () => ({ status: 'reverted', transactionHash: '0xswaptx', logs: [] }))
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: '0xswaptx', needsReconciliation: false })
  })

  // Codex live-watch finding (2026-09-10): an earlier draft let ANY error after the swap tx was already
  // submitted fall through to the outer catch, which returns txHash:null — indistinguishable from "never
  // submitted", even though a real on-chain tx exists and may confirm successfully. Fixed by a nested
  // try/catch that guarantees the hash survives once submission has actually happened.
  it('preserves the submitted swap tx hash when waitForTransactionReceipt itself fails (e.g. RPC drop/timeout) — never reports it as null, and flags it for reconciliation', async () => {
    const client = fakeClient({ allowance: 10n ** 30n })
    client.waitForTransactionReceipt = vi.fn(async () => { throw new Error('ECONNRESET while polling for receipt') })
    const log = { warn: vi.fn() }
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n, log,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: '0xswaptx', needsReconciliation: true })
    expect(log.warn).toHaveBeenCalledWith('gateway.harvest', expect.stringContaining('could not be confirmed'), expect.objectContaining({ swapTx: '0xswaptx' }))
  })

  it('preserves the submitted swap tx hash and flags reconciliation when the swap confirmed but no qualifying Transfer log was found', async () => {
    const client = fakeClient({ allowance: 10n ** 30n }) // no swapLogs override — receipt has no Transfer log
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: '0xswaptx', needsReconciliation: true })
  })

  it('never throws out to the caller — any unexpected error is caught and reported as a safe no-op, never needing reconciliation (no tx was ever submitted)', async () => {
    const client = fakeClient()
    client.readContract = vi.fn(async () => { throw new Error('totally unexpected RPC failure') })
    const log = { warn: vi.fn() }
    const r = await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 500_000n, log,
    })
    expect(r).toEqual({ quoteOut: 0n, txHash: null, needsReconciliation: false })
    expect(log.warn).toHaveBeenCalled()
  })

  it('sizes the swap using the SAME pairedToQuoteAtSpot + applyToleranceBps math deploy.ts uses for its own zap, for consistency', async () => {
    // Cross-check: what the swap-params blob's amountOutMinimum ends up as should equal exactly what the
    // shared math helpers compute — proves swapPairedToQuote isn't quietly duplicating (and risking
    // drifting from) that formula.
    const sqrtPriceX96 = 2n * (1n << 96n) // a non-trivial, non-1:1 price
    const client = fakeClient({ allowance: 10n ** 30n, sqrtPriceX96 })
    process.env.LP_GATEWAY_SWAP_SLIPPAGE_BPS = '250'
    await swapPairedToQuote({
      positionManager: '0x' + '11'.repeat(20) as `0x${string}`, account: { address: OWNER }, wallet: client, publicClient: client, pairedAmount: 777_777n,
    })
    const executeCall = client.writeContract.mock.calls.find((c: any[]) => c[0].functionName === 'execute')?.[0]
    const [, inputs] = executeCall.args
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0])
    const [decoded] = decodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'poolKey', type: 'tuple', components: [
          { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
        ] },
        { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' },
        { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' },
      ] }],
      params[0],
    )
    const expected = applyToleranceBps(pairedToQuoteAtSpot(777_777n, sqrtPriceX96, true), 250)
    expect(decoded.amountOutMinimum).toBe(expected)
  })
})
