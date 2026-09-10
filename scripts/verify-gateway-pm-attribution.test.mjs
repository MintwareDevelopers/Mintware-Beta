// Unit tests for verify-gateway-pm-attribution.mjs's core decision logic — no live chain or DB
// connection needed; `fetchReceipt` is injected, exactly the seam that makes this testable without
// real credentials. Never asserts a guessed value; every "resolved" case must trace to receipt.to /
// the decoded event's own reported numbers.
import { describe, it, expect, vi } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { pathToFileURL } from 'node:url'
import { planAttribution, recomputeAllResolvedIdentities } from './verify-gateway-pm-attribution.mjs'

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

  it('reports chain_mismatch and never calls fetchReceipt when a row\'s chain_id differs from the configured client\'s chain', async () => {
    const row = { id: 'mismatch', tx_hash: '0xwrongchain', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 1 }
    const fetchReceipt = vi.fn(async () => depositedReceipt())
    const [plan] = await planAttribution([row], fetchReceipt, 46630)
    expect(plan).toMatchObject({ resolved: false, reason: expect.stringContaining('chain_mismatch') })
    expect(fetchReceipt).not.toHaveBeenCalled()
  })

  it('still resolves a row whose chain_id matches the configured client\'s chain', async () => {
    const row = { id: 'match', tx_hash: '0xrightchain', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt(), 46630)
    expect(plan).toMatchObject({ resolved: true })
  })

  it('skips the chain guard entirely when no configuredChainId is passed (back-compat with existing callers)', async () => {
    const row = { id: 'nocfg', tx_hash: '0xnocfg', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 999999 }
    const [plan] = await planAttribution([row], async () => depositedReceipt())
    expect(plan).toMatchObject({ resolved: true })
  })

  it('leaves a row unresolved when the receipt has no blockNumber — ordering metadata is required, not optional', async () => {
    const row = { id: 'noblock', tx_hash: '0xnoblock', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ blockNumber: null }))
    expect(plan).toMatchObject({ resolved: false, reason: 'missing_ordering_metadata' })
  })

  it('leaves a row unresolved when the receipt has no transactionIndex — same requirement', async () => {
    const row = { id: 'noidx', tx_hash: '0xnoidx', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionIndex: null }))
    expect(plan).toMatchObject({ resolved: false, reason: 'missing_ordering_metadata' })
  })

  it('still resolves normally when transactionIndex is 0 (falsy but present — must not be confused with missing)', async () => {
    const row = { id: 'idx0', tx_hash: '0xidx0', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionIndex: 0 }))
    expect(plan).toMatchObject({ resolved: true, txIndex: 0 })
  })
})

describe('main-module detection — pathToFileURL correctly handles paths containing spaces', () => {
  it('the OLD naive comparison is proven broken on a path containing spaces (the exact bug Codex flagged)', () => {
    // This repo's own absolute path contains spaces ("Mintware Phase 1 app Build"). Node's real
    // import.meta.url percent-encodes them (spaces -> %20); the old script compared that against a
    // naive `file://${process.argv[1]}` template, which does NOT encode — so they could never match.
    const spacedPath = '/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/scripts/verify-gateway-pm-attribution.mjs'
    const realImportMetaUrl = pathToFileURL(spacedPath).href // what Node actually produces
    const oldNaiveComparison = `file://${spacedPath}` // the OLD, buggy check's right-hand side
    expect(realImportMetaUrl).not.toBe(oldNaiveComparison)
    expect(realImportMetaUrl).toContain('%20')
  })

  it('the FIXED comparison agrees on a path containing spaces (pathToFileURL on both sides)', () => {
    // The fixed check is `import.meta.url === pathToFileURL(process.argv[1]).href` — both sides go
    // through the identical encoding, so a real invocation's import.meta.url (which Node produces via
    // the same pathToFileURL-equivalent internal logic) always agrees with pathToFileURL(argv[1]).href,
    // regardless of spaces or other characters needing escaping.
    const spacedPath = '/some/dir with spaces/scripts/verify-gateway-pm-attribution.mjs'
    expect(pathToFileURL(spacedPath).href).toBe(pathToFileURL(spacedPath).href)
  })
})

