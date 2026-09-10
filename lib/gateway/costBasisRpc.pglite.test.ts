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
  '20260909000006_gateway_position_recompute.sql',
  '20260909000007_gateway_attribution_atomic_apply.sql',
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
    await db.exec('TRUNCATE gateway_positions, gateway_deposit_events, gateway_instances, gateway_position_recompute_issues RESTART IDENTITY CASCADE')
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

  // User directive (2026-09-10, fourth Codex live-review pass): "Finish issue-state lifecycle: if a late
  // deposit/withdraw recording repairs the complete event replay, clear that identity's old recompute
  // issue... Do not clear it on incremental fallback or incomplete replay."
  describe('record_gateway_deposit_event / record_gateway_withdraw_event — recompute-issue lifecycle', () => {
    it('a CLEAN (full-replay) deposit clears a pre-existing recompute issue for its own identity', async () => {
      await db.exec(`
        INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
        VALUES ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 'over_burn');
      `)
      await deposit({ tx: 'tx-clean-clears', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
      const issue = await db.query(
        `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
        [USER, POOL, CHAIN, PM_A],
      )
      expect(issue.rows.length).toBe(0)
    })

    it('a CLEAN withdraw clears a pre-existing recompute issue for its own identity', async () => {
      await deposit({ tx: 'tx-w-base', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
      await db.exec(`
        INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
        VALUES ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 'data_gap');
      `)
      await withdraw({ tx: 'tx-w-clean-clears', quoteOut: '500000', onChainShares: '500000', sharesBurned: '500000', blockNumber: 101, pm: PM_A, txIndex: 0 })
      const issue = await db.query(
        `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
        [USER, POOL, CHAIN, PM_A],
      )
      expect(issue.rows.length).toBe(0)
    })

    it('does NOT clear the issue when the deposit falls back to the single-delta (incomplete-history) path', async () => {
      // Same legacy-fallback setup as the test above this describe block — this deposit is forced onto
      // the fallback path (a sibling event for this PM is missing shares_minted), so it must NOT clear.
      await db.exec(`
        INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, position_manager)
        VALUES ('legacy-no-shares', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, '${PM_A}');
        INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
        VALUES ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 'data_gap');
      `)
      await deposit({ tx: 'tx-fallback-no-clear', quoteIn: '500000', onChainShares: '1500000', blockNumber: 101, pm: PM_A, txIndex: 0, sharesMinted: '500000' })
      const issue = await db.query(
        `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
        [USER, POOL, CHAIN, PM_A],
      )
      expect(issue.rows.length).toBe(1) // still incomplete — the fallback never proved a genuine full resolution
    })

    it('does NOT touch a DIFFERENT identity\'s recompute issue', async () => {
      const OTHER_PM = 'pm-unrelated-record'
      await db.exec(`
        INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
        VALUES ('${USER}', '${POOL}', ${CHAIN}, '${OTHER_PM}', 'over_burn');
      `)
      await deposit({ tx: 'tx-unrelated-record', quoteIn: '1000000', onChainShares: '1000000', blockNumber: 100, pm: PM_A, txIndex: 0, sharesMinted: '1000000' })
      const issue = await db.query(
        `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
        [USER, POOL, CHAIN, OTHER_PM],
      )
      expect(issue.rows.length).toBe(1) // untouched — a different identity's own issue is not this call's concern
    })
  })
})

