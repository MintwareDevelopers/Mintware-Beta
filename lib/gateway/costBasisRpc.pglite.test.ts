// Real-PostgreSQL execution of the cost-basis RPCs (independent Codex audit, round-4 pass-2, 2026-09-09
// — "tests that only exercise a JS mirror of SQL are insufficient" / "promote useful reproductions into
// durable repository tests"). This runs the ACTUAL migration SQL — record_gateway_deposit_event /
// record_gateway_withdraw_event, as they will really be applied — in an embedded PGlite Postgres, not a
// hand-written JS reimplementation of their logic. basisMath.test.ts still covers the pure-function
// mirror (useful for fast, dependency-free unit coverage of the FORMULA); this file is the complementary
// check that the SQL itself, as written, actually does what that formula says on a real Postgres engine
// — exactly the gap that let a real bug (`ORDER BY (position_manager = v_pm) DESC` sorting NULL before
// TRUE, backwards from the intended "prefer exact match" rule — NULL is a THIRD value in SQL comparison
// logic, not FALSE, and Postgres defaults DESC to NULLS FIRST) ship in a migration that a JS mirror could
// never have caught, since the JS mirror never modeled SQL's three-valued comparison semantics at all.
// That ORDER BY no longer exists at all in the final design (2026-09-10, to-do items 3/4) — every
// generation is isolated by an EXACT position_manager match, no NULL fallback anywhere.
//
// Scope note: PGlite is a single-process EMBEDDED Postgres — this proves the SQL logic is correct against
// a real engine, but does NOT exercise genuine multi-connection lock contention. Both RPCs now take a
// `pg_advisory_xact_lock` (to-do item 2) as their first statement, but these single-process tests cannot
// prove it actually serializes two REAL concurrent connections — that would need a genuine multi-session
// Postgres (e.g. two actual client connections racing a slow transaction), which is explicitly flagged as
// still-open, separate follow-up work, not something this suite claims to close.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = [
  '20260906000001_lp_gateway.sql',
  '20260906000002_lp_gateway_registry.sql',
  '20260907000001_lp_gateway_hardening.sql',
  '20260909000001_gateway_position_atomic_writes.sql',
  '20260909000002_gateway_instances_history_per_pool.sql',
  '20260909000004_gateway_cost_basis_replay.sql',
  '20260909000005_gateway_positions_pm_generation.sql',
]

const migrationsDir = resolve(__dirname, '../../supabase/migrations')
const readMigration = (name: string) => readFile(resolve(migrationsDir, name), 'utf8')

const POOL = 'audit-pool'
const CHAIN = 46630
const USER = 'audit-wallet'
const PM_A = 'pm-a'
const PM_B = 'pm-b'

type DepositArgs = {
  tx: string; address?: string; pool?: string; chain?: number
  quoteIn: string; onChainShares: string
  blockNumber?: number | null; pm?: string | null; txIndex?: number | null; sharesMinted?: string | null
}
type WithdrawArgs = {
  tx: string; address?: string; pool?: string; chain?: number
  quoteOut: string; onChainShares: string; sharesBurned: string
  blockNumber?: number | null; pm?: string | null; txIndex?: number | null
}

