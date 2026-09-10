import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'
import { hasUnresolvedHistory, fetchUnresolvedPoolChainKeys } from './attributionCompleteness'

const USER = '0x' + '11'.repeat(20)
const POOL = '0x' + 'ab'.repeat(32)
const OTHER_POOL = '0x' + 'cd'.repeat(32)

describe('hasUnresolvedHistory', () => {
  it('returns false when no orphaned rows exist for this exact wallet/pool/chain', async () => {
    const { client } = fakeSupabase()
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })

  it('returns true when an orphaned (position_manager IS NULL) row exists for this exact wallet/pool/chain', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(true)
  })

  it('returns false when the orphaned row is for a DIFFERENT pool', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: OTHER_POOL, chain_id: 46630, position_manager: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })

  it('returns false when the row for this wallet/pool/chain is already resolved (position_manager set)', async () => {
    const PM = '0x' + 'aa'.repeat(20)
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })

  it('returns false when the orphaned row is for a DIFFERENT chain', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 1, position_manager: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })

  it('fails CLOSED (returns true) when the read itself errors — never silently claims completeness', async () => {
    const chain = { eq: () => chain, is: () => chain, limit: async () => ({ data: null, error: { message: 'connection reset' } }) }
    const supabase = { from: () => ({ select: () => chain }) }
    expect(await hasUnresolvedHistory(supabase as never, USER, POOL, 46630)).toBe(true)
  })

  // Codex (2026-09-10): "atomic apply deliberately skips sibling PMs with missing mint/burn metadata or
  // over-burn history while completing the target PM... persist/reveal that incomplete sibling status
  // before claiming every returned basis complete." A resolved (non-null PM) row missing its own
  // kind-appropriate share field is exactly the sibling apply_gateway_pm_attribution silently leaves
  // untouched — this must ALSO mark the wallet/pool/chain incomplete, not just an outright orphan.
  const PM = '0x' + 'aa'.repeat(20)
  it('returns true when a RESOLVED deposit row is missing shares_minted (the sibling-gap case, not an orphan)', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM, kind: 'deposit', shares_minted: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(true)
  })

  it('returns true when a RESOLVED withdraw row is missing shares_burned', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM, kind: 'withdraw', shares_burned: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(true)
  })

  it('returns false when the resolved row has its own share field populated (no gap)', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM, kind: 'deposit', shares_minted: '1000000' }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })

  it('a gap row for a DIFFERENT pool does not mark THIS pool incomplete', async () => {
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: OTHER_POOL, chain_id: 46630, position_manager: PM, kind: 'deposit', shares_minted: null }] } })
    expect(await hasUnresolvedHistory(client, USER, POOL, 46630)).toBe(false)
  })
})

describe('fetchUnresolvedPoolChainKeys', () => {
  it('returns an empty set when the wallet has no orphaned rows at all', async () => {
    const { client } = fakeSupabase()
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set())
  })

  it('returns one key per distinct pool/chain the wallet has an orphaned row in', async () => {
    const { client } = fakeSupabase({
      tables: {
        gateway_deposit_events: [
          { address: USER, pool_address: POOL, chain_id: 46630, position_manager: null },
          { address: USER, pool_address: POOL, chain_id: 46630, position_manager: null }, // duplicate — collapses to one key
          { address: USER, pool_address: OTHER_POOL, chain_id: 46630, position_manager: null },
        ],
      },
    })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set([`${POOL.toLowerCase()}:46630`, `${OTHER_POOL.toLowerCase()}:46630`]))
  })

  it('never includes an already-resolved row (position_manager set) as an orphan', async () => {
    const PM = '0x' + 'aa'.repeat(20)
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM }] } })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set())
  })

  it('never includes a DIFFERENT wallet\'s orphaned row', async () => {
    const OTHER_USER = '0x' + '22'.repeat(20)
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: OTHER_USER, pool_address: POOL, chain_id: 46630, position_manager: null }] } })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set())
  })

  it('returns null (fail closed) when the read itself errors — callers must never treat this as "nothing orphaned"', async () => {
    const chain = { eq: () => chain, is: () => chain, not: () => chain, or: () => chain, order: () => chain, range: async () => ({ data: null, error: { message: 'connection reset' } }) }
    const supabase = { from: () => ({ select: () => chain }) }
    const keys = await fetchUnresolvedPoolChainKeys(supabase as never, USER)
    expect(keys).toBeNull()
  })

  it('includes a pool/chain key for a RESOLVED row with a share-field gap, not just an outright orphan', async () => {
    const PM = '0x' + 'aa'.repeat(20)
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: [{ address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM, kind: 'withdraw', shares_burned: null }] } })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set([`${POOL.toLowerCase()}:46630`]))
  })

  it('paginates past a single page of a wallet\'s event history (does not silently truncate a large history)', async () => {
    // Codex (2026-09-10): flagged unpaginated queries here as the same silent-truncation class of bug
    // already fixed in the recovery script's own sweep. Build more distinct orphaned pool/chain
    // combinations than a single unbounded select could be assumed to return in full.
    const manyOrphans = Array.from({ length: 1500 }, (_, i) => ({
      address: USER, pool_address: `0x${i.toString(16).padStart(64, '0')}`, chain_id: 46630, position_manager: null,
    }))
    const { client } = fakeSupabase({ tables: { gateway_deposit_events: manyOrphans } })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys?.size).toBe(1500) // every distinct pool found across every page, none silently dropped
  })

  it('dedupes into one key when a pool/chain has BOTH an orphan and a separate gappy resolved row', async () => {
    const PM = '0x' + 'aa'.repeat(20)
    const { client } = fakeSupabase({
      tables: {
        gateway_deposit_events: [
          { address: USER, pool_address: POOL, chain_id: 46630, position_manager: null },
          { address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM, kind: 'deposit', shares_minted: null },
        ],
      },
    })
    const keys = await fetchUnresolvedPoolChainKeys(client, USER)
    expect(keys).toEqual(new Set([`${POOL.toLowerCase()}:46630`]))
  })
})