// Deploy-ordering safety net: migration _005 (record_gateway_deposit_event/withdraw_event) is on the HOT
// deposit/withdraw path — unlike the recovery-only _006/_007 functions, an operator could plausibly apply
// _004+_005 without yet applying _006/_007 (they're documented as "additive... whenever convenient", not
// required alongside _004/_005 the way _004+_005 require each other). If _005's new issue-clearing DELETE
// hard-failed on the absent gateway_position_recompute_issues table in that window, EVERY normal deposit/
// withdraw would break — proving the defensive exception wrapper actually works is the whole point of this
// suite, run against a SEPARATE database that deliberately excludes migration _007.
describe('record_gateway_deposit_event / record_gateway_withdraw_event — safe when migration _007 is NOT yet applied', () => {
  let db: PGlite
  const MIGRATIONS_WITHOUT_007 = MIGRATIONS.filter((m) => m !== '20260909000007_gateway_attribution_atomic_apply.sql')

  beforeAll(async () => {
    db = new PGlite()
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
    for (const name of MIGRATIONS_WITHOUT_007) await db.exec(await readMigration(name))
  }, 60_000)
  afterAll(async () => { await db.close() })

  it('a genuinely fresh deposit still succeeds normally when gateway_position_recompute_issues does not exist yet', async () => {
    await expect(
      db.query(
        `SELECT * FROM record_gateway_deposit_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        ['tx-no-007-table', USER, POOL, CHAIN, '1000000', '1000000', 100, PM_A, 0, '1000000'],
      ),
    ).resolves.toMatchObject({ rows: [{ already_recorded: false }] })
    const pos = await db.query<{ entry_nav: string }>(
      `SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(pos.rows[0]?.entry_nav).toBe('1000000') // the deposit itself still recorded correctly
  })
})

// Historical PM attribution recovery, part 2 (independent Codex audit, to-do items 3/4, 2026-09-10).
// `recompute_gateway_position` is what scripts/verify-gateway-pm-attribution.mjs calls AFTER it resolves
// an orphaned event's real position_manager from a verified on-chain receipt — it never guesses on its
// own, and refuses (raises) rather than silently computing a wrong number over an incomplete history.
describe('recompute_gateway_position — historical attribution recovery', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
    for (const name of MIGRATIONS) await db.exec(await readMigration(name))
  }, 60_000)
  afterAll(async () => { await db.close() })
  beforeEach(async () => {
    await db.exec('TRUNCATE gateway_positions, gateway_deposit_events, gateway_position_recompute_issues RESTART IDENTITY CASCADE')
  })

  // User directive (2026-09-10, third Codex pass): "lifecycle... across recompute/record." The script's
  // backstop sweep (recomputeAllResolvedIdentities) calls THIS function, not apply_gateway_pm_attribution,
  // for identities it didn't itself touch this run — if one of those had a stale issue recorded by an
  // EARLIER apply_gateway_pm_attribution call, and THIS call now succeeds for it, the issue must clear
  // here too, not only inside apply_gateway_pm_attribution's own loop.
  it('clears a pre-existing gateway_position_recompute_issues row for this identity once it successfully recomputes', async () => {
    await db.exec(`
      INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
      VALUES ('${USER}', '${POOL}', ${CHAIN}, '${PM_A}', 'over_burn');
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, shares_minted, block_number, tx_index, position_manager)
      VALUES ('resolved-clears-issue', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, 1000000, 100, 0, '${PM_A}');
    `)
    await db.query(`SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`, [USER, POOL, CHAIN, PM_A])
    const issues = await db.query(
      `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(issues.rows.length).toBe(0)
  })

  it('does NOT touch an issue row for a DIFFERENT identity', async () => {
    const OTHER_PM = 'pm-unrelated'
    await db.exec(`
      INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason)
      VALUES ('${USER}', '${POOL}', ${CHAIN}, '${OTHER_PM}', 'over_burn');
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, shares_minted, block_number, tx_index, position_manager)
      VALUES ('resolved-unrelated', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, 1000000, 100, 0, '${PM_A}');
    `)
    await db.query(`SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`, [USER, POOL, CHAIN, PM_A])
    const issues = await db.query(
      `SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, OTHER_PM],
    )
    expect(issues.rows.length).toBe(1) // untouched — a DIFFERENT identity's own issue is not this call's concern
  })

  it('recomputes a position from resolved events, mirroring the RPCs\' own replay exactly', async () => {
    // Simulates two events whose position_manager the verification script has already resolved from
    // real on-chain receipts (this test only exercises the RECOMPUTE step, not the resolution itself).
    await db.exec(`
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, shares_minted, block_number, tx_index, position_manager)
      VALUES ('resolved-1', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, 1000000, 100, 0, '${PM_A}');
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, shares_burned, block_number, tx_index, position_manager)
      VALUES ('resolved-2', '${USER}', 'withdraw', '${POOL}', ${CHAIN}, 500000, 101, 0, '${PM_A}');
    `)
    const r = await db.query<{ cost_basis_atomic: string; shares_atomic: string; event_count: number }>(
      `SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(r.rows[0]).toMatchObject({ cost_basis_atomic: '500000', shares_atomic: '500000', event_count: 2 })
    const pos = await db.query<{ entry_nav: string }>(
      `SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(pos.rows[0]?.entry_nav).toBe('500000')
  })

  it('refuses (raises) rather than compute over a history still missing shares_minted/shares_burned', async () => {
    await db.exec(`
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, block_number, position_manager)
      VALUES ('unresolved-1', '${USER}', 'deposit', '${POOL}', ${CHAIN}, 1000000, 100, '${PM_A}');
    `)
    await expect(db.query(`SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`, [USER, POOL, CHAIN, PM_A]))
      .rejects.toThrow()
  })

  it('refuses (raises) when no events exist for the given identity', async () => {
    await expect(db.query(`SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`, [USER, POOL, CHAIN, PM_A]))
      .rejects.toThrow()
  })

  it('refuses (raises) when a withdraw would burn more than was ever minted for this exact generation', async () => {
    await db.exec(`
      INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, shares_burned, block_number, tx_index, position_manager)
      VALUES ('over-burn', '${USER}', 'withdraw', '${POOL}', ${CHAIN}, 500000, 100, 0, '${PM_A}');
    `)
    await expect(db.query(`SELECT * FROM recompute_gateway_position($1,$2,$3,$4)`, [USER, POOL, CHAIN, PM_A]))
      .rejects.toThrow()
  })
})