describe('gateway cost-basis RPCs — real PostgreSQL execution (PGlite)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    // The migrations' REVOKE statements target these roles — PGlite starts with neither defined.
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
    for (const name of MIGRATIONS) {
      await db.exec(await readMigration(name))
    }
  }, 60_000)

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    await db.exec('TRUNCATE gateway_positions, gateway_deposit_events, gateway_instances RESTART IDENTITY CASCADE')
  })

  async function deposit(a: DepositArgs) {
    return db.query<{ cost_basis_atomic: string; already_recorded: boolean }>(
      `SELECT * FROM record_gateway_deposit_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.tx, a.address ?? USER, a.pool ?? POOL, a.chain ?? CHAIN, a.quoteIn, a.onChainShares, a.blockNumber ?? null, a.pm ?? null, a.txIndex ?? null, a.sharesMinted ?? null],
    )
  }
  async function withdraw(a: WithdrawArgs) {
    return db.query<{ cost_basis_atomic: string | null; already_recorded: boolean; position_found: boolean }>(
      `SELECT * FROM record_gateway_withdraw_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.tx, a.address ?? USER, a.pool ?? POOL, a.chain ?? CHAIN, a.quoteOut, a.onChainShares, a.sharesBurned, a.blockNumber ?? null, a.pm ?? null, a.txIndex ?? null],
    )
  }
  async function basisFor(pm: string | null, address = USER, pool = POOL): Promise<string | null> {
    const r = await db.query<{ basis: string | null }>(
      `SELECT entry_nav::text AS basis FROM gateway_positions
       WHERE user_wallet = $1 AND pool_address = $2 AND chain_id = $3
         AND (position_manager = $4 OR (position_manager IS NULL AND $4::text IS NULL))`,
      [address, pool, CHAIN, pm],
    )
    return r.rows[0]?.basis ?? null
  }
  async function rowCount(): Promise<number> {
    const r = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM gateway_positions')
    return Number(r.rows[0]!.count)
  }

  it('a genuinely first-ever deposit creates a new position with the correct basis', async () => {
    const r = await deposit({ tx: 'tx-1', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    expect(r.rows[0]).toMatchObject({ already_recorded: false })
    expect(await basisFor(PM_A)).toBe('1000000')
    expect(await rowCount()).toBe(1)
  })

  it('an existing position: deposit then withdraw compose correctly through the real RPCs', async () => {
    await deposit({ tx: 'tx-1', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    const w = await withdraw({ tx: 'tx-2', quoteOut: '500000', onChainShares: '500000', sharesBurned: '500000', blockNumber: 101, pm: PM_A, txIndex: 0 })
    expect(w.rows[0]).toMatchObject({ already_recorded: false, position_found: true, cost_basis_atomic: '500000' })
    expect(await basisFor(PM_A)).toBe('500000')
  })

  // The core event-order fix (migration 20260909000004), proven against REAL SQL rather than a JS mirror.
  it('FIX PROVEN (real SQL): recording the withdraw BEFORE the deposit still yields the correct chain-order basis', async () => {
    // Chain reality: deposit 1000 (block 100), withdraw half — burn 500 (block 101). Correct basis: 500.
    await withdraw({ tx: 'tx-w', quoteOut: '500000', onChainShares: '500000', sharesBurned: '500000', blockNumber: 101, pm: PM_A, txIndex: 0 })
    await deposit({ tx: 'tx-d', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    expect(await basisFor(PM_A)).toBe('500000') // NOT 1000000 or 0 — the old call-order-dependent bug's failure modes
  })

  // Manager-generation fix, FINAL design (independent Codex audit, to-do items 3/4, 2026-09-10): two
  // earlier designs both guessed at ambiguous legacy history — a migration-time "prefer active PM"
  // backfill, then a runtime "first write to name any PM adopts the whole unclaimed history" rule (which
  // fixed the immediate double-count but not the deeper flaw: whichever PM asks first still wins a guess
  // that might be wrong — a wallet's real history could belong to a DIFFERENT, still-existing generation
  // entirely). Final fix: no guessing anywhere — an unresolved (null-PM) legacy row is NEVER touched or
  // merged by any RPC call, for any PM, ever. Proven here against real SQL: a legacy deposit stays its
  // own separate, untouched row; PM-A's and PM-B's deposits each start completely fresh, at exactly their
  // own amounts, regardless of which one asks first or whether the legacy row exists at all.
  it('FIX PROVEN (real SQL): an unresolved legacy row is NEVER merged into any generation, in either direction', async () => {
    // A null-PM row is never CREATED by a real RPC call any more (both routes always pass a real,
    // on-chain-verified positionManager) — it can only exist as genuinely pre-existing data. Constructed
    // directly here, matching how it would actually arise (not via the RPC itself).
    await db.exec(`
      INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav) VALUES
        ('${USER}', '${POOL}', ${CHAIN}, NULL, 1, 999999999);
    `)
    await deposit({ tx: 'pm-a-1', quoteIn: '100000000', onChainShares: '100000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '100000000' })
    expect(await basisFor(PM_A)).toBe('100000000') // exactly its own — the legacy row contributed NOTHING
    expect(await rowCount()).toBe(2) // a genuinely NEW, separate row for PM_A — the legacy row untouched

    await deposit({ tx: 'pm-b-1', quoteIn: '5000000', onChainShares: '5000000', blockNumber: 200, pm: PM_B, txIndex: 0, sharesMinted: '5000000' })
    expect(await basisFor(PM_B)).toBe('5000000') // ONLY its own — not 5000000+legacy, not PM-A's total
    expect(await basisFor(PM_A)).toBe('100000000') // unchanged by PM-B's arrival
    expect(await rowCount()).toBe(3) // legacy row + PM_A + PM_B, three genuinely distinct rows

    // The legacy row itself is untouched, still unresolved (position_manager still NULL) — no RPC call
    // for any real PM ever claims or merges it.
    const legacyRow = await db.query<{ position_manager: string | null; entry_nav: string }>(
      `SELECT position_manager, entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager IS NULL`,
      [USER, POOL, CHAIN],
    )
    expect(legacyRow.rows[0]).toMatchObject({ position_manager: null, entry_nav: '999999999' })
  })

  it('a withdraw naming a PM with no matching row returns position_found:false — even when an unresolved legacy row exists for the same identity', async () => {
    await db.exec(`
      INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav) VALUES
        ('${USER}', '${POOL}', ${CHAIN}, NULL, 10000000, 10000000);
    `)
    const w = await withdraw({ tx: 'tx-w', quoteOut: '1', onChainShares: '0', sharesBurned: '1', blockNumber: 100, pm: PM_A, txIndex: 0 })
    expect(w.rows[0]).toMatchObject({ position_found: false, cost_basis_atomic: null })
  })

  it('duplicate retries are idempotent — a replayed tx_hash never inflates the basis', async () => {
    await deposit({ tx: 'tx-1', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    const replay = await deposit({ tx: 'tx-1', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    expect(replay.rows[0]).toMatchObject({ already_recorded: true, cost_basis_atomic: '1000000' })
    expect(await basisFor(PM_A)).toBe('1000000') // not 2000000
    expect(await rowCount()).toBe(1)
  })

  // The same-block VALUE fix (derived shares), proven against real SQL with the recording order reversed
  // — the scenario Codex's own watch reproduced as "150 instead of 175" once fixed / "175 instead of 150"
  // when buggy.
  it('FIX PROVEN (real SQL): same-block withdraw-then-deposit recording order still yields the correct derived-shares basis', async () => {
    // Chain reality, one block (100): deposit 1000 (tx_index 0), withdraw half — burn 500 (tx_index 1).
    // Recorded in the WRONG (reverse) order — the withdraw's call reaches the RPC first.
    await withdraw({ tx: 'tx-w', quoteOut: '500000', onChainShares: '999999999', sharesBurned: '500000', blockNumber: 100, pm: PM_A, txIndex: 1 })
    await deposit({ tx: 'tx-d', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
    // Note: the withdraw call's own p_on_chain_shares (999999999) is deliberately a nonsense/stale live
    // read here — the derived-shares replay must ignore it entirely and use sharesBurned only.
    expect(await basisFor(PM_A)).toBe('500000')
  })

  // CAUGHT ON REVIEW (2026-09-10, Codex live watch, before this migration was ever applied) — the
  // "two generations competing" test above does NOT exercise this: normal RPC operation converts a
  // NULL-tagged row to a real PM the moment anything adopts it, so an exact-match row and a lingering
  // NULL row for the SAME identity rarely coexist through ordinary use. Constructing that state directly
  // (as a genuinely pathological but real-possible case — e.g. two rows surviving an interrupted
  // migration/backfill run) proves the ORDER BY fix independent of how the state arose: with the OLD
  // `ORDER BY (position_manager = v_pm) DESC`, `position_manager = v_pm` is NULL (not FALSE) for the
  // NULL row — a THIRD value in SQL's comparison logic — and Postgres defaults DESC to NULLS FIRST, so
  // the NULL row sorted BEFORE the TRUE (exact-match) row, exactly backwards from the intended rule.
  // Originally written to prove a specific NULLS-ordering bug (`ORDER BY (position_manager = v_pm) DESC`
  // picking the NULL row before the exact match, since `NULL = anything` is NULL — a third SQL value —
  // and Postgres defaults DESC to NULLS FIRST). That ORDER BY no longer exists at all: the final design
  // (to-do items 3/4) queries `position_manager = v_pm` only, so a NULL row can never match regardless of
  // ordering. Kept as a regression test for the same user-visible guarantee under the new mechanism.
  it('FIX PROVEN (real SQL): an exact-PM row is read correctly, never a coexisting legacy NULL row', async () => {
    await db.exec(`
      INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav) VALUES
        ('${USER}', '${POOL}', ${CHAIN}, NULL, 1, 999999),
        ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 1, 111);
    `)
    // The idempotent-replay branch (IF v_already) — exercise it directly via a duplicate tx_hash so the
    // read path is covered too, not just the write path.
    await db.exec(`
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, position_manager)
      VALUES ('already-seen', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1, '${PM_A}');
    `)
    const replay = await deposit({ tx: 'already-seen', quoteIn: '1', onChainShares: '1', pm: PM_A })
    expect(replay.rows[0]).toMatchObject({ already_recorded: true })
    // Must read PM_A's row (111), never the NULL row (999999).
    expect(replay.rows[0]!.cost_basis_atomic).toBe('111')
  })

  it('a legacy (pre-migration, no shares_minted/shares_burned) history falls back to single-delta, never corrupts to zero', async () => {
    // Simulates a row that predates the derived-shares migration: insert directly, bypassing the RPC,
    // since no caller could construct such a row through the current (fixed) RPCs any more.
    await db.exec(`
      INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav)
      VALUES ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 1000000, 1000000);
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, position_manager)
      VALUES ('legacy-tx', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, '${PM_A}');
    `)
    const w = await withdraw({ tx: 'tx-new', quoteOut: '500000', onChainShares: '500000', sharesBurned: '500000', blockNumber: 200, pm: PM_A, txIndex: 0 })
    expect(w.rows[0]).toMatchObject({ position_found: true })
    expect(await basisFor(PM_A)).toBe('500000') // single-delta fallback: 1000000 * 500000/1000000 = 500000
  })
})
