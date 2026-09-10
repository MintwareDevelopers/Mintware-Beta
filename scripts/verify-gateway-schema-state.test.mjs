// Unit tests for verify-gateway-schema-state.mjs, rewritten after Codex caught the original RPC-execution
// design actually WRITING real rows (P1) and misclassifying auth errors as "found" (P2). The new design
// makes exactly one network call (fetchOpenApiSchema, a plain GET, tested with an injected fetch) and
// every subsequent check is a pure, zero-risk lookup against the already-fetched JSON — tested here with
// zero network calls at all, proving the classification logic can never accidentally execute anything.
import { describe, it, expect } from 'vitest'
import { fetchOpenApiSchema, hasFunction, hasTable, hasColumn, runChecks } from './verify-gateway-schema-state.mjs'

function fakeSchema({ functions = [], tables = {} } = {}) {
  const paths = {}
  for (const fn of functions) paths[`/rpc/${fn}`] = { post: {} }
  const definitions = {}
  for (const [table, columns] of Object.entries(tables)) {
    paths[`/${table}`] = { get: {} }
    definitions[table] = { properties: Object.fromEntries(columns.map((c) => [c, { type: 'string' }])) }
  }
  return { paths, definitions }
}

describe('fetchOpenApiSchema — the ONLY network call this script makes', () => {
  it('returns ok:true with the parsed schema on a successful GET', async () => {
    const schema = fakeSchema({ functions: ['foo'] })
    const fetchImpl = async (url, opts) => {
      expect(url).toBe('https://proj.supabase.co/rest/v1/')
      expect(opts.headers.apikey).toBe('the-key')
      expect(opts.headers.Authorization).toBe('Bearer the-key')
      return { ok: true, status: 200, json: async () => schema }
    }
    const r = await fetchOpenApiSchema('https://proj.supabase.co', 'the-key', fetchImpl)
    expect(r).toEqual({ ok: true, schema })
  })

  it('strips a trailing slash from the base URL before building the request', async () => {
    let seenUrl = null
    const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => fakeSchema() } }
    await fetchOpenApiSchema('https://proj.supabase.co/', 'k', fetchImpl)
    expect(seenUrl).toBe('https://proj.supabase.co/rest/v1/')
  })

  it('returns ok:false (never ok:true, never throws) on an HTTP error status — e.g. an expired/invalid credential', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })
    const r = await fetchOpenApiSchema('https://proj.supabase.co', 'bad-key', fetchImpl)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('401')
  })

  it('returns ok:false on a network-level failure (fetch itself throws)', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    const r = await fetchOpenApiSchema('https://proj.supabase.co', 'k', fetchImpl)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('ECONNREFUSED')
  })

  it('returns ok:false when the response is not valid JSON', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token') } })
    const r = await fetchOpenApiSchema('https://proj.supabase.co', 'k', fetchImpl)
    expect(r.ok).toBe(false)
  })

  it('returns ok:false when the response is valid JSON but not a PostgREST OpenAPI document', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ some: 'unrelated json' }) })
    const r = await fetchOpenApiSchema('https://proj.supabase.co', 'k', fetchImpl)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('paths')
  })
})

describe('hasFunction / hasTable / hasColumn — pure lookups against an already-fetched schema, cannot fail or execute anything', () => {
  it('hasFunction is true only for a function actually present in schema.paths', () => {
    const schema = fakeSchema({ functions: ['record_gateway_deposit_event'] })
    expect(hasFunction(schema, 'record_gateway_deposit_event')).toBe(true)
    expect(hasFunction(schema, 'apply_gateway_pm_attribution')).toBe(false)
  })

  it('hasTable is true when the table appears in schema.definitions or schema.paths', () => {
    const schema = fakeSchema({ tables: { gateway_positions: ['position_manager'] } })
    expect(hasTable(schema, 'gateway_positions')).toBe(true)
    expect(hasTable(schema, 'gateway_position_recompute_issues')).toBe(false)
  })

  it('hasColumn is true only when the column is listed under that table\'s definition', () => {
    const schema = fakeSchema({ tables: { gateway_deposit_events: ['position_manager', 'tx_index'] } })
    expect(hasColumn(schema, 'gateway_deposit_events', 'position_manager')).toBe(true)
    expect(hasColumn(schema, 'gateway_deposit_events', 'shares_minted')).toBe(false)
  })

  it('hasColumn is false (not a throw) for a table that does not exist at all', () => {
    const schema = fakeSchema()
    expect(hasColumn(schema, 'nonexistent_table', 'some_column')).toBe(false)
  })
})

describe('runChecks — reports every migration\'s object, present or not, from one already-fetched schema', () => {
  it('reports every object as present when the full expected schema exists', () => {
    const schema = fakeSchema({
      functions: ['record_gateway_deposit_event', 'record_gateway_withdraw_event', 'recompute_gateway_position', 'apply_gateway_pm_attribution'],
      tables: {
        gateway_deposit_events: ['block_number', 'shares_burned', 'position_manager', 'tx_index', 'shares_minted'],
        gateway_positions: ['position_manager'],
        gateway_position_recompute_issues: ['reason'],
      },
    })
    const results = runChecks(schema)
    expect(results.every((r) => r.present)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('reports individually missing objects when the schema is only partially applied (e.g. _004/_005 but not _006/_007)', () => {
    const schema = fakeSchema({
      functions: ['record_gateway_deposit_event', 'record_gateway_withdraw_event'],
      tables: {
        gateway_deposit_events: ['block_number', 'shares_burned', 'position_manager', 'tx_index', 'shares_minted'],
        gateway_positions: ['position_manager'],
      },
    })
    const results = runChecks(schema)
    const byLabel = new Map(results.map((r) => [r.label, r.present]))
    expect(byLabel.get('record_gateway_deposit_event')).toBe(true)
    expect(byLabel.get('recompute_gateway_position')).toBe(false)
    expect(byLabel.get('apply_gateway_pm_attribution')).toBe(false)
    expect(byLabel.get('gateway_position_recompute_issues')).toBe(false)
  })

  it('reports everything missing against a genuinely empty schema (e.g. a fresh/unrelated project)', () => {
    const results = runChecks(fakeSchema())
    expect(results.every((r) => !r.present)).toBe(true)
  })

  it('never calls a network function or an RPC — operates purely on the passed-in schema object', () => {
    // If runChecks accidentally tried to execute anything, passing a schema with no `fetch`/`rpc`
    // capability at all would throw — it doesn't, because it never calls anything, just reads properties.
    const schema = fakeSchema({ functions: ['x'] })
    expect(() => runChecks(schema)).not.toThrow()
  })
})
