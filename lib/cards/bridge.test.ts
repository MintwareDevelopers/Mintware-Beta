import { afterEach, describe, expect, it } from 'vitest'
import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import {
  BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC,
  bridgeCardsEnabled,
  bridgeCardsSpender,
  bridgeConfigured,
  buildApproveCall,
  computeApproveAllowanceAtomic,
} from './bridge'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // Base USDC (checksummed)
const SPENDER = '0x1111111111111111111111111111111111111111'

const ENV_KEYS = ['CARD_BRIDGE_ENABLED', 'BRIDGE_API_KEY', 'BRIDGE_CARDS_SPENDER'] as const
const snapshot = () => Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const restore = (s: Record<string, string | undefined>) => {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k]
    else process.env[k] = s[k]!
  }
}

describe('bridge — runtime gates (fail-closed)', () => {
  const saved = snapshot()
  afterEach(() => restore(saved))

  it('bridgeCardsEnabled is OFF unless the value is exactly "true"', () => {
    delete process.env.CARD_BRIDGE_ENABLED
    expect(bridgeCardsEnabled()).toBe(false)
    for (const v of ['', '1', 'TRUE', 'yes', 'false']) {
      process.env.CARD_BRIDGE_ENABLED = v
      expect(bridgeCardsEnabled()).toBe(false)
    }
    process.env.CARD_BRIDGE_ENABLED = 'true'
    expect(bridgeCardsEnabled()).toBe(true)
  })

  it('bridgeCardsSpender returns null on unset / malformed, checksummed address otherwise', () => {
    delete process.env.BRIDGE_CARDS_SPENDER
    expect(bridgeCardsSpender()).toBeNull()
    process.env.BRIDGE_CARDS_SPENDER = 'not-an-address'
    expect(bridgeCardsSpender()).toBeNull()
    process.env.BRIDGE_CARDS_SPENDER = SPENDER.toLowerCase()
    expect(bridgeCardsSpender()).toBe(getAddress(SPENDER))
  })

  it('bridgeConfigured requires enabled AND api key AND a valid spender', () => {
    process.env.CARD_BRIDGE_ENABLED = 'true'
    process.env.BRIDGE_API_KEY = 'sk_test'
    process.env.BRIDGE_CARDS_SPENDER = SPENDER
    expect(bridgeConfigured()).toBe(true)

    delete process.env.BRIDGE_API_KEY
    expect(bridgeConfigured()).toBe(false) // missing key
    process.env.BRIDGE_API_KEY = 'sk_test'

    delete process.env.BRIDGE_CARDS_SPENDER
    expect(bridgeConfigured()).toBe(false) // missing spender

    process.env.BRIDGE_CARDS_SPENDER = SPENDER
    process.env.CARD_BRIDGE_ENABLED = 'false'
    expect(bridgeConfigured()).toBe(false) // disabled
  })
})

describe('bridge — capped allowance sizing', () => {
  const DAY = 500_000_000n // $500/day cap

  it('grants coverageDays × dailyCap within bounds', () => {
    expect(computeApproveAllowanceAtomic({ dailyCapAtomic: DAY, coverageDays: 7 })).toBe(DAY * 7n)
  })

  it('defaults to a 7-day coverage', () => {
    expect(computeApproveAllowanceAtomic({ dailyCapAtomic: DAY })).toBe(DAY * 7n)
  })

  it('floors at minAllowance (default one day of cap) when the base is tiny', () => {
    // coverageDays=1, so base == dailyCap; explicit larger floor wins.
    const floor = 2_000_000_000n
    expect(
      computeApproveAllowanceAtomic({ dailyCapAtomic: DAY, coverageDays: 1, minAllowanceAtomic: floor }),
    ).toBe(floor)
  })

  it('never exceeds the hard max — the ceiling always wins', () => {
    // 7 days of a $1M/day cap would be $7M; hard max clamps it to $50k.
    const huge = 1_000_000_000_000n
    expect(computeApproveAllowanceAtomic({ dailyCapAtomic: huge })).toBe(BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC)
  })

  it('hard max beats even a floor larger than it (bounded pull-right, never unlimited)', () => {
    expect(
      computeApproveAllowanceAtomic({
        dailyCapAtomic: DAY,
        minAllowanceAtomic: BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC * 10n,
        hardMaxAtomic: BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC,
      }),
    ).toBe(BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC)
  })

  it('rejects nonsensical inputs', () => {
    expect(() => computeApproveAllowanceAtomic({ dailyCapAtomic: 0n })).toThrow()
    expect(() => computeApproveAllowanceAtomic({ dailyCapAtomic: DAY, coverageDays: 0 })).toThrow()
    expect(() => computeApproveAllowanceAtomic({ dailyCapAtomic: DAY, hardMaxAtomic: 0n })).toThrow()
  })
})

describe('bridge — approve call builder', () => {
  it('encodes a correct ERC-20 approve(spender, allowance) the wallet can sign', () => {
    const allowance = 3_500_000_000n
    const call = buildApproveCall({ usdcAddress: USDC, spender: SPENDER, allowanceAtomic: allowance })

    expect(call.to).toBe(getAddress(USDC))
    expect(call.value).toBe('0x0')
    expect(call.data.startsWith('0x095ea7b3')).toBe(true) // approve selector

    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args).toEqual([getAddress(SPENDER), allowance])
  })

  it('rejects invalid addresses and non-positive allowance', () => {
    expect(() => buildApproveCall({ usdcAddress: 'nope', spender: SPENDER, allowanceAtomic: 1n })).toThrow()
    expect(() => buildApproveCall({ usdcAddress: USDC, spender: 'nope', allowanceAtomic: 1n })).toThrow()
    expect(() => buildApproveCall({ usdcAddress: USDC, spender: SPENDER, allowanceAtomic: 0n })).toThrow()
  })
})
