import { afterEach, describe, it, expect, vi } from 'vitest'
import { readInstanceHoldings, CANONICAL_MULTICALL3 } from './chainTruth'

const PM1 = ('0x' + '1'.repeat(40)) as `0x${string}`
const PM2 = ('0x' + '2'.repeat(40)) as `0x${string}`
const A = '0x' + 'a'.repeat(40)
const B = '0x' + 'b'.repeat(40)

// A fake chain: per-PM totals + per-wallet shares. Serves both readContract and multicall.
function fakeChain(state: Record<string, { totalShares: bigint; totalNav: bigint; shares: Record<string, bigint> }>) {
  const answer = (c: { address: string; functionName: string; args?: readonly unknown[] }) => {
    const s = state[c.address.toLowerCase()]
    if (!s) throw new Error('unknown pm')
    if (c.functionName === 'totalShares') return s.totalShares
    if (c.functionName === 'totalNav') return s.totalNav
    if (c.functionName === 'sharesOf') return s.shares[String(c.args?.[0]).toLowerCase()] ?? 0n
    throw new Error('unexpected fn ' + c.functionName)
  }
  return {
    answer,
    readContract: vi.fn(async (c: Parameters<typeof answer>[0]) => answer(c)),
    multicall: vi.fn(async ({ contracts }: { contracts: Parameters<typeof answer>[0][]; multicallAddress?: string; blockNumber?: bigint }) => contracts.map(answer)),
    getBlockNumber: vi.fn(async () => 777n),
  }
}

afterEach(() => { delete process.env.LP_GATEWAY_MULTICALL3 })

describe('readInstanceHoldings', () => {
  const state = {
    [PM1]: { totalShares: 100n, totalNav: 110n, shares: { [A]: 40n, [B]: 60n } },
    [PM2]: { totalShares: 50n, totalNav: 25n, shares: { [A]: 50n } },
  }

  it('uses multicall (one round-trip) pinned to the latest block by default', async () => {
    const client = fakeChain(state)
    const snap = await readInstanceHoldings({ client, instances: [
      { poolAddress: '0xP1', positionManager: PM1, wallets: [A, B] },
      { poolAddress: '0xp2', positionManager: PM2, wallets: [A] },
    ] })
    expect(snap.blockNumber).toBe(777n)
    expect(client.multicall).toHaveBeenCalledTimes(1)
    expect(client.multicall.mock.calls[0][0]).toMatchObject({ multicallAddress: CANONICAL_MULTICALL3, allowFailure: false, blockNumber: 777n })
    expect(client.readContract).not.toHaveBeenCalled()
    expect(snap.holdings).toHaveLength(2)
    expect(snap.holdings[0]).toMatchObject({ poolAddress: '0xp1', totalShares: 100n, totalNav: 110n })
    expect(snap.holdings[0].shares.get(A)).toBe(40n)
    expect(snap.holdings[0].shares.get(B)).toBe(60n)
    expect(snap.holdings[1].shares.get(A)).toBe(50n)
  })

  it('falls back to chunked per-call reads when multicall fails (no Multicall3 on this chain)', async () => {
    const client = fakeChain(state)
    client.multicall.mockRejectedValueOnce(new Error('execution reverted'))
    const snap = await readInstanceHoldings({ client, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A, B] }] })
    expect(client.readContract).toHaveBeenCalledTimes(4) // totals ×2 + sharesOf ×2
    expect(client.readContract.mock.calls[0][0]).toMatchObject({ blockNumber: 777n })
    expect(snap.holdings[0].shares.get(B)).toBe(60n)
  })

  it('LP_GATEWAY_MULTICALL3=off skips multicall entirely; a custom address is honoured', async () => {
    process.env.LP_GATEWAY_MULTICALL3 = 'off'
    const client = fakeChain(state)
    await readInstanceHoldings({ client, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A] }] })
    expect(client.multicall).not.toHaveBeenCalled()

    process.env.LP_GATEWAY_MULTICALL3 = '0x' + '9'.repeat(40)
    const client2 = fakeChain(state)
    await readInstanceHoldings({ client: client2, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A] }] })
    expect(client2.multicall.mock.calls[0][0].multicallAddress).toBe('0x' + '9'.repeat(40))
  })

  it('dedupes wallets (case-insensitive) and returns no calls for an empty plan', async () => {
    const client = fakeChain(state)
    const snap = await readInstanceHoldings({ client, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A, A.toUpperCase().replace('0X', '0x')] }] })
    expect(snap.holdings[0].shares.size).toBe(1)
    const empty = await readInstanceHoldings({ client: fakeChain(state), instances: [] })
    expect(empty.holdings).toEqual([])
  })

  it('rejects (never partial) when the fallback read fails too', async () => {
    const client = fakeChain(state)
    client.multicall.mockRejectedValueOnce(new Error('boom'))
    client.readContract.mockRejectedValue(new Error('rpc down'))
    await expect(readInstanceHoldings({ client, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A] }] })).rejects.toThrow('rpc down')
  })

  it('tolerates a missing getBlockNumber (blockNumber null, reads unpinned)', async () => {
    const client = fakeChain(state)
    const { getBlockNumber: _omit, ...noBlock } = client
    void _omit
    const snap = await readInstanceHoldings({ client: noBlock, instances: [{ poolAddress: '0xp1', positionManager: PM1, wallets: [A] }] })
    expect(snap.blockNumber).toBeNull()
    expect(noBlock.multicall.mock.calls[0][0].blockNumber).toBeUndefined()
  })
})
