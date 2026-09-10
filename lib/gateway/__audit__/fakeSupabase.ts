// Red-team audit helper — a tiny in-memory stand-in for the supabase-js query builder, shaped just
// wide enough for lib/gateway/*. NOT production code; lives under __audit__ and is imported only by
// the redteamOffchain*.test.ts PoCs. Supports: from().select/eq/is/not/or/order/limit/maybeSingle/
// insert/update/upsert/delete, thenable execution, a UNIQUE-conflict emulation (23505) per table.

type Row = Record<string, unknown>
type SimpleCond = { col: string; op: 'eq' | 'is'; val: unknown }
type Filter =
  | { kind: 'eq' | 'in' | 'is' | 'notin' | 'not-is-null'; col: string; val: unknown }
  | { kind: 'or'; clauses: SimpleCond[][] } // OR of AND-groups — mirrors PostgREST's .or('and(...),and(...)')

export type FakeDb = {
  tables: Record<string, Row[]>
  /** optional UNIQUE keys per table → insert conflicts return { code: '23505' } */
  uniques?: Record<string, string[][]>
  calls: { table: string; op: string; payload?: unknown; filters: Filter[] }[]
  /** optional Postgres-function emulation for `supabase.rpc(fn, args)` (e.g. record_gateway_harvest) */
  rpc?: (fn: string, args: Record<string, unknown>, db: FakeDb) => Promise<{ data: unknown; error: { message: string } | null }>
}

// Splits a PostgREST filter-expression string on top-level commas only (commas inside and(...) groups
// are the group's own separators, not top-level OR separators).
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1 }
  }
  out.push(s.slice(start))
  return out
}
function parseSimpleCond(s: string): SimpleCond {
  const [col, op, val] = s.split('.')
  return { col, op: op as 'eq' | 'is', val: val === 'null' ? null : val }
}

function matches(row: Row, f: Filter): boolean {
  if (f.kind === 'eq') return String(row[f.col]).toLowerCase() === String(f.val).toLowerCase()
  if (f.kind === 'in') return (f.val as unknown[]).some((v) => String(row[f.col]).toLowerCase() === String(v).toLowerCase())
  if (f.kind === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
  if (f.kind === 'not-is-null') return row[f.col] != null
  if (f.kind === 'or') {
    return f.clauses.some((clause) => clause.every((cond) =>
      cond.op === 'is'
        ? (cond.val === null ? row[cond.col] == null : row[cond.col] === cond.val)
        : String(row[cond.col]).toLowerCase() === String(cond.val).toLowerCase(),
    ))
  }
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
  private orderCol: string | null = null
  private orderAsc = true
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  constructor(private db: FakeDb, private table: string) {
    db.tables[table] ??= []
  }
  select() { return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this }
  limit() { return this }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this }
  eq(col: string, val: unknown) { this.filters.push({ kind: 'eq', col, val }); return this }
  in(col: string, vals: unknown[]) { this.filters.push({ kind: 'in', col, val: vals }); return this }
  is(col: string, val: unknown) { this.filters.push({ kind: 'is', col, val }); return this }
  not(col: string, op: string, val: unknown) {
    // `.not(col, 'is', null)` means "NOT (col IS NULL)" i.e. "col IS NOT NULL" — the one shape this
    // fake's actual callers use (attributionCompleteness.ts). Any other op keeps the pre-existing
    // not-in-list behavior (unused by any current caller, kept for back-compat).
    if (op === 'is' && val === null) { this.filters.push({ kind: 'not-is-null', col, val: null }); return this }
    this.filters.push({ kind: 'notin', col, val })
    return this
  }
  or(expr: string) {
    const clauses = splitTopLevel(expr).map((clause) => {
      const m = clause.match(/^and\((.*)\)$/)
      return m ? splitTopLevel(m[1]).map(parseSimpleCond) : [parseSimpleCond(clause)]
    })
    this.filters.push({ kind: 'or', clauses })
    return this
  }
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
      let h = hit()
      if (this.orderCol) {
        const col = this.orderCol
        h = [...h].sort((a, b) => {
          const av = a[col], bv = b[col]
          if (av == null && bv == null) return 0
          if (av == null) return this.orderAsc ? -1 : 1
          if (bv == null) return this.orderAsc ? 1 : -1
          if (av < bv) return this.orderAsc ? -1 : 1
          if (av > bv) return this.orderAsc ? 1 : -1
          return 0
        })
      }
      if (this.rangeFrom != null && this.rangeTo != null) h = h.slice(this.rangeFrom, this.rangeTo + 1)
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
