import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ reads: vi.fn() }))
vi.mock('viem', () => ({ createPublicClient: () => ({ readContract: state.reads }), http: vi.fn(), erc20Abi: [], zeroAddress: '0x' + '00'.repeat(20) }))
vi.mock('@/lib/org/treasuryReader', () => ({ rpcForChain: () => 'https://rpc.test' }))
vi.mock('@/lib/web3/chains', () => ({ viemChainFor: () => ({ id: 84532 }) }))
vi.mock('@/lib/web3/artifacts/mintwareYieldVault', () => ({ YIELD_VAULT_ABI: [] }))
vi.mock('@/lib/web3/artifacts/mintwarePaymentGateway', () => ({ PAYMENT_GATEWAY_ABI: [] }))
vi.mock('@/lib/org/cardFundingReader', () => ({ readCardFundingGateway: async () => '0x' + '22'.repeat(20) }))

const ORG = 'org-1'
const CARD = 'card-1'
const MEMBER = '0x' + '11'.repeat(20)
const baseDb = (buffer: Record<string, unknown>) => fakeSupabase({ tables: {
  orgs: [{ id: ORG, card_funding_vault_address: '0x' + '33'.repeat(20), card_funding_chain_id: 84532, treasury_vault_address: '0x' + '44'.repeat(20) }],
  card_spend_buffers: [{ id: 'buffer-1', org_card_id: CARD, member_wallet: MEMBER, ...buffer }],
} })

describe('syncBufferBalance legacy gateway guard', () => {
  it('skips linked rows while gateway_position_id still exists', async () => {
    state.reads = vi.fn()
    const { syncBufferBalance } = await import('./bufferMonitor')
    const { client } = baseDb({ gateway_position_id: 'legacy-position-1' })
    expect(await syncBufferBalance({ supabase: client, orgId: ORG, orgCardId: CARD })).toEqual({ ok: false, reason: 'gateway_funded' })
    expect(state.reads).not.toHaveBeenCalled()
  })

  it('continues syncing after gateway_position_id has been dropped', async () => {
    state.reads = vi.fn(async ({ functionName }: { functionName: string }) => functionName === 'bufferOf' ? MEMBER : functionName === 'asset' ? '0x' + '55'.repeat(20) : 123n)
    const { syncBufferBalance } = await import('./bufferMonitor')
    const { client, db } = baseDb({})
    const missingColumnClient = {
      from: (table: string) => {
        const builder = (client as any).from(table) as any
        if (table !== 'card_spend_buffers') return builder
        const select = builder.select.bind(builder)
        builder.select = (columns: string) => columns.includes('gateway_position_id')
          ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } }) }) }
          : select(columns)
        return builder
      },
    } as never
    expect(await syncBufferBalance({ supabase: missingColumnClient, orgId: ORG, orgCardId: CARD })).toEqual({ ok: true, balanceAtomic: 123n })
    expect(state.reads).toHaveBeenCalled()
    expect(db.tables.card_spend_buffers[0].buffer_balance_atomic).toBe('123')
  })
})
