import { afterEach, describe, expect, it } from 'vitest'
import { decodeFunctionData, getAddress, parseAbi } from 'viem'
import { buildDepositCall, bufferSweepEnabled, computeSweepAtomic } from './sweep'

const VAULT = '0x1234567890123456789012345678901234567890'
const MEMBER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const DEPOSIT_ABI = parseAbi(['function depositUSDC(uint256 assets, uint256 minShares, address to) returns (uint256)'])

describe('computeSweepAtomic', () => {
  it('sweeps the surplus above target', () => {
    expect(computeSweepAtomic({ availableAtomic: 350_000_000n, targetAtomic: 200_000_000n })).toBe(150_000_000n)
  })
  it('sweeps nothing at or below target', () => {
    expect(computeSweepAtomic({ availableAtomic: 200_000_000n, targetAtomic: 200_000_000n })).toBe(0n)
    expect(computeSweepAtomic({ availableAtomic: 150_000_000n, targetAtomic: 200_000_000n })).toBe(0n)
  })
  it('respects the min-sweep threshold (avoids dust churn)', () => {
    // surplus of $5 but min-sweep is $10 → skip
    expect(computeSweepAtomic({ availableAtomic: 205_000_000n, targetAtomic: 200_000_000n, minSweepAtomic: 10_000_000n })).toBe(0n)
    // surplus of $15 clears the $10 min → sweep it all
    expect(computeSweepAtomic({ availableAtomic: 215_000_000n, targetAtomic: 200_000_000n, minSweepAtomic: 10_000_000n })).toBe(15_000_000n)
  })
})

describe('bufferSweepEnabled', () => {
  const saved = process.env.CARD_BUFFER_SWEEP_ENABLED
  afterEach(() => {
    if (saved === undefined) delete process.env.CARD_BUFFER_SWEEP_ENABLED
    else process.env.CARD_BUFFER_SWEEP_ENABLED = saved
  })
  it('fails closed unless exactly "true"', () => {
    delete process.env.CARD_BUFFER_SWEEP_ENABLED
    expect(bufferSweepEnabled()).toBe(false)
    for (const v of ['', '1', 'TRUE']) { process.env.CARD_BUFFER_SWEEP_ENABLED = v; expect(bufferSweepEnabled()).toBe(false) }
    process.env.CARD_BUFFER_SWEEP_ENABLED = 'true'
    expect(bufferSweepEnabled()).toBe(true)
  })
})

describe('buildDepositCall', () => {
  it('encodes depositUSDC(assets, minShares, to) to the vault', () => {
    const call = buildDepositCall({ vaultAddress: VAULT, assetsAtomic: 150_000_000n, minShares: 0n, to: MEMBER })
    expect(call.to).toBe(getAddress(VAULT))
    expect(call.value).toBe('0x0')
    const decoded = decodeFunctionData({ abi: DEPOSIT_ABI, data: call.data })
    expect(decoded.functionName).toBe('depositUSDC')
    expect(decoded.args).toEqual([150_000_000n, 0n, getAddress(MEMBER)])
  })
  it('rejects bad inputs', () => {
    expect(() => buildDepositCall({ vaultAddress: 'x', assetsAtomic: 1n, minShares: 0n, to: MEMBER })).toThrow()
    expect(() => buildDepositCall({ vaultAddress: VAULT, assetsAtomic: 0n, minShares: 0n, to: MEMBER })).toThrow()
    expect(() => buildDepositCall({ vaultAddress: VAULT, assetsAtomic: 1n, minShares: -1n, to: MEMBER })).toThrow()
  })
})
