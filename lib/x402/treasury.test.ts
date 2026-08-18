import { describe, it, expect } from 'vitest'
import { readAgentTreasury, formatUsdc, ParkedReader, SpendableSource } from './treasury'
import { rpcParkedReader } from './vaultReader'

const AGENT = '0xAbCdEf0000000000000000000000000000000009'

const parked = (v: bigint): ParkedReader => ({ parkedAtomic: async () => v })

describe('readAgentTreasury (park + spend-in-place)', () => {
  it('spendable defaults to the FULL parked balance when no edge source (parking does not lock)', async () => {
    const t = await readAgentTreasury(AGENT, parked(5_000_000n))
    expect(t).toEqual({ agent: AGENT.toLowerCase(), parkedUsdc: '5000000', spendableUsdc: '5000000', earning: true })
  })

  it('spendable is capped by edge headroom when it is below parked (live holds/caps)', async () => {
    const spend: SpendableSource = { headroomAtomic: async () => 1_500_000n }
    const t = await readAgentTreasury(AGENT, parked(5_000_000n), spend)
    expect(t.spendableUsdc).toBe('1500000')
    expect(t.parkedUsdc).toBe('5000000') // still fully parked + earning
    expect(t.earning).toBe(true)
  })

  it('edge headroom null → spendable falls back to parked', async () => {
    const spend: SpendableSource = { headroomAtomic: async () => null }
    const t = await readAgentTreasury(AGENT, parked(3_000_000n), spend)
    expect(t.spendableUsdc).toBe('3000000')
  })

  it('zero parked → not earning, nothing spendable', async () => {
    const t = await readAgentTreasury(AGENT, parked(0n))
    expect(t).toMatchObject({ parkedUsdc: '0', spendableUsdc: '0', earning: false })
  })

  it('never reports negative spendable', async () => {
    const spend: SpendableSource = { headroomAtomic: async () => -5n }
    const t = await readAgentTreasury(AGENT, parked(1_000_000n), spend)
    expect(t.spendableUsdc).toBe('0')
  })
})

describe('formatUsdc', () => {
  it('formats atomic 6dp to a human decimal', () => {
    expect(formatUsdc('2000000')).toBe('2')
    expect(formatUsdc('1234500')).toBe('1.2345')
    expect(formatUsdc('999')).toBe('0.000999')
    expect(formatUsdc('0')).toBe('0')
  })
})

describe('rpcParkedReader', () => {
  it('reads shares(agent) then convertToAssets(shares) via eth_call', async () => {
    const calls: string[] = []
    const word = (n: bigint) => '0x' + n.toString(16).padStart(64, '0')
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body))
      const data: string = body.params[0].data
      calls.push(data.slice(0, 10))
      const result = data.startsWith('0xce7c2ac2') ? word(4_000_000n) /* shares */ : word(4_050_000n) /* convertToAssets → +yield */
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })
    }) as unknown as typeof fetch

    const reader = rpcParkedReader({ rpcUrl: 'http://arc', vault: '0xVault', fetchImpl })
    expect(await reader.parkedAtomic(AGENT)).toBe(4_050_000n)
    expect(calls).toEqual(['0xce7c2ac2', '0x07a2d13a']) // shares(address) then convertToAssets(uint256)
  })

  it('short-circuits to 0 when the agent holds no shares (one call, no convert)', async () => {
    const calls: string[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init!.body)).params[0].data.slice(0, 10))
      return new Response(JSON.stringify({ result: '0x' + '0'.repeat(64) }), { status: 200 })
    }) as unknown as typeof fetch
    const reader = rpcParkedReader({ rpcUrl: 'http://arc', vault: '0xVault', fetchImpl })
    expect(await reader.parkedAtomic(AGENT)).toBe(0n)
    expect(calls).toEqual(['0xce7c2ac2'])
  })
})
