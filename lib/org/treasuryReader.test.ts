import { describe, it, expect } from 'vitest'
import { makeTreasuryReader } from './treasuryReader'

const VAULT = '0x09cda8519737a60fd16d263f94fb56237cdb7e42'
const MEMBER = '0x9c646C48a302f4725450669f1218d3FDb3e933AD'
const word = (n: bigint) => '0x' + n.toString(16).padStart(64, '0')

// Fake JSON-RPC: answers eth_call by selector, records every call's data.
function rpc(answers: Record<string, string | null>) {
  const calls: string[] = []
  const fetchImpl = (async (_url: string, init?: { body?: string }) => {
    const { params } = JSON.parse(init?.body ?? '{}')
    const data: string = params[0].data
    calls.push(data)
    const sel = data.slice(0, 10)
    const result = answers[sel]
    return { json: async () => (result === null || result === undefined ? { error: { message: 'execution reverted' } } : { result }) }
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('treasuryReader (Treasury yield / ERC-4626)', () => {
  it('snapshot reads asset() and totalAssets()', async () => {
    const { fetchImpl, calls } = rpc({ '0x38d52e0f': word(0xabcn), '0x01e1d114': word(2_500_000n) })
    const snap = await makeTreasuryReader({ rpcUrl: 'x', vault: VAULT, fetchImpl }).snapshot()
    expect(snap).toEqual({ navUsdc: 2_500_000n })
    expect(calls.map((c) => c.slice(0, 10)).sort()).toEqual(['0x01e1d114', '0x38d52e0f'])
  })

  it('snapshot fails for an address that is not an ERC-4626 vault', async () => {
    const { fetchImpl } = rpc({ '0x01e1d114': word(1n), '0x38d52e0f': null })
    await expect(makeTreasuryReader({ rpcUrl: 'x', vault: VAULT, fetchImpl }).snapshot()).rejects.toThrow()
  })

  it("memberSuppliedUsdc converts the member's own shares", async () => {
    const { fetchImpl, calls } = rpc({ '0x70a08231': word(1_000n), '0x07a2d13a': word(1_050_000n) })
    const v = await makeTreasuryReader({ rpcUrl: 'x', vault: VAULT, fetchImpl }).memberSuppliedUsdc(MEMBER)
    expect(v).toBe(1_050_000n)
    expect(calls[0]).toBe('0x70a08231' + MEMBER.toLowerCase().slice(2).padStart(64, '0'))
    expect(calls[1]).toBe('0x07a2d13a' + (1_000n).toString(16).padStart(64, '0'))
  })

  it('memberSuppliedUsdc is zero without a second call when the member holds no shares', async () => {
    const { fetchImpl, calls } = rpc({ '0x70a08231': word(0n) })
    expect(await makeTreasuryReader({ rpcUrl: 'x', vault: VAULT, fetchImpl }).memberSuppliedUsdc(MEMBER)).toBe(0n)
    expect(calls).toHaveLength(1)
  })
})
