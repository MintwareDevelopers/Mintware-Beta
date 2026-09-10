// Unit tests for verify-gateway-schema-state.mjs's classification logic — a wrong classification here
// would silently invert the whole report (a present function reported as missing, or vice versa), so this
// is tested the same way scripts/verify-gateway-pm-attribution.mjs's own decision logic is: no live
// Supabase project needed, an injected fake stands in for the client.
import { describe, it, expect } from 'vitest'
import { looksMissing, checkFunction, checkColumn } from './verify-gateway-schema-state.mjs'

describe('looksMissing', () => {
  it('returns false when there is no error at all', () => {
    expect(looksMissing(null)).toBe(false)
    expect(looksMissing(undefined)).toBe(false)
  })

  it('recognizes PostgREST\'s "function not found in schema cache" code', () => {
    expect(looksMissing({ code: 'PGRST202', message: 'Could not find the function public.foo in the schema cache' })).toBe(true)
  })

  it('recognizes PostgREST\'s "table not found in schema cache" code', () => {
    expect(looksMissing({ code: 'PGRST205', message: 'Could not find the table public.foo in the schema cache' })).toBe(true)
  })

  it('recognizes the raw Postgres undefined_function SQLSTATE', () => {
    expect(looksMissing({ code: '42883', message: 'function foo(text) does not exist' })).toBe(true)
  })

  it('recognizes the raw Postgres undefined_table SQLSTATE', () => {
    expect(looksMissing({ code: '42P01', message: 'relation "foo" does not exist' })).toBe(true)
  })

  it('falls back to message-text matching when the code is absent or unrecognized', () => {
    expect(looksMissing({ code: '', message: 'Could not find the function public.bar in the schema cache' })).toBe(true)
    expect(looksMissing({ code: '', message: 'column "bar" does not exist' })).toBe(true)
  })

  it('does NOT classify an unrelated error as "missing" — e.g. a real data/type error proves the object EXISTS', () => {
    expect(looksMissing({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe(false)
    expect(looksMissing({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(looksMissing({ code: 'P0001', message: 'apply_gateway_pm_attribution: no gateway_deposit_events row with id X' })).toBe(false)
  })
})

describe('checkFunction', () => {
  it('reports present:true when the RPC call succeeds with no error', async () => {
    const supabase = { rpc: async () => ({ data: [], error: null }) }
    const r = await checkFunction(supabase, 'some_function', { a: 1 })
    expect(r).toMatchObject({ name: 'some_function', kind: 'function', present: true })
  })

  it('reports present:true when the RPC call errors for a reason OTHER than missing (e.g. bad probe args)', async () => {
    const supabase = { rpc: async () => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }) }
    const r = await checkFunction(supabase, 'some_function', { a: 1 })
    expect(r.present).toBe(true)
  })

  it('reports present:false when PostgREST reports the function missing from the schema cache', async () => {
    const supabase = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.some_function in the schema cache' } }) }
    const r = await checkFunction(supabase, 'some_function', { a: 1 })
    expect(r).toMatchObject({ present: false })
    expect(r.detail).toContain('PGRST202')
  })

  it('calls supabase.rpc with the exact name and args passed in', async () => {
    let seen = null
    const supabase = { rpc: async (name, args) => { seen = { name, args }; return { data: [], error: null } } }
    await checkFunction(supabase, 'my_fn', { x: 1, y: 'z' })
    expect(seen).toEqual({ name: 'my_fn', args: { x: 1, y: 'z' } })
  })
})

describe('checkColumn', () => {
  function fakeTable(result) {
    return { select: () => ({ limit: async () => result }) }
  }

  it('reports present:true when the select succeeds', async () => {
    const supabase = { from: () => fakeTable({ data: [], error: null }) }
    const r = await checkColumn(supabase, 'some_table', 'some_column')
    expect(r).toMatchObject({ name: 'some_table.some_column', kind: 'column', present: true })
  })

  it('reports present:false when PostgREST reports the table missing', async () => {
    const supabase = { from: () => fakeTable({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.some_table in the schema cache' } }) }
    const r = await checkColumn(supabase, 'some_table', 'some_column')
    expect(r.present).toBe(false)
  })

  it('reports present:false when the column itself does not exist on an existing table', async () => {
    const supabase = { from: () => fakeTable({ data: null, error: { code: '42703', message: 'column some_table.some_column does not exist' } }) }
    const r = await checkColumn(supabase, 'some_table', 'some_column')
    expect(r.present).toBe(false)
  })

  it('queries the exact table and column requested', async () => {
    let seenTable = null
    let seenColumn = null
    const supabase = {
      from: (t) => { seenTable = t; return { select: (c) => { seenColumn = c; return { limit: async () => ({ data: [], error: null }) } } } },
    }
    await checkColumn(supabase, 'gateway_positions', 'position_manager')
    expect(seenTable).toBe('gateway_positions')
    expect(seenColumn).toBe('position_manager')
  })
})