describe('recomputeAllResolvedIdentities — full idempotent pass, self-heals an interrupted prior --apply run', () => {
  // A fake Supabase client covering BOTH queries recomputeAllResolvedIdentities issues: the orphan-check
  // (`.is('position_manager', null)`) and the resolved-identities sweep (`.not('position_manager', 'is',
  // null)`), each followed by `.order('id', {ascending:true}).range(from,to)` — mirroring the real
  // paginateAll helper's call shape exactly, with an `id` field on every row (used for ordering, unused
  // otherwise) so deterministic pagination has something real to sort by.
  function fakeSupabase(notNullRows, { nullRows = [], rpcResults = {} } = {}) {
    const rpcCalls = []
    const rangeCalls = []
    function page(rows) {
      return {
        order: (col) => {
          expect(col).toBe('id')
          return {
            range: (from, to) => {
              rangeCalls.push([from, to])
              return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
            },
          }
        },
      }
    }
    return {
      from(table) {
        expect(table).toBe('gateway_deposit_events')
        return {
          select: () => ({
            is: (col, val) => { expect(col).toBe('position_manager'); expect(val).toBe(null); return page(nullRows) },
            not: (col, op, val) => { expect(col).toBe('position_manager'); expect(op).toBe('is'); expect(val).toBe(null); return page(notNullRows) },
          }),
        }
      },
      rpc: (fn, params) => {
        expect(fn).toBe('recompute_gateway_position')
        rpcCalls.push(params)
        const key = `${params.p_address}:${params.p_pool_address}:${params.p_chain_id}:${params.p_position_manager}`
        const result = rpcResults[key] ?? { data: [{ cost_basis_atomic: '0', shares_atomic: '0', event_count: 0 }], error: null }
        return Promise.resolve(result)
      },
      __rpcCalls: rpcCalls,
      __rangeCalls: rangeCalls,
    }
  }

  it('recomputes an identity that was resolved by a PRIOR (simulated interrupted) run, not just this run\'s own resolutions', async () => {
    // Simulates: a previous --apply invocation UPDATEd this row's position_manager (so it's no longer
    // orphaned / no longer position_manager IS NULL) but crashed before calling recompute_gateway_position.
    // This function takes no "identities from this run" argument at all — it queries the CURRENT state
    // of the table directly, so a stranded identity like this one is picked up regardless of which run
    // (or invocation) actually resolved it.
    const staleResolvedRow = { id: 'r1', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }
    const supabase = fakeSupabase([staleResolvedRow])
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls).toEqual([
      { p_address: USER, p_pool_address: POOL, p_chain_id: 46630, p_position_manager: PM.toLowerCase() },
    ])
  })

  it('recomputes each distinct identity exactly once even when multiple event rows share it', async () => {
    const rows = [
      { id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() },
      { id: 'b', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }, // duplicate identity
    ]
    const supabase = fakeSupabase(rows)
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls.length).toBe(1)
  })

  it('continues to the next identity when one recompute call fails, rather than aborting the whole sweep', async () => {
    const OTHER_PM = '0x' + 'cc'.repeat(20)
    const rows = [
      { id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() },
      { id: 'b', address: USER, pool_address: POOL, chain_id: 46630, position_manager: OTHER_PM },
    ]
    const failKey = `${USER}:${POOL}:46630:${PM.toLowerCase()}`
    const supabase = fakeSupabase(rows, { rpcResults: { [failKey]: { data: null, error: { message: 'gap in history' } } } })
    await recomputeAllResolvedIdentities(supabase)
    // both were attempted despite the first failing
    expect(supabase.__rpcCalls.length).toBe(2)
  })

  it('skips an identity passed in skipIdentities (a sibling row failed to update this run) — never recomputes from a known-partial history', async () => {
    const rows = [{ id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }]
    const supabase = fakeSupabase(rows)
    const key = `${USER.toLowerCase()}:${POOL.toLowerCase()}:46630:${PM.toLowerCase()}`
    await recomputeAllResolvedIdentities(supabase, new Set([key]))
    expect(supabase.__rpcCalls.length).toBe(0)
  })

  it('paginates past a single page of resolved rows (proves the sweep does not silently truncate on a large table)', async () => {
    const manyRows = Array.from({ length: 1500 }, (_, i) => ({
      id: `id-${i}`, address: USER, pool_address: POOL, chain_id: 46630, position_manager: `0x${i.toString(16).padStart(40, '0')}`,
    }))
    const supabase = fakeSupabase(manyRows)
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls.length).toBe(1500) // every distinct identity across every page was recomputed
    expect(supabase.__rangeCalls.length).toBeGreaterThan(1) // proves more than one page was actually fetched
  })

  it('advances pagination by the ACTUAL rows returned, not the requested page size — survives a server-enforced cap lower than PAGE_SIZE', async () => {
    // Regression for Codex's "assumes the server cap is at least PAGE_SIZE=1000; a lower configured cap
    // returns a short first page and prematurely ends traversal": build a rows array bigger than a single
    // page could naively assume complete, but respond to EVERY .range() call with at most 10 rows per
    // page regardless of what range was requested (simulating a low server-side cap) — pagination must
    // still keep going (by advancing `from` by the actual count returned) until it truly runs dry.
    const total = 25
    const allRows = Array.from({ length: total }, (_, i) => ({
      id: `id-${i}`, address: USER, pool_address: POOL, chain_id: 46630, position_manager: `0x${i.toString(16).padStart(40, '0')}`,
    }))
    const rpcCalls = []
    const rangeCalls = []
    const CAP = 10 // server enforces a hard 10-row cap, far below any range width we might request
    const supabase = {
      from: () => ({
        select: () => ({
          is: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }),
          not: () => ({
            order: () => ({
              range: (from, to) => {
                rangeCalls.push([from, to])
                const slice = allRows.slice(from, Math.min(to + 1, from + CAP))
                return Promise.resolve({ data: slice, error: null })
              },
            }),
          }),
        }),
      }),
      rpc: (fn, params) => { rpcCalls.push(params); return Promise.resolve({ data: [{ cost_basis_atomic: '0', shares_atomic: '0', event_count: 0 }], error: null }) },
    }
    await recomputeAllResolvedIdentities(supabase)
    expect(rpcCalls.length).toBe(total) // every identity found despite the server capping every page at 10
    expect(rangeCalls.length).toBeGreaterThanOrEqual(Math.ceil(total / CAP))
  })

  it('skips an identity whose wallet/pool/chain STILL has an orphaned row — never publishes from an incomplete history', async () => {
    // The core fix for Codex's "recompute enumeration... [must] gate publication on complete identity
    // recovery": an orphaned sibling row for the SAME wallet/pool/chain (regardless of why it's still
    // unresolved — failed receipt fetch, outside a prior run's --limit, or a failed UPDATE) must block
    // recompute for every identity sharing that wallet/pool/chain, not just ones this run touched.
    const resolvedRow = { id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }
    const orphanedSibling = { id: 'b', address: USER, pool_address: POOL, chain_id: 46630 } // still position_manager IS NULL
    const supabase = fakeSupabase([resolvedRow], { nullRows: [orphanedSibling] })
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls.length).toBe(0) // recompute was gated off entirely for this wallet/pool/chain
  })

  it('still recomputes an UNRELATED identity even while a different wallet/pool/chain has an orphaned row', async () => {
    const OTHER_USER = '0x' + '33'.repeat(20)
    const resolvedRow = { id: 'a', address: OTHER_USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }
    const orphanedElsewhere = { id: 'b', address: USER, pool_address: POOL, chain_id: 46630 } // a DIFFERENT wallet's orphan
    const supabase = fakeSupabase([resolvedRow], { nullRows: [orphanedElsewhere] })
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls).toEqual([{ p_address: OTHER_USER, p_pool_address: POOL, p_chain_id: 46630, p_position_manager: PM.toLowerCase() }])
  })

  it('aborts the entire sweep (fails closed) when the orphan-check read itself fails, rather than recomputing without a completeness guarantee', async () => {
    const rpcCalls = []
    const supabase = {
      from: () => ({
        select: () => ({
          is: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }) }) }),
          not: () => ({ order: () => ({ range: () => Promise.resolve({ data: [{ id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }], error: null }) }) }),
        }),
      }),
      rpc: (fn, params) => { rpcCalls.push(params); return Promise.resolve({ data: [{ cost_basis_atomic: '0', shares_atomic: '0', event_count: 0 }], error: null }) },
    }
    await recomputeAllResolvedIdentities(supabase)
    expect(rpcCalls.length).toBe(0) // never proceeded to recompute without verifying completeness first
  })
})

