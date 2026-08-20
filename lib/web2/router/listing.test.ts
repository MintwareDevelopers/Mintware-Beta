import { describe, it, expect } from 'vitest'
import {
  getListedPool, staticRegistry, EMPTY_REGISTRY, registryFromFetcher, isZeroForOne,
  type PoolRegistry, type RouterPoolRow,
} from './listing'
import type { ListedPool } from './types'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const pool: ListedPool = {
  chainId: 8453,
  router: '0xrouter',
  hooks: '0xhook',
  currency0: USDC,
  currency1: WETH,
  fee: 3000,
  tickSpacing: 60,
}

describe('getListedPool — empty registry (today)', () => {
  it('returns null for any pair', async () => {
    expect(await getListedPool(8453, USDC, WETH, EMPTY_REGISTRY)).toBeNull()
    expect(await getListedPool(8453, USDC, WETH)).toBeNull() // default is empty
  })
})

describe('getListedPool — static registry', () => {
  const reg = staticRegistry([pool])

  it('matches a listed pair', async () => {
    expect(await getListedPool(8453, USDC, WETH, reg)).toEqual(pool)
  })

  it('matches regardless of token order', async () => {
    expect(await getListedPool(8453, WETH, USDC, reg)).toEqual(pool)
  })

  it('matches case-insensitively', async () => {
    expect(await getListedPool(8453, USDC.toLowerCase(), WETH.toUpperCase(), reg)).toEqual(pool)
  })

  it('returns null on a different chain', async () => {
    expect(await getListedPool(1, USDC, WETH, reg)).toBeNull()
  })

  it('returns null for an unlisted pair', async () => {
    expect(await getListedPool(8453, USDC, '0xdead', reg)).toBeNull()
  })
})

describe('getListedPool — degenerate + invalid input', () => {
  const reg = staticRegistry([pool])

  it('returns null when both tokens are the same', async () => {
    expect(await getListedPool(8453, USDC, USDC, reg)).toBeNull()
    expect(await getListedPool(8453, USDC, USDC.toLowerCase(), reg)).toBeNull()
  })

  it('returns null for invalid chainIds', async () => {
    expect(await getListedPool(0, USDC, WETH, reg)).toBeNull()
    expect(await getListedPool(-1, USDC, WETH, reg)).toBeNull()
    expect(await getListedPool(1.5, USDC, WETH, reg)).toBeNull()
  })

  it('returns null for missing tokens', async () => {
    expect(await getListedPool(8453, '', WETH, reg)).toBeNull()
    expect(await getListedPool(8453, USDC, '', reg)).toBeNull()
  })
})

describe('getListedPool — fail-safe on registry error', () => {
  it('swallows a throwing registry and returns null', async () => {
    const boom: PoolRegistry = {
      async find() {
        throw new Error('supabase down')
      },
    }
    expect(await getListedPool(8453, USDC, WETH, boom)).toBeNull()
  })
})

describe('isZeroForOne', () => {
  it('is true when selling currency0', () => {
    expect(isZeroForOne(pool, USDC)).toBe(true)
    expect(isZeroForOne(pool, USDC.toUpperCase())).toBe(true)
    expect(isZeroForOne(pool, WETH)).toBe(false)
  })
})

describe('registryFromFetcher', () => {
  const row: RouterPoolRow = {
    chain_id: 8453, router: '0xrouter', hooks: '0xhook',
    currency0: USDC, currency1: WETH, fee: 3000, tick_spacing: 60, active: true,
  }

  it('maps rows and matches a pair order-independently', async () => {
    const reg = registryFromFetcher(async () => [row])
    expect(await reg.find(8453, WETH, USDC)).toEqual(pool)
  })

  it('drops inactive rows', async () => {
    const reg = registryFromFetcher(async () => [{ ...row, active: false }])
    expect(await reg.find(8453, USDC, WETH)).toBeNull()
  })

  it('returns null for an empty registry', async () => {
    const reg = registryFromFetcher(async () => [])
    expect(await reg.find(8453, USDC, WETH)).toBeNull()
  })

  it('propagated errors are swallowed by getListedPool → null', async () => {
    const reg = registryFromFetcher(async () => { throw new Error('db down') })
    expect(await getListedPool(8453, USDC, WETH, reg)).toBeNull()
  })
})
