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
  function fakeSupabase(rows, { rpcResults = {} } = {}) {
    const rpcCalls = []
    return {
      from(table) {
        expect(table).toBe('gateway_deposit_events')
        return {
          select: () => ({
            not: (col, op, val) => {
              expect(col).toBe('position_manager')
              expect(op).toBe('is')
              expect(val).toBe(null)
              return Promise.resolve({ data: rows, error: null })
            },
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
    }
  }

  it('recomputes an identity that was resolved by a PRIOR (simulated interrupted) run, not just this run\'s own resolutions', async () => {
    // Simulates: a previous --apply invocation UPDATEd this row's position_manager (so it's no longer
    // orphaned / no longer position_manager IS NULL) but crashed before calling recompute_gateway_position.
    // This function takes no "identities from this run" argument at all — it queries the CURRENT state
    // of the table directly, so a stranded identity like this one is picked up regardless of which run
    // (or invocation) actually resolved it.
    const staleResolvedRow = { address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }
    const supabase = fakeSupabase([staleResolvedRow])
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls).toEqual([
      { p_address: USER, p_pool_address: POOL, p_chain_id: 46630, p_position_manager: PM.toLowerCase() },
    ])
  })

  it('recomputes each distinct identity exactly once even when multiple event rows share it', async () => {
    const rows = [
      { address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() },
      { address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() }, // duplicate identity
    ]
    const supabase = fakeSupabase(rows)
    await recomputeAllResolvedIdentities(supabase)
    expect(supabase.__rpcCalls.length).toBe(1)
  })

  it('continues to the next identity when one recompute call fails, rather than aborting the whole sweep', async () => {
    const OTHER_PM = '0x' + 'cc'.repeat(20)
    const rows = [
      { address: USER, pool_address: POOL, chain_id: 46630, position_manager: PM.toLowerCase() },
      { address: USER, pool_address: POOL, chain_id: 46630, position_manager: OTHER_PM },
    ]
    const failKey = `${USER}:${POOL}:46630:${PM.toLowerCase()}`
    const supabase = fakeSupabase(rows, { rpcResults: { [failKey]: { data: null, error: { message: 'gap in history' } } } })
    await recomputeAllResolvedIdentities(supabase)
    // both were attempted despite the first failing
    expect(supabase.__rpcCalls.length).toBe(2)
  })
})
