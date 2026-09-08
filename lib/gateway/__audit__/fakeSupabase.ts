// Red-team audit helper — a tiny in-memory stand-in for the supabase-js query builder, shaped just
// wide enough for lib/gateway/*. NOT production code; lives under __audit__ and is imported only by
// the redteamOffchain*.test.ts PoCs. Supports: from().select/eq/is/not/order/limit/maybeSingle/
// insert/update/upsert/delete, thenable execution, a UNIQUE-conflict emulation (23505) per table.

type Row = Record<string, unknown>
type Filter = { kind: 'eq' | 'is' | 'notin'; col: string; val: unknown }

export type FakeDb = {
  tables: Record<string, Row[]>
  /** optional UNIQUE keys per table → insert conflicts return { code: '23505' } */
  uniques?: Record<string, string[][]>
  calls: { table: string; op: string; payload?: unknown; filters: Filter[] }[]
  /** optional Postgres-function emulation for `supabase.rpc(fn, args)` (e.g. record_gateway_harvest) */
  rpc?: (fn: string, args: Record<string, unknown>, db: FakeDb) => Promise<{ data: unknown; error: { message: string } | null }>
}

function matches(row: Row, f: Filter): boolean {
  if (f.kind === 'eq') return String(row[f.col]).toLowerCase() === String(f.val).toLowerCase()
  if (f.kind === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
  // not-in: val is the PostgREST list literal `("a","b")`
  const list = String(f.val).replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '').trim().toLowerCase())
  return !list.includes(String(row[f.col]).toLowerCase())
}

let idSeq = 0
class Builder {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: unknown
  private filters: Filter[] = []
  private single = false
  private conflictCols: string[] | null = null
  private ignoreDuplicates = false
  constructor(private db: FakeDb, private table: string) {
    db.tables[table] ??= []
  }
  select() { return this }
  order() { return this }
  limit() { return this }
  eq(col: string, val: unknown) { this.filters.push({ kind: 'eq', col, val }); return this }
  is(col: string, val: unknown) { this.filters.push({ kind: 'is', col, val }); return this }
  not(col: string, _op: string, val: unknown) { this.filters.push({ kind: 'notin', col, val }); return this }
  insert(row: Row | Row[]) { this.op = 'insert'; this.payload = row; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  upsert(row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert'; this.payload = row
    this.conflictCols = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null
    this.ignoreDuplicates = !!opts?.ignoreDuplicates
    return this
  }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { this.single = true; return this.exec() }
  then<T>(res: (v: { data: unknown; error: unknown }) => T, rej?: (e: unknown) => T) { return this.exec().then(res, rej) }

  private async exec(): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
    const rows = this.db.tables[this.table]
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload, filters: [...this.filters] })
    const hit = () => rows.filter((r) => this.filters.every((f) => matches(r, f)))
    if (this.op === 'select') {
      const h = hit()
      return { data: this.single ? (h[0] ?? null) : h, error: null }
    }
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
      for (const r of list) {
        for (const uq of this.db.uniques?.[this.table] ?? []) {
          if (rows.some((e) => uq.every((c) => String(e[c]).toLowerCase() === String(r[c]).toLowerCase()))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          }
        }
        rows.push({ id: r.id ?? `row-${++idSeq}`, ...r })
      }
      return { data: list, error: null }
    }
    if (this.op === 'update') {
      const h = hit()
      for (const r of h) Object.assign(r, this.payload as Row)
      return { data: h, error: null }
    }
    if (this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
      for (const r of list) {
        const existing = this.conflictCols
          ? rows.find((e) => this.conflictCols!.every((c) => String(e[c]).toLowerCase() === String(r[c]).toLowerCase()))
          : undefined
        if (existing) { if (!this.ignoreDuplicates) Object.assign(existing, r) }
        else rows.push({ id: `row-${++idSeq}`, ...r })
      }
      return { data: list, error: null }
    }
    // delete
    const h = hit()
    this.db.tables[this.table] = rows.filter((r) => !h.includes(r))
    return { data: h, error: null }
  }
}

export function fakeSupabase(seed: Partial<FakeDb> = {}) {
  const db: FakeDb = { tables: {}, uniques: {}, calls: [], ...seed }
  const client = {
    from: (table: string) => new Builder(db, table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.calls.push({ table: `rpc:${fn}`, op: 'rpc', payload: args, filters: [] })
      if (!db.rpc) return { data: null, error: { message: `rpc ${fn} not emulated` } }
      return db.rpc(fn, args, db)
    },
  }
  return { db, client: client as unknown as never }
}