// User directive (2026-09-10): "Make recovery updates and recomputation atomic." apply_gateway_pm_attribution
// (migration 20260909000007) is the single-transaction function scripts/verify-gateway-pm-attribution.mjs
// now calls per resolved row instead of a separate UPDATE + a separate recompute_gateway_position call —
// closing the crash-window gap where a process killed between the two used to leave the event resolved
// but gateway_positions stale.
describe('apply_gateway_pm_attribution — atomic event-update + recompute', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
    for (const name of MIGRATIONS) await db.exec(await readMigration(name))
  }, 60_000)
  afterAll(async () => { await db.close() })
  beforeEach(async () => {
    await db.exec('TRUNCATE gateway_positions, gateway_deposit_events, gateway_position_recompute_issues RESTART IDENTITY CASCADE')
  })

  async function insertOrphan(txHash: string, kind: 'deposit' | 'withdraw', extra: Record<string, unknown> = {}) {
    const cols = ['tx_hash', 'address', 'kind', 'pool_address', 'chain_id', ...Object.keys(extra)]
    const vals = [txHash, USER, kind, POOL, CHAIN, ...Object.values(extra)]
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO gateway_deposit_events (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`,
      vals,
    )
    return rows[0].id
  }

  it('applies + recomputes atomically when this is the ONLY (now-resolved) event for the identity', async () => {
    const id = await insertOrphan('tx-solo', 'deposit', { quote_in: '1000000' })
    const r = await db.query<{ updated: boolean; complete: boolean; cost_basis_atomic: string; shares_atomic: string; event_count: number; remaining_orphans: number }>(
      `SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`,
      [id, PM_A, 100, 0, '1000000', null],
    )
    expect(r.rows[0]).toMatchObject({ updated: true, complete: true, cost_basis_atomic: '1000000', shares_atomic: '1000000', event_count: 1, remaining_orphans: 0 })
    const ev = await db.query<{ position_manager: string; block_number: string; tx_index: number }>(
      `SELECT position_manager, block_number::text, tx_index FROM gateway_deposit_events WHERE id=$1`, [id],
    )
    expect(ev.rows[0]).toMatchObject({ position_manager: PM_A, block_number: '100', tx_index: 0 })
    const pos = await db.query<{ entry_nav: string }>(
      `SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(pos.rows[0]?.entry_nav).toBe('1000000')
  })

  it('applies the event update but does NOT recompute (complete:false) when a sibling orphaned row remains for the same wallet/pool/chain', async () => {
    const id = await insertOrphan('tx-first', 'deposit', { quote_in: '1000000' })
    await insertOrphan('tx-sibling-still-orphaned', 'withdraw') // deliberately left unresolved
    const r = await db.query<{ updated: boolean; complete: boolean; remaining_orphans: number }>(
      `SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`,
      [id, PM_A, 100, 0, '1000000', null],
    )
    expect(r.rows[0]).toMatchObject({ updated: true, complete: false, remaining_orphans: 1 })
    // The event row's own attribution IS durably recorded even though recompute was skipped.
    const ev = await db.query<{ position_manager: string }>(`SELECT position_manager FROM gateway_deposit_events WHERE id=$1`, [id])
    expect(ev.rows[0]?.position_manager).toBe(PM_A)
    // No position was published from the known-incomplete history.
    const pos = await db.query(`SELECT 1 FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(pos.rows.length).toBe(0)
  })

  it('is idempotent: re-applying the SAME position_manager to an already-resolved row is a no-op update but still recomputes', async () => {
    const id = await insertOrphan('tx-idem', 'deposit', { quote_in: '1000000' })
    const first = await db.query<{ updated: boolean }>(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_A, 100, 0, '1000000', null])
    expect(first.rows[0].updated).toBe(true)
    const second = await db.query<{ updated: boolean; complete: boolean }>(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_A, 100, 0, '1000000', null])
    expect(second.rows[0]).toMatchObject({ updated: false, complete: true }) // no-op update, but recompute still ran (self-healing)
  })

  it('refuses (raises) when re-applying a DIFFERENT position_manager to an already-resolved row', async () => {
    const id = await insertOrphan('tx-conflict', 'deposit', { quote_in: '1000000' })
    await db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_A, 100, 0, '1000000', null])
    await expect(db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_B, 100, 0, '1000000', null]))
      .rejects.toThrow()
  })

  it('refuses (raises) for a non-existent event id', async () => {
    await expect(db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, ['00000000-0000-0000-0000-000000000000', PM_A, 100, 0, '1000000', null]))
      .rejects.toThrow()
  })

  it('refuses (raises) rather than compute over a history still missing shares_minted after the update', async () => {
    // The row being applied itself gets shares_minted via the call, but an ALREADY-resolved sibling for
    // the same identity that's missing its own shares_minted should still block recompute.
    const gappy = await insertOrphan('tx-gappy', 'deposit', { quote_in: '1000000', position_manager: PM_A, block_number: 50, tx_index: 0 }) // no shares_minted
    const id = await insertOrphan('tx-fresh', 'deposit', { quote_in: '500000' })
    await expect(db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_A, 100, 0, '500000', null]))
      .rejects.toThrow()
    void gappy
  })

  it('refuses (raises) when applying would make a withdraw burn more than was ever minted', async () => {
    const id = await insertOrphan('tx-overburn', 'withdraw', { shares_burned: '999999999' })
    await expect(db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [id, PM_A, 100, 0, null, '999999999']))
      .rejects.toThrow()
  })

  // Codex, 2026-09-10 (second live-review pass): "cross-PM crash-before-final-sweep still falsely
  // complete" — the FIRST version of this function only recomputed the ONE identity passed to it, so
  // resolving the LAST orphan to a DIFFERENT PM than an earlier-resolved sibling would recompute only the
  // later PM, leaving the earlier one stale until a SEPARATE, non-atomic script-level sweep happened to
  // run. Fixed: the moment remaining_orphans reaches 0, this function recomputes EVERY distinct PM
  // sharing the wallet/pool/chain, in the SAME transaction — no separate step needed.
  it('cross-PM: resolving the LAST orphan (to a DIFFERENT PM) atomically recomputes an EARLIER sibling PM too, in the SAME call', async () => {
    const idA = await insertOrphan('tx-cross-a', 'deposit', { quote_in: '1000000' }) // will resolve to PM_A
    const idB = await insertOrphan('tx-cross-b', 'deposit', { quote_in: '2000000' }) // will resolve to PM_B — the LAST orphan

    // Resolve PM_A FIRST, while idB is still an orphan — must report complete:false (a sibling remains).
    const first = await db.query<{ updated: boolean; complete: boolean; remaining_orphans: number }>(
      `SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idA, PM_A, 100, 0, '1000000', null],
    )
    expect(first.rows[0]).toMatchObject({ updated: true, complete: false, remaining_orphans: 1 })
    const posABefore = await db.query(`SELECT 1 FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(posABefore.rows.length).toBe(0) // not yet recomputed — correctly withheld while a sibling was orphaned

    // Resolve PM_B SECOND — this is the call that eliminates the LAST orphan for this wallet/pool/chain.
    const second = await db.query<{ updated: boolean; complete: boolean; cost_basis_atomic: string; remaining_orphans: number }>(
      `SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idB, PM_B, 101, 0, '2000000', null],
    )
    // The call's own return row reports on the REQUESTED identity (PM_B) — complete, with PM_B's basis.
    expect(second.rows[0]).toMatchObject({ updated: true, complete: true, cost_basis_atomic: '2000000', remaining_orphans: 0 })

    // The core fix: PM_A — resolved by an EARLIER, separate call — is ALSO now recomputed, atomically,
    // as a side effect of THIS SAME call (no separate sweep, no separate transaction).
    const posA = await db.query<{ entry_nav: string }>(`SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(posA.rows[0]?.entry_nav).toBe('1000000')
    const posB = await db.query<{ entry_nav: string }>(`SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_B])
    expect(posB.rows[0]?.entry_nav).toBe('2000000')
  })

  it('cross-PM: a SIBLING PM with its own data gap is silently skipped (not blocking the requested PM), rather than raising for someone else\'s problem', async () => {
    // PM_A already has a gap (missing shares_minted) baked in directly — never went through the orphan
    // flow, simulating a pre-existing incomplete identity that happens to share this wallet/pool/chain.
    await insertOrphan('tx-gappy-sibling', 'deposit', { quote_in: '1000000', position_manager: PM_A, block_number: 50, tx_index: 0 })
    const idB = await insertOrphan('tx-cross-b2', 'deposit', { quote_in: '2000000' })
    const r = await db.query<{ complete: boolean; cost_basis_atomic: string }>(
      `SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idB, PM_B, 100, 0, '2000000', null],
    )
    // PM_B's own recompute succeeds despite PM_A's unrelated gap.
    expect(r.rows[0]).toMatchObject({ complete: true, cost_basis_atomic: '2000000' })
    // PM_A was correctly left untouched (never guessed over its own known gap).
    const posA = await db.query(`SELECT 1 FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(posA.rows.length).toBe(0)
  })

  it('cross-PM: raises when the REQUESTED PM itself is the one with the gap, even if the loop reaches it after other PMs', async () => {
    const idGappySibling = await insertOrphan('tx-gap-req', 'withdraw') // will be the requested PM, deliberately given no shares_burned
    await expect(db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idGappySibling, PM_A, 100, 0, null, null]))
      .rejects.toThrow()
  })

  // User directive (2026-09-10, third Codex pass): "a manager whose recorded withdrawals exceed recorded
  // minted shares can be skipped during recovery yet still appear complete." The skip itself was already
  // correct (never guesses); what was missing is a DURABLE record of it, since an over-burn sibling has
  // every field populated and can't be found by the read-side gap check alone.
  it('durably records a data_gap issue for a skipped sibling', async () => {
    await insertOrphan('tx-gap-issue-sibling', 'deposit', { quote_in: '1000000', position_manager: PM_A, block_number: 50, tx_index: 0 }) // no shares_minted
    const idB = await insertOrphan('tx-gap-issue-b', 'deposit', { quote_in: '2000000' })
    await db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idB, PM_B, 100, 0, '2000000', null])
    const issue = await db.query<{ reason: string }>(
      `SELECT reason FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(issue.rows[0]?.reason).toBe('data_gap')
  })

  it('durably records an over_burn issue for a skipped sibling', async () => {
    // PM_A has a withdraw burning more than was ever minted for it — an over-burn identity with every
    // field populated, undetectable by any NULL-field check.
    await insertOrphan('tx-overburn-sibling', 'withdraw', { shares_burned: '999999999', position_manager: PM_A, block_number: 50, tx_index: 0 })
    const idB = await insertOrphan('tx-overburn-issue-b', 'deposit', { quote_in: '2000000' })
    await db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idB, PM_B, 100, 0, '2000000', null])
    const issue = await db.query<{ reason: string }>(
      `SELECT reason FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`,
      [USER, POOL, CHAIN, PM_A],
    )
    expect(issue.rows[0]?.reason).toBe('over_burn')
  })

  it('clears a previously-recorded issue for an identity once IT successfully recomputes in a LATER call', async () => {
    // Round 1: PM_A is stuck (missing shares_minted) while PM_B resolves independently — PM_A's issue gets recorded.
    const gappyId = await insertOrphan('tx-heals-1', 'deposit', { quote_in: '1000000', position_manager: PM_A, block_number: 50, tx_index: 0 })
    const idB = await insertOrphan('tx-heals-b', 'deposit', { quote_in: '2000000' })
    await db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idB, PM_B, 100, 0, '2000000', null])
    let issue = await db.query(`SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(issue.rows.length).toBe(1)

    // Simulates an external correction resolving PM_A's own gap (e.g. a verified receipt supplying the
    // missing shares_minted) — direct UPDATE, mirroring how a real fix to historical data would land.
    await db.query(`UPDATE gateway_deposit_events SET shares_minted = '1000000' WHERE id = $1`, [gappyId])

    // A fresh orphan for the SAME wallet/pool/chain, resolved to a THIRD PM, triggers another full
    // cross-PM pass — PM_A is now healthy and should recompute, clearing its stale issue.
    const PM_C = 'pm-c'
    const idC = await insertOrphan('tx-heals-c', 'deposit', { quote_in: '3000000' })
    await db.query(`SELECT * FROM apply_gateway_pm_attribution($1,$2,$3,$4,$5,$6)`, [idC, PM_C, 102, 0, '3000000', null])

    issue = await db.query(`SELECT 1 FROM gateway_position_recompute_issues WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(issue.rows.length).toBe(0) // cleared — PM_A recomputed successfully this pass
    const posA = await db.query<{ entry_nav: string }>(`SELECT entry_nav::text FROM gateway_positions WHERE user_wallet=$1 AND pool_address=$2 AND chain_id=$3 AND position_manager=$4`, [USER, POOL, CHAIN, PM_A])
    expect(posA.rows[0]?.entry_nav).toBe('1000000')
  })
})