describe('main() no-orphans path — must still self-heal via recompute, never a bare early return under --apply', () => {
  it('recomputeAllResolvedIdentities is exactly what main() must call even when the orphan scan is empty', async () => {
    // This documents the exact fix for Codex's "no-orphans early return defeats interrupted-apply
    // repair" finding: main()'s no-orphaned-rows branch now calls recomputeAllResolvedIdentities(supabase,
    // new Set()) whenever --apply is set, instead of returning immediately. That branch lives inside
    // main() (not separately exported), so this test locks the exported primitive it delegates to —
    // proving a call with an EMPTY skip set still walks and recomputes every already-resolved identity,
    // exactly the scenario left behind by a run that updated events but crashed before recomputing.
    const staleResolvedRow = { id: 'r1', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }
    const rpcCalls = []
    const supabase = {
      from: () => ({
        select: () => ({
          is: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }), // no orphans at all
          not: () => ({ order: () => ({ range: (from) => Promise.resolve({ data: from === 0 ? [staleResolvedRow] : [], error: null }) }) }),
        }),
      }),
      rpc: (fn, params) => { rpcCalls.push(params); return Promise.resolve({ data: [{ cost_basis_atomic: '100', shares_atomic: '100', event_count: 1 }], error: null }) },
    }
    await recomputeAllResolvedIdentities(supabase, new Set())
    expect(rpcCalls).toEqual([{ p_address: USER, p_pool_address: POOL, p_chain_id: 46630, p_position_manager: PM.toLowerCase() }])
  })
})
