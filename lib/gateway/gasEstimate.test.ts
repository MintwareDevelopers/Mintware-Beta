// Round-4 audit fix (Medium): the gateway crons used to send harvest()/compoundQuote()/deploy() with a
// fixed gas literal, letting a paired token with a legitimately (never-reverting) heavier transfer cost
// permanently starve the automated pipeline once its real cost exceeded the fixed budget. See
// lib/gateway/gasEstimate.ts and its call sites in harvest.ts/deploy.ts.
import { describe, it, expect, vi } from 'vitest'
import { estimateGasWithFloor, isDeterministicContractRevert } from './gasEstimate'

describe('estimateGasWithFloor', () => {
  it('buffers a successful estimate by the default 75% and reports estimated:true', async () => {
    const client = { estimateContractGas: vi.fn(async () => 1_000_000n) }
    const r = await estimateGasWithFloor(client, { address: '0x1', abi: [], functionName: 'f' }, 900_000n)
    expect(r).toEqual({ gas: 1_750_000n, estimated: true }) // 1_000_000n * 1.75
  })

  it('uses a custom buffer', async () => {
    const client = { estimateContractGas: vi.fn(async () => 1_000_000n) }
    const r = await estimateGasWithFloor(client, {}, 0n, 5_000) // +50%
    expect(r).toEqual({ gas: 1_500_000n, estimated: true })
  })

  it('a buffered estimate BELOW the floor still returns at least the floor', async () => {
    const client = { estimateContractGas: vi.fn(async () => 100n) } // buffered: 175n
    const r = await estimateGasWithFloor(client, {}, 900_000n)
    expect(r).toEqual({ gas: 900_000n, estimated: true })
  })

  it('a heavier-than-usual, legitimately-costly call now gets a real gas budget instead of the fixed floor', async () => {
    // The exact scenario the finding describes: a paired token whose transfer costs more than the OLD
    // fixed 900_000n literal, but never reverts on its own.
    const client = { estimateContractGas: vi.fn(async () => 1_100_000n) } // exceeds the old fixed budget
    const r = await estimateGasWithFloor(client, {}, 900_000n)
    expect(r.gas).toBeGreaterThan(900_000n) // would have permanently reverted under the old fixed budget
    expect(r.estimated).toBe(true)
  })

  it('falls back to the floor when estimation itself throws (transient RPC error, or estimate/send state drift) — preserves the old fixed-budget behavior exactly', async () => {
    const client = { estimateContractGas: vi.fn(async () => { throw new Error('rpc timeout') }) }
    const r = await estimateGasWithFloor(client, {}, 900_000n)
    expect(r).toEqual({ gas: 900_000n, estimated: false })
  })
})

describe('isDeterministicContractRevert', () => {
  it('matches a named custom error in the thrown message', () => {
    const e = new Error('ContractFunctionExecutionError: execution reverted: NotDeployed()')
    expect(isDeterministicContractRevert(e, ['NotDeployed'])).toBe('NotDeployed')
  })
  it('returns null for an unrelated / transient error — never a false positive that skips a call that should run', () => {
    const e = new Error('HttpRequestError: timeout of 10000ms exceeded')
    expect(isDeterministicContractRevert(e, ['NotDeployed'])).toBeNull()
  })
  it('handles a non-Error thrown value', () => {
    expect(isDeterministicContractRevert('NotDeployed', ['NotDeployed'])).toBe('NotDeployed')
    expect(isDeterministicContractRevert('some other string', ['NotDeployed'])).toBeNull()
  })
})
