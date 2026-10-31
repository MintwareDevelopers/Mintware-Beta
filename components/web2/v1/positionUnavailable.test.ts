import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { V1PoolDetail } from './V1PoolDetail'
import { V1Portfolio } from './V1Portfolio'

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, simulate: vi.fn() }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = state.cursor++
    if (!(i in state.values)) state.values[i] = typeof initial === 'function' ? initial() : initial
    return [state.values[i], (value: unknown) => { state.values[i] = typeof value === 'function' ? value(state.values[i]) : value }]
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {},
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('wagmi', () => ({ useAccount: () => ({ connector: { getProvider: async () => ({ request: vi.fn() }) } }) }))
vi.mock('@/lib/web3/useMintwareIdentity', () => ({ useMintwareIdentity: () => ({ address: '0x' + '44'.repeat(20), isConnected: true }) }))
vi.mock('@/components/web2/providers', () => ({ useMintwarePrivy: () => ({ login: vi.fn() }) }))
vi.mock('./TokenPair', () => ({ TokenPair: () => null }))
vi.mock('viem', async (original) => ({
  ...await original<typeof import('viem')>(),
  createPublicClient: () => ({ simulateContract: state.simulate }),
  createWalletClient: () => ({}),
}))

const pool = '0x' + 'ab'.repeat(32)
const engine = '0x' + '11'.repeat(20)
const position = { shares: '2000000000000000000', positionValueAtomic: null, valuationAvailable: false }
const meta = {
  poolAddress: pool, engineAddress: engine, positionManager: engine, pairLabel: 'WETH / USDC',
  chainId: 84532, rpcUrl: 'https://base-sepolia-rpc.publicnode.com', source: 'registry', live: true,
  quoteAsset: '0x' + '22'.repeat(20), token0: '0x' + '22'.repeat(20), pairedDecimals: 18,
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

beforeEach(() => {
  state.cursor = 0; state.values = []; state.simulate.mockReset()
  state.simulate.mockResolvedValue({ result: [2_000_000_000_000_000_000n, 1_000_000n, 500_000_000_000_000n] })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true, position, totalNav: null, totalSupply: '10000000000000000000' }) }))
})
afterEach(() => vi.unstubAllGlobals())

it('MW-05: pool displays unavailable value and readable shares, and still simulates withdrawal', async () => {
  state.values = [meta, 'ok', null, null, position, 'withdraw', '', 100, 'idle', null, null, '']
  const tree = V1PoolDetail({ slug: pool })
  const html = renderToStaticMarkup(tree)
  expect(html).toMatch(/Position value[\s\S]*?Unavailable/)
  expect(html).toMatch(/Shares[\s\S]*?>2</)
  const button = elements(tree).find((e) => e.type === 'button' && e.props.children === 'Review withdraw')!
  expect(button).toBeDefined()
  expect(button.props.disabled).toBe(false)
  await (button.props.onClick as () => Promise<void>)()
  expect(state.simulate).toHaveBeenCalledWith(expect.objectContaining({
    functionName: 'withdraw', args: [2_000_000_000_000_000_000n, '0x' + '44'.repeat(20), 0n, 0n],
  }))
  expect(state.values[8]).toBe('review')
  expect(state.values[9]).toMatchObject({ kind: 'withdraw', minQuote: 990_000n, minPaired: 495_000_000_000_000n })
})

it('MW-05: portfolio retains a manageable position with unavailable value and human-readable shares', () => {
  state.values = [[{ ...position, poolAddress: pool, marketEngine: engine, chainId: 84532, pairLabel: 'WETH / USDC', live: true }], false,
    [{ poolAddress: pool, chainId: 84532, quoteDecimals: 6, quoteSymbol: 'USDC' }]]
  const html = renderToStaticMarkup(V1Portfolio())
  expect(html).toContain('Value unavailable')
  expect(html).toContain('2 shares')
  expect(html).not.toContain('2000000000000000000 shares')
  expect(html).toContain(`/app/markets/${pool}`)
  expect(html).toContain('Manage')
})
