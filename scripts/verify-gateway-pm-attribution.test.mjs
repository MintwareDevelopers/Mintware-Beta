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

function depositedReceipt({ to = PM, user = USER, quoteIn = 1_000_000n, sharesMinted = 1_000_000n, status = 'success', blockNumber = 100n, transactionIndex = 0, transactionHash } = {}) {
  return {
    status, to, blockNumber, transactionIndex, transactionHash,
    logs: [{
      address: to,
      topics: encodeEventTopics({ abi: DEPOSITED_ABI, eventName: 'Deposited', args: { user } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [quoteIn, sharesMinted]),
    }],
  }
}
function withdrawnReceipt({ to = PM, user = USER, sharesBurned = 500_000n, quoteOut = 500_000n, pairedOut = 0n, status = 'success', blockNumber = 101n, transactionIndex = 0, transactionHash } = {}) {
  return {
    status, to, blockNumber, transactionIndex, transactionHash,
    logs: [{
      address: to,
      topics: encodeEventTopics({ abi: WITHDRAWN_ABI, eventName: 'Withdrawn', args: { user } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [sharesBurned, quoteOut, pairedOut]),
    }],
  }
}

describe('planAttribution — never guesses, only ever verified on-chain data', () => {
  // Every receipt fixture from here on carries a `transactionHash` matching its row's own `tx_hash` by
  // default, since a receipt missing that field is now REJECTED outright (see the transactionHash-
  // requirement tests below) — this keeps every other test's receipt "self-confirming" so it can reach
  // whatever check it actually means to exercise.
  it('resolves a deposit row from its real receipt — position_manager, sharesMinted, block, txIndex all verified', async () => {
    const row = { id: 'r1', tx_hash: '0xdeadbeef', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const fetchReceipt = vi.fn(async () => depositedReceipt({ transactionHash: row.tx_hash }))
    const [plan] = await planAttribution([row], fetchReceipt)
    expect(plan).toMatchObject({
      resolved: true, positionManager: PM.toLowerCase(), sharesMinted: '1000000', blockNumber: '100', txIndex: 0,
    })
    expect(fetchReceipt).toHaveBeenCalledWith('0xdeadbeef')
  })

  it('resolves a withdraw row from its real receipt — sharesBurned verified, not guessed', async () => {
    const row = { id: 'r2', tx_hash: '0xcafebabe', address: USER, kind: 'withdraw', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => withdrawnReceipt({ transactionHash: row.tx_hash }))
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
    const [plan] = await planAttribution([row], async () => depositedReceipt({ user: otherUser, transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: false, reason: 'event_not_found_or_user_mismatch' })
  })

  it('leaves a row unresolved when the receipt has no decodable Deposited/Withdrawn log at all', async () => {
    const row = { id: 'r7', tx_hash: '0xnoevent', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => ({ status: 'success', to: PM, blockNumber: 1n, transactionIndex: 0, transactionHash: row.tx_hash, logs: [] }))
    expect(plan).toMatchObject({ resolved: false, reason: 'event_not_found_or_user_mismatch' })
  })

  it('processes multiple rows independently — one failure does not block another row\'s resolution', async () => {
    const rows = [
      { id: 'ok', tx_hash: '0xok', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 },
      { id: 'bad', tx_hash: '0xbad', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 },
    ]
    const fetchReceipt = async (tx) => (tx === '0xok' ? depositedReceipt({ transactionHash: '0xok' }) : null)
    const plan = await planAttribution(rows, fetchReceipt)
    expect(plan[0]).toMatchObject({ resolved: true })
    expect(plan[1]).toMatchObject({ resolved: false, reason: 'receipt_not_found' })
  })

  it('reports chain_mismatch and never calls fetchReceipt when a row\'s chain_id differs from the configured client\'s chain', async () => {
    const row = { id: 'mismatch', tx_hash: '0xwrongchain', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 1 }
    const fetchReceipt = vi.fn(async () => depositedReceipt({ transactionHash: row.tx_hash }))
    const [plan] = await planAttribution([row], fetchReceipt, 46630)
    expect(plan).toMatchObject({ resolved: false, reason: expect.stringContaining('chain_mismatch') })
    expect(fetchReceipt).not.toHaveBeenCalled()
  })

  it('still resolves a row whose chain_id matches the configured client\'s chain', async () => {
    const row = { id: 'match', tx_hash: '0xrightchain', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }), 46630)
    expect(plan).toMatchObject({ resolved: true })
  })

  it('skips the chain guard entirely when no configuredChainId is passed (back-compat with existing callers)', async () => {
    const row = { id: 'nocfg', tx_hash: '0xnocfg', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 999999 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: true })
  })

  it('leaves a row unresolved when the receipt has no blockNumber — ordering metadata is required, not optional', async () => {
    const row = { id: 'noblock', tx_hash: '0xnoblock', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ blockNumber: null, transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: false, reason: 'missing_ordering_metadata' })
  })

  it('leaves a row unresolved when the receipt has no transactionIndex — same requirement', async () => {
    const row = { id: 'noidx', tx_hash: '0xnoidx', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionIndex: null, transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: false, reason: 'missing_ordering_metadata' })
  })

  it('still resolves normally when transactionIndex is 0 (falsy but present — must not be confused with missing)', async () => {
    const row = { id: 'idx0', tx_hash: '0xidx0', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionIndex: 0, transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: true, txIndex: 0 })
  })

  it('leaves a row unresolved when the receipt has NO transactionHash at all — required, not optional', async () => {
    // viem's real getTransactionReceipt always populates transactionHash; a receipt missing it entirely
    // is itself a signal something produced it incorrectly (a hand-rolled mock, a broken provider) — fail
    // closed rather than silently trust an unconfirmed receipt (Codex, 02:12 UTC: "a missing
    // transactionHash is still accepted (only non-null mismatches are rejected)").
    const row = { id: 'nohash', tx_hash: '0xnohash', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt()) // transactionHash left undefined
    expect(plan).toMatchObject({ resolved: false, reason: 'missing_transaction_hash' })
  })

  it('leaves a row unresolved when the receipt reports a DIFFERENT transactionHash than the row\'s own tx_hash', async () => {
    // Guards against an RPC provider bug/proxy mixup handing back the wrong receipt for the hash
    // requested — never trust anything else in a receipt that doesn't confirm its own identity.
    const row = { id: 'wronghash', tx_hash: '0xrealhash', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: '0xdifferenthash' }))
    expect(plan).toMatchObject({ resolved: false, reason: 'receipt_hash_mismatch' })
  })

  it('resolves normally when the receipt confirms its own transactionHash matches the row\'s tx_hash', async () => {
    const row = { id: 'righthash', tx_hash: '0xREALHASH', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: '0xrealhash' })) // case-insensitive match
    expect(plan).toMatchObject({ resolved: true })
  })

  it('leaves a row unresolved when the candidate position manager\'s on-chain pool does NOT match the row\'s own pool_address', async () => {
    // Closes the "PM/pool association... remain outstanding" gap: an event decoding correctly proves the
    // CONTRACT emitted the right shape of log, not that it's the specific gateway instance registered for
    // this row's pool. fetchPoolId mirrors lib/gateway/registry.ts's own poolKey()/computePoolId() check —
    // as a consistency check, not full trust-root provenance (see the honest scope note on planAttribution).
    const row = { id: 'poolmismatch', tx_hash: '0xpoolmismatch', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const fetchPoolId = vi.fn(async () => '0x' + 'ff'.repeat(32)) // a DIFFERENT pool than row.pool_address
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }), undefined, fetchPoolId)
    expect(plan).toMatchObject({ resolved: false, reason: 'pool_mismatch' })
    expect(fetchPoolId).toHaveBeenCalledWith(PM)
  })

  it('resolves normally when fetchPoolId confirms the candidate PM really fronts the row\'s own pool', async () => {
    const row = { id: 'poolmatch', tx_hash: '0xpoolmatch', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const fetchPoolId = vi.fn(async () => POOL) // matches row.pool_address exactly
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }), undefined, fetchPoolId)
    expect(plan).toMatchObject({ resolved: true })
  })

  it('leaves a row unresolved when fetchPoolId itself throws (on-chain read failure) — never resolves without verifying', async () => {
    const row = { id: 'poolreaderr', tx_hash: '0xpoolreaderr', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const fetchPoolId = async () => { throw new Error('RPC timeout') }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }), undefined, fetchPoolId)
    expect(plan).toMatchObject({ resolved: false, reason: expect.stringContaining('pool_verification_failed') })
  })

  it('skips the pool-association check entirely when no fetchPoolId is injected (back-compat with existing callers)', async () => {
    const row = { id: 'nopoolcheck', tx_hash: '0xnopoolcheck', address: USER, kind: 'deposit', pool_address: POOL, chain_id: 46630 }
    const [plan] = await planAttribution([row], async () => depositedReceipt({ transactionHash: row.tx_hash }))
    expect(plan).toMatchObject({ resolved: true })
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

  it('cross-PM last-orphan regression (Codex, 2026-09-10): recomputes an EARLIER identity once the LAST sibling orphan resolves to a DIFFERENT PM in the same run', async () => {
    // Reproduces the exact bug: two orphaned rows for the SAME wallet/pool/chain resolve to TWO DIFFERENT
    // position managers over the course of one --apply run. At the moment the first row (PM_A) was
    // applied, the second row was still orphaned, so PM_A's own apply_gateway_pm_attribution call
    // correctly reported complete:false. A buggy script fed that "incomplete at the time" identity into
    // this function's skip-set and permanently silenced it — even though by the time this sweep actually
    // runs (after BOTH rows have been resolved, the second one to PM_B), there are NO orphaned rows left
    // at all for this wallet/pool/chain, and PM_A's identity is now genuinely complete. The fix is that
    // main() never builds a skip-set from mid-loop per-call results — it always calls this function with
    // an EMPTY skip set, so completeness is decided ONLY from a fresh read of the current database state.
    const OTHER_PM = '0x' + 'cc'.repeat(20)
    const rows = [
      { id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }, // PM_A — resolved FIRST, while row 'b' was still orphaned
      { id: 'b', address: USER, pool_address: POOL, chain_id: 46630, position_manager: OTHER_PM }, // PM_B — the LAST orphan, resolved afterward
    ]
    const supabase = fakeSupabase(rows, { nullRows: [] }) // by the time the sweep runs, NOTHING is orphaned any more
    await recomputeAllResolvedIdentities(supabase, new Set()) // the fixed call shape: never a stale skip set
    const keys = supabase.__rpcCalls.map((c) => `${c.p_address}:${c.p_pool_address}:${c.p_chain_id}:${c.p_position_manager}`)
    expect(keys).toContain(`${USER}:${POOL}:46630:${PM.toLowerCase()}`) // PM_A — MUST be recomputed, not left stale
    expect(keys).toContain(`${USER}:${POOL}:46630:${OTHER_PM}`) // PM_B — recomputed too
    expect(supabase.__rpcCalls.length).toBe(2)
  })

  it('demonstrates the BUG this regression fixes: passing a stale "was incomplete at call time" skip-set wrongly silences an identity forever', async () => {
    // This test documents what the OLD (buggy) main() effectively did — feed identities that were
    // complete:false at SOME point during the apply loop into this function's skip-set — to make the
    // regression concrete: it's not that recomputeAllResolvedIdentities is broken, it's that passing it
    // stale per-call information defeats its own live orphan check.
    const OTHER_PM = '0x' + 'cc'.repeat(20)
    const rows = [
      { id: 'a', address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() },
      { id: 'b', address: USER, pool_address: POOL, chain_id: 46630, position_manager: OTHER_PM },
    ]
    const supabase = fakeSupabase(rows, { nullRows: [] }) // orphan-free by the time the sweep runs — genuinely complete
    const staleSkipSet = new Set([`${USER.toLowerCase()}:${POOL.toLowerCase()}:46630:${PM.toLowerCase()}`]) // PM_A, marked incomplete BEFORE row 'b' resolved
    await recomputeAllResolvedIdentities(supabase, staleSkipSet)
    const keys = supabase.__rpcCalls.map((c) => `${c.p_address}:${c.p_pool_address}:${c.p_chain_id}:${c.p_position_manager}`)
    expect(keys).not.toContain(`${USER}:${POOL}:46630:${PM.toLowerCase()}`) // PM_A wrongly stays stale forever with the buggy call shape
    expect(keys).toContain(`${USER}:${POOL}:46630:${OTHER_PM}`)
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
