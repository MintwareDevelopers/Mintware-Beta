// Unit tests for verify-gateway-pm-attribution.mjs's core decision logic — no live chain or DB
// connection needed; `fetchReceipt` is injected, exactly the seam that makes this testable without
// real credentials. Never asserts a guessed value; every "resolved" case must trace to receipt.to /
// the decoded event's own reported numbers.
import { describe, it, expect, vi } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { planAttribution } from './verify-gateway-pm-attribution.mjs'

const DEPOSITED_ABI = [{ type: 'event', name: 'Deposited', inputs: [
  { name: 'user', type: 'address', indexed: true }, { name: 'quoteIn', type: 'uint256', indexed: false }, { name: 'sharesMinted', type: 'uint256', indexed: false },
] }]
const WITHDRAWN_ABI = [{ type: 'event', name: 'Withdrawn', inputs: [
  { name: 'user', type: 'address', indexed: true }, { name: 'sharesBurned', type: 'uint256', indexed: false }, { name: 'quoteOut', type: 'uint256', indexed: false }, { name: 'pairedOut', type: 'uint256', indexed: false },
] }]

const PM = '0x' + 'aa'.repeat(20)
const USER = '0x' + '11'.repeat(20)
const POOL = '0x' + 'bb'.repeat(32)

function depositedReceipt({ to = PM, user = USER, quoteIn = 1_000_000n, sharesMinted = 1_000_000n, status = 'success', blockNumber = 100n, transactionIndex = 0 } = {}) {
  return {
    status, to, blockNumber, transactionIndex,
    logs: [{
      address: to,
      topics: encodeEventTopics({ abi: DEPOSITED_ABI, eventName: 'Deposited', args: { user } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [quoteIn, sharesMinted]),
    }],
  }
}
function withdrawnReceipt({ to = PM, user = USER, sharesBurned = 500_000n, quoteOut = 500_000n, pairedOut = 0n, status = 'success', blockNumber = 101n, transactionIndex = 0 } = {}) {
  return {
    status, to, blockNumber, transactionIndex,
    logs: [{
      address: to,
      topics: encodeEventTopics({ abi: WITHDRAWN_ABI, eventName: 'Withdrawn', args: { user } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [sharesBurned, quoteOut, pairedOut]),
    }],
  }
}

describe('planAttribution — never guesses, only ever verified on-chain data', () => {
  it('resolves a deposit row from its real receipt — position_manager, sharesMinted, block, txIndex all verified', async () => {
    const row = { id: 'r1', tx_hash: '0xdeadbeef', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const fetchReceipt = vi.fn(async () => depositedReceipt())
    const [plan] = await planAttribution([row], fetchReceipt)
    expect(plan).toMatchObject({
      resolved: true, positionManager: PM.toLowerCase(), sharesMinted: '1000000', blockNumber: '100', txIndex: 0,
    })
    expect(fetchReceipt).toHaveBeenCalledWith('0xdeadbeef')
  })

  it('resolves a withdraw row from its real receipt — sharesBurned verified, not guessed', async () => {
    const row = { id: 'r2', tx_hash: '0xcafebabe', address: USER, kind: 'withdraw', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => withdrawnReceipt())
    expect(plan).toMatchObject({ resolved: true, positionManager: PM.toLowerCase(), sharesBurned: '500000' })
  })

  it('leaves a row unresolved (never guesses) when the receipt cannot be found', async () => {
    const row = { id: 'r3', tx_hash: '0xmissing', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => null)
    expect(plan).toMatchObject({ resolved: false, reason: 'receipt_not_found' })
  })

  it('leaves a row unresolved when the transaction reverted', async () => {
    const row = { id: 'r4', tx_hash: '0xreverted', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ status: 'reverted' }))
    expect(plan).toMatchObject({ resolved: false, reason: 'tx_reverted' })
  })

  it('leaves a row unresolved when the receipt fetch itself throws (RPC error) — never silently guesses', async () => {
    const row = { id: 'r5', tx_hash: '0xerror', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => { throw new Error('rpc unavailable') })
    expect(plan.resolved).toBe(false)
    expect(plan.reason).toMatch(/receipt_fetch_failed/)
  })

  it('leaves a row unresolved when the decoded event is for a DIFFERENT user (never attributes to the wrong wallet)', async () => {
    const row = { id: 'r6', tx_hash: '0xwronguser', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const otherUser = '0x' + '22'.repeat(20)
    const [plan] = await planAttribution([row], async () => depositedReceipt({ user: otherUser }))
    expect(plan).toMatchObject({ resolved: false, reason: 'event_not_found_or_user_mismatch' })
  })

  it('leaves a row unresolved when the receipt has no decodable Deposited/Withdrawn log at all', async () => {
    const row = { id: 'r7', tx_hash: '0xnoevent', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => ({ status: 'success', to: PM, blockNumber: 1n, transactionIndex: 0, logs: [] }))
    expect(plan).toMatchObject({ resolved: false, reason: 'event_not_found_or_user_mismatch' })
  })

  it('processes multiple rows independently — one failure does not block another row\'s resolution', async () => {
    const rows = [
      { id: 'ok', tx_hash: '0xok', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 },
      { id: 'bad', tx_hash: '0xbad', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 },
    ]
    const fetchReceipt = async (tx) => (tx === '0xok' ? depositedReceipt() : null)
    const plan = await planAttribution(rows, fetchReceipt)
    expect(plan[0]).toMatchObject({ resolved: true })
    expect(plan[1]).toMatchObject({ resolved: false, reason: 'receipt_not_found' })
  })
})
