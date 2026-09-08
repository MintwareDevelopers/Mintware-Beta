// RED-TEAM PoC (off-chain, 2026-09-08) — A-4 exploited end-to-end through harvestGateway():
// fee credits are weighted by DB `gateway_positions.shares` (written only by the user-invoked record
// routes, which the UI never successfully calls) — NOT by on-chain sharesOf. A depositor who has fully
// withdrawn on-chain keeps a stale DB share row and collects other depositors' fee income into a linked
// card_spend_buffers row, which the card rail authorizes against (CARD_BUFFER_ENABLED → reserve_card_buffer).
// Passing = demonstrated. Mocks: chain client, signer, wallet client, router seam; real viem event codec.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { fakeSupabase } from './fakeSupabase'

const PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const SEAT = '0x18ae000000000000000000000000000000000663' as const
const POOL = '0x' + 'ab'.repeat(32)
const ALICE = '0xa11ce00000000000000000000000000000000001' // withdrew 100% on-chain, DB row stale
const BOB = '0xb0b0000000000000000000000000000000000002' // the only real remaining depositor
const COLLECT_TX = ('0x' + '11'.repeat(32)) as `0x${string}`
const GROSS = 10_000_000n // 10 USDG of collected fees

const onChainShares: Record<string, bigint> = { [ALICE]: 0n, [BOB]: 1_000_000_000n }

const publicClient = {
  chain: { id: 46630 },
  readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    if (functionName === 'sharesOf') return onChainShares[String(args?.[0]).toLowerCase()] ?? 0n
    if (functionName === 'quoteAsset') return '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
    throw new Error(`unexpected read ${functionName}`)
  }),
  simulateContract: vi.fn(async () => ({ result: [GROSS, 0n] })),
  waitForTransactionReceipt: vi.fn(async () => ({
    status: 'success',
    logs: [{
      address: PM,
      topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'Harvested', args: { recipient: SEAT } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [GROSS, 0n]),
    }],
  })),
}

vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null }),
  gatewayPublicClient: () => publicClient,
}))
vi.mock('@/lib/web3/oracleSigner', () => ({ getOracleSigner: async () => ({ address: SEAT }) }))
vi.mock('@/lib/gateway/routerSwap', () => ({
  swapPairedToQuote: async () => ({ quoteOut: 0n, txHash: null }),
  swapQuoteToPaired: async () => ({ pairedOut: 0n, txHash: null }),
}))
vi.mock('viem', async (orig) => ({ ...(await orig<typeof import('viem')>()), createWalletClient: () => ({ writeContract: async () => COLLECT_TX }) }))

import { harvestGateway } from '../harvest'

beforeEach(() => {
  process.env.LP_GATEWAY_HARVEST_ENABLED = 'true'
  process.env.LP_GATEWAY_PERF_FEE_BPS = '1000'
  delete process.env.LP_GATEWAY_HARVEST_DESTINATION
})

describe('A-4 exploited: stale DB shares steal fee income; on-chain sharesOf is never consulted', () => {
  it('a fully-withdrawn depositor (on-chain 0 shares) is credited 50% of the harvest into a card-authorizable buffer', async () => {
    const { db, client } = fakeSupabase({
      uniques: { harvest_events: [['collect_tx']] },
      tables: {
        harvest_events: [],
        gateway_positions: [
          { id: 'p-alice', user_wallet: ALICE, pool_address: POOL, chain_id: 46630, shares: '1000000000', entry_nav: '1000000000' }, // STALE: withdrew on-chain
          { id: 'p-bob', user_wallet: BOB, pool_address: POOL, chain_id: 46630, shares: '1000000000', entry_nav: '1000000000' },
        ],
        // linked buffers (the A-4 "when linked" case). card_spend_buffers.buffer_balance_atomic is what
        // lib/org/cardAuthorize.ts (CARD_BUFFER_ENABLED) authorizes card swipes against via reserve_card_buffer.
        card_spend_buffers: [
          { id: 'b-alice', gateway_position_id: 'p-alice', buffer_balance_atomic: '0' },
          { id: 'b-bob', gateway_position_id: 'p-bob', buffer_balance_atomic: '0' },
        ],
      },
    })

    const out = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.grossAtomic).toBe(GROSS)
    expect(out.feeAtomic).toBe(1_000_000n)

    const alice = db.tables.card_spend_buffers.find((b) => b.id === 'b-alice')!
    const bob = db.tables.card_spend_buffers.find((b) => b.id === 'b-bob')!
    expect(BigInt(String(alice.buffer_balance_atomic))).toBe(4_500_000n) // ← 4.5 USDG to a wallet with ZERO on-chain shares
    expect(BigInt(String(bob.buffer_balance_atomic))).toBe(4_500_000n) // Bob, the sole real LP, is short-changed 50%

    // the orchestration never read sharesOf for anyone — DB is the only weighting source
    const readFns = publicClient.readContract.mock.calls.map((c) => (c[0] as { functionName: string }).functionName)
    expect(readFns).not.toContain('sharesOf')
  })

  it('credits are a non-atomic read-modify-write: a concurrent overwrite (e.g. bufferMonitor chain sync) between read and write is lost', async () => {
    // lib/org/bufferMonitor.ts#syncBufferBalance overwrites buffer_balance_atomic with usdc.balanceOf(bufferAddr).
    // Harvested fees sit in the SEAT wallet (harvestRecipient), not in the member's buffer wallet, so every sync
    // resets the IOU to the on-chain truth (0) — the harvest credit is money the ledger claims but no wallet holds.
    const { db, client } = fakeSupabase({
      uniques: { harvest_events: [['collect_tx']] },
      tables: {
        harvest_events: [],
        gateway_positions: [{ id: 'p-bob', user_wallet: BOB, pool_address: POOL, chain_id: 46630, shares: '1000000000', entry_nav: '0' }],
        card_spend_buffers: [{ id: 'b-bob', gateway_position_id: 'p-bob', buffer_balance_atomic: '0' }],
      },
    })
    await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    const afterHarvest = BigInt(String(db.tables.card_spend_buffers[0].buffer_balance_atomic))
    expect(afterHarvest).toBe(9_000_000n) // ledger says Bob can spend 9 USDG …
    // … while the recorded harvest event proves the 9 USDG landed at the seat, not in any buffer wallet
    const ev = db.tables.harvest_events[0]
    expect(String(ev.amount_credited_atomic)).toBe('9000000')
    // a chain-truth sync (0 in the buffer wallet) would now erase the IOU — or, if CARD_BUFFER_ENABLED and the
    // sync lags, a swipe of up to 9 USDG is authorized against funds that are not in the buffer wallet.
  })
})
