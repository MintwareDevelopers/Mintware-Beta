//! Redis atomic-reserve scripts (increment 3). A production `RedisStore` shares hold state across many
//! edge instances; the check-and-reserve MUST be atomic across processes, so it runs as a Lua script
//! (Redis executes each EVAL atomically). The heavy `equity` math (virtual-offset mulDiv on 1e12+
//! values) stays in RUST — Redis Lua is double-precision (5.1 semantics), unsafe for big-integer
//! money math — and the script does only additions/comparisons of USDC amounts + counter updates,
//! which are exact within the safe range.
//!
//! Keys are built in-script from a namespace + user/hold ids (so the prune loop can reach OTHER users'
//! counters). This is single-node Redis (not Cluster-safe) — acceptable for the edge's shared cache.
//!
//! The Rust `RedisStore` that `EVALSHA`s these (via the `redis` crate) is a thin wrapper added when a
//! Redis instance is available; the RACE-SAFETY LOGIC below is proven here with an embedded Lua
//! interpreter + a mock Redis (see tests), which is the part that actually needs proving.
//!
//! PARITY (Pre-audit #6): the Redis `RESERVE_LUA` path now MIRRORS the two spend-safety gates the LIVE
//! `MemStore` / `portfolio::PortfolioGuard` path enforces — the system-wide circuit-breaker
//! (`circuit_breaker_open`, checked FIRST) and the always-liquid hot-buffer reserve floor
//! (`reserve_floor_breached`, checked after the absolute-liquidity floor) — threaded through
//! ARGV[9]/[10]. The mlua tests below prove the two backends decide identically across an input grid
//! (`parity_lua_matches_in_memory_across_input_grid`).

/// Atomic reserve. ARGV: [hold_id, user, amount, equity_usd, daily_cap, idle_buffer, now, ttl,
/// breaker, reserve] — `breaker` is 0/1 (system-wide halt) and `reserve` is the always-liquid
/// hot-buffer floor in USDC; both default to 0 when the arg is absent (i.e. pre-guard behavior).
/// Returns `{amount, status}` where status ∈ ok | duplicate | circuit_breaker_open | zero_amount |
/// insufficient_equity | daily_cap_exceeded | insufficient_liquidity | reserve_floor_breached.
/// Prunes expired holds first (decrementing counters), so `available` is computed against a live view —
/// then reserves iff the charge clears every bound. Decline priority mirrors
/// `portfolio::authorize_portfolio` EXACTLY: breaker → zero → equity → cap → liquidity → reserve-floor.
pub const RESERVE_LUA: &str = r#"
local ns = 'ea:'
local hold_id = ARGV[1]
local user    = ARGV[2]
local amount  = tonumber(ARGV[3])
local equity  = tonumber(ARGV[4])
local cap     = tonumber(ARGV[5])
local idle    = tonumber(ARGV[6])
local now     = tonumber(ARGV[7])
local ttl     = tonumber(ARGV[8])
local breaker = tonumber(ARGV[9] or '0')
local reserve = tonumber(ARGV[10] or '0')

-- 0. circuit-breaker: a system-wide stress trip halts EVERY authorization FIRST — mirrors
-- authorize_portfolio, which returns CircuitBreakerOpen before any other check. No state is mutated.
if breaker == 1 then return { '0', 'circuit_breaker_open' } end

local gheld_k = ns .. 'gheld'
local uheld_k = ns .. 'uheld:' .. user
local epoch   = math.floor(now / 86400)
local spent_k = ns .. 'spent:' .. user .. ':' .. epoch
local hold_k  = ns .. 'hold:' .. hold_id
local zexp_k  = ns .. 'holds_exp'

-- 1. prune holds whose expiry < now, decrementing the counters they reserved.
local expired = redis.call('ZRANGEBYSCORE', zexp_k, '-inf', '(' .. now)
for i = 1, #expired do
  local hid = expired[i]
  local hk  = ns .. 'hold:' .. hid
  local amt = tonumber(redis.call('HGET', hk, 'amount') or '0')
  local usr = redis.call('HGET', hk, 'user') or ''
  if amt > 0 then
    redis.call('DECRBY', gheld_k, amt)
    if usr ~= '' then redis.call('DECRBY', ns .. 'uheld:' .. usr, amt) end
  end
  redis.call('DEL', hk)
  redis.call('ZREM', zexp_k, hid)
end

-- 2. idempotency: an existing hold id is not re-reserved.
if redis.call('EXISTS', hold_k) == 1 then
  return { redis.call('HGET', hold_k, 'amount'), 'duplicate' }
end
if amount <= 0 then return { '0', 'zero_amount' } end

-- 3. availability from the (now-pruned) counters.
local uheld = tonumber(redis.call('GET', uheld_k) or '0')
local gheld = tonumber(redis.call('GET', gheld_k) or '0')
local spent = tonumber(redis.call('GET', spent_k) or '0')

local per_user = equity - uheld
local cap_room = cap - spent - uheld
local liq      = idle - gheld            -- raw settleable liquidity net of all active holds

if amount > per_user then return { '0', 'insufficient_equity' } end
if amount > cap_room then return { '0', 'daily_cap_exceeded' } end
if amount > liq      then return { '0', 'insufficient_liquidity' } end

-- hot-buffer reserve floor: there IS raw liquidity, but spending it would draw usable liquidity below
-- the always-liquid reserve → decline before par can break. Mirrors authorize_portfolio's
-- ReserveFloorBreached, which is checked AFTER the absolute-liquidity floor (so the absolute floor wins
-- when the charge also exceeds raw liquidity).
local usable = liq - reserve
if amount > usable then return { '0', 'reserve_floor_breached' } end

-- 4. reserve: bump counters, write the hold, index it by expiry.
local expiry = now + ttl
redis.call('INCRBY', uheld_k, amount)
redis.call('INCRBY', gheld_k, amount)
redis.call('HSET', hold_k, 'user', user, 'amount', amount, 'expiry', expiry, 'status', 'active')
redis.call('EXPIRE', hold_k, ttl + 120)
redis.call('ZADD', zexp_k, expiry, hold_id)
return { tostring(amount), 'ok' }
"#;

/// Settle a hold. ARGV: [hold_id, now]. Releases its reservation and rolls the amount into the user's
/// daily-spend counter. Returns `{amount, status}` (status ok | not_active).
pub const SETTLE_LUA: &str = r#"
local ns = 'ea:'
local hold_k = ns .. 'hold:' .. ARGV[1]
local now = tonumber(ARGV[2])
if redis.call('HGET', hold_k, 'status') ~= 'active' then return { '0', 'not_active' } end
local amt  = tonumber(redis.call('HGET', hold_k, 'amount') or '0')
local user = redis.call('HGET', hold_k, 'user') or ''
local epoch = math.floor(now / 86400)
redis.call('DECRBY', ns .. 'gheld', amt)
redis.call('DECRBY', ns .. 'uheld:' .. user, amt)
redis.call('INCRBY', ns .. 'spent:' .. user .. ':' .. epoch, amt)
redis.call('EXPIRE', ns .. 'spent:' .. user .. ':' .. epoch, 172800)
redis.call('HSET', hold_k, 'status', 'settled')
redis.call('ZREM', ns .. 'holds_exp', ARGV[1])
return { tostring(amt), 'ok' }
"#;

/// Release/cancel an active hold. ARGV: [hold_id]. Returns `{amount, status}` (ok | not_active).
pub const RELEASE_LUA: &str = r#"
local ns = 'ea:'
local hold_k = ns .. 'hold:' .. ARGV[1]
if redis.call('HGET', hold_k, 'status') ~= 'active' then return { '0', 'not_active' } end
local amt  = tonumber(redis.call('HGET', hold_k, 'amount') or '0')
local user = redis.call('HGET', hold_k, 'user') or ''
redis.call('DECRBY', ns .. 'gheld', amt)
redis.call('DECRBY', ns .. 'uheld:' .. user, amt)
redis.call('HSET', hold_k, 'status', 'cancelled')
redis.call('ZREM', ns .. 'holds_exp', ARGV[1])
return { tostring(amt), 'ok' }
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use mlua::{Lua, MultiValue, Value, Variadic};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    /// A tiny in-memory Redis supporting exactly the commands the scripts use.
    #[derive(Default)]
    struct MockRedis {
        strings: HashMap<String, String>,
        hashes: HashMap<String, HashMap<String, String>>,
        zsets: HashMap<String, Vec<(f64, String)>>, // (score, member)
    }

    enum R {
        Nil,
        Int(i64),
        Bulk(String),
        Arr(Vec<String>),
    }

    impl MockRedis {
        fn call(&mut self, cmd: &str, a: &[String]) -> R {
            match cmd.to_uppercase().as_str() {
                "GET" => self.strings.get(&a[0]).map(|s| R::Bulk(s.clone())).unwrap_or(R::Nil),
                "SET" => { self.strings.insert(a[0].clone(), a[1].clone()); R::Bulk("OK".into()) }
                "INCRBY" | "DECRBY" => {
                    let cur: i64 = self.strings.get(&a[0]).and_then(|s| s.parse().ok()).unwrap_or(0);
                    let d: i64 = a[1].parse().unwrap();
                    let next = if cmd.eq_ignore_ascii_case("INCRBY") { cur + d } else { cur - d };
                    self.strings.insert(a[0].clone(), next.to_string());
                    R::Int(next)
                }
                "EXISTS" => R::Int(self.hashes.contains_key(&a[0]) as i64),
                "HGET" => self.hashes.get(&a[0]).and_then(|h| h.get(&a[1])).map(|s| R::Bulk(s.clone())).unwrap_or(R::Nil),
                "HSET" => {
                    let h = self.hashes.entry(a[0].clone()).or_default();
                    let mut i = 1;
                    while i + 1 < a.len() { h.insert(a[i].clone(), a[i + 1].clone()); i += 2; }
                    R::Int(1)
                }
                "DEL" => { self.hashes.remove(&a[0]); self.strings.remove(&a[0]); R::Int(1) }
                "EXPIRE" => R::Int(1), // TTL is irrelevant to the logic under test
                "ZADD" => {
                    let z = self.zsets.entry(a[0].clone()).or_default();
                    let score: f64 = a[1].parse().unwrap();
                    z.retain(|(_, m)| m != &a[2]);
                    z.push((score, a[2].clone()));
                    R::Int(1)
                }
                "ZREM" => { if let Some(z) = self.zsets.get_mut(&a[0]) { z.retain(|(_, m)| m != &a[1]); } R::Int(1) }
                "ZRANGEBYSCORE" => {
                    // max may be exclusive: "(N"
                    let (excl, max) = a[2].strip_prefix('(').map(|s| (true, s)).unwrap_or((false, a[2].as_str()));
                    let max: f64 = max.parse().unwrap();
                    let mut out: Vec<(f64, String)> = self.zsets.get(&a[0]).cloned().unwrap_or_default()
                        .into_iter().filter(|(s, _)| if excl { *s < max } else { *s <= max }).collect();
                    out.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
                    R::Arr(out.into_iter().map(|(_, m)| m).collect())
                }
                other => panic!("mock redis: unsupported command {other}"),
            }
        }
    }

    /// Run a script with the given ARGV against a shared mock; returns (amount, status).
    fn eval(lua: &Lua, store: &Rc<RefCell<MockRedis>>, script: &str, argv: &[&str]) -> (String, String) {
        let redis_tbl = lua.create_table().unwrap();
        let sc = store.clone();
        let call = lua
            .create_function(move |lua, args: Variadic<Value>| {
                let strs: Vec<String> = args.iter().map(|v| match v {
                    Value::String(s) => s.to_str().unwrap().to_string(),
                    Value::Integer(i) => i.to_string(),
                    Value::Number(n) => (*n as i64).to_string(),
                    _ => String::new(),
                }).collect();
                let (cmd, rest) = strs.split_first().unwrap();
                match sc.borrow_mut().call(cmd, rest) {
                    R::Nil => Ok(MultiValue::from_vec(vec![Value::Nil])),
                    R::Int(i) => Ok(MultiValue::from_vec(vec![Value::Integer(i)])),
                    R::Bulk(s) => Ok(MultiValue::from_vec(vec![Value::String(lua.create_string(&s)?)])),
                    R::Arr(v) => {
                        let t = lua.create_table()?;
                        for (i, m) in v.iter().enumerate() { t.set(i + 1, lua.create_string(m)?)?; }
                        Ok(MultiValue::from_vec(vec![Value::Table(t)]))
                    }
                }
            })
            .unwrap();
        redis_tbl.set("call", call).unwrap();
        lua.globals().set("redis", redis_tbl).unwrap();
        let argv_t = lua.create_table().unwrap();
        for (i, v) in argv.iter().enumerate() { argv_t.set(i + 1, *v).unwrap(); }
        lua.globals().set("ARGV", argv_t).unwrap();
        let ret: mlua::Table = lua.load(script).eval().unwrap();
        // mlua 0.10+: Table::get takes ONE generic (the value type); the key type is inferred.
        (ret.get::<String>(1).unwrap(), ret.get::<String>(2).unwrap())
    }

    // reserve with: equity, cap, idle, now, ttl fixed; amount/user/hold vary. 8-arg form (no guard) —
    // exercises the back-compat default where the script reads breaker/reserve as 0 when the args are
    // absent, so every pre-existing test proves behavior is UNCHANGED with the gates off.
    #[allow(clippy::too_many_arguments)] // a test helper — explicit args read clearer than a struct here
    fn reserve(lua: &Lua, s: &Rc<RefCell<MockRedis>>, hold: &str, user: &str, amount: u128, equity: u128, cap: u128, idle: u128, now: u64) -> (String, String) {
        eval(lua, s, RESERVE_LUA, &[hold, user, &amount.to_string(), &equity.to_string(), &cap.to_string(), &idle.to_string(), &now.to_string(), "600"])
    }

    // reserve with the two Pre-audit #6 guard knobs threaded through ARGV[9]/[10].
    #[allow(clippy::too_many_arguments)]
    fn reserve_g(lua: &Lua, s: &Rc<RefCell<MockRedis>>, hold: &str, user: &str, amount: u128, equity: u128, cap: u128, idle: u128, now: u64, breaker: u8, reserve: u128) -> (String, String) {
        eval(lua, s, RESERVE_LUA, &[hold, user, &amount.to_string(), &equity.to_string(), &cap.to_string(), &idle.to_string(), &now.to_string(), "600", &breaker.to_string(), &reserve.to_string()])
    }

    /// Seed a raw counter directly into the mock (to place a user under pre-existing holds/spend when
    /// exercising the availability math, without threading a full reserve/settle sequence first).
    fn set_counter(s: &Rc<RefCell<MockRedis>>, key: &str, val: u128) {
        s.borrow_mut().call("SET", &[key.to_string(), val.to_string()]);
    }

    #[test]
    fn reserve_approves_then_holds_reduce_available() {
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        // equity $1000, cap $1000 (uncapped-ish), idle $10k.
        let (amt, st) = reserve(&lua, &s, "h1", "alice", 600_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!((amt.as_str(), st.as_str()), ("600000000", "ok"));
        // second $500 exceeds the remaining $400 equity.
        let (_, st2) = reserve(&lua, &s, "h2", "alice", 500_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(st2, "insufficient_equity");
        // $400 fits.
        let (_, st3) = reserve(&lua, &s, "h3", "alice", 400_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(st3, "ok");
    }

    #[test]
    fn concurrent_double_spend_is_prevented_by_atomicity() {
        // Two reserves of the full equity against the SAME state: the second must see the first's hold.
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        let (_, a) = reserve(&lua, &s, "hA", "bob", 1_000_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        let (_, b) = reserve(&lua, &s, "hB", "bob", 1_000_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(a, "ok");
        assert_eq!(b, "insufficient_equity"); // the last dollar can't be spent twice
    }

    #[test]
    fn duplicate_hold_id_is_idempotent() {
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        let (_, a) = reserve(&lua, &s, "dup", "carol", 100_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        let (amt, b) = reserve(&lua, &s, "dup", "carol", 100_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(a, "ok");
        assert_eq!(b, "duplicate");
        assert_eq!(amt, "100000000");
        // still only $100 reserved → $900 available (not $800).
        let (_, c) = reserve(&lua, &s, "h9", "carol", 900_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(c, "ok");
    }

    #[test]
    fn expired_holds_are_pruned_and_capacity_returns() {
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        // reserve $700 at t=1000 (ttl 600 → expiry 1600).
        let (_, a) = reserve(&lua, &s, "hx", "dave", 700_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(a, "ok");
        // at t=1000, only $300 left.
        let (_, b) = reserve(&lua, &s, "hy", "dave", 301_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(b, "insufficient_equity");
        // at t=1601 (> expiry) the prune releases hx → full $1000 available again.
        let (_, c) = reserve(&lua, &s, "hz", "dave", 1_000_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1601);
        assert_eq!(c, "ok");
    }

    #[test]
    fn cap_and_liquidity_bounds_and_settle_rolls_into_spend() {
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        // daily cap binds: equity $10k, cap $500, idle ample.
        let (_, cap) = reserve(&lua, &s, "hc", "erin", 501_000_000, 10_000_000_000, 500_000_000, 10_000_000_000, 1000);
        assert_eq!(cap, "daily_cap_exceeded");
        // liquidity binds: equity $10k, cap $10k, idle only $1.
        let (_, liq) = reserve(&lua, &s, "hl", "erin", 2_000_000, 10_000_000_000, 10_000_000_000, 1_000_000, 1000);
        assert_eq!(liq, "insufficient_liquidity");
        // settle an approved hold rolls its amount into daily spend (so the cap tightens next time).
        let (_, ok) = reserve(&lua, &s, "hs", "frank", 300_000_000, 10_000_000_000, 500_000_000, 10_000_000_000, 1000);
        assert_eq!(ok, "ok");
        let (samt, sst) = eval(&lua, &s, SETTLE_LUA, &["hs", "1000"]);
        assert_eq!((samt.as_str(), sst.as_str()), ("300000000", "ok"));
        // now $300 is spent → only $200 of the $500 cap remains.
        let (_, tight) = reserve(&lua, &s, "ht", "frank", 201_000_000, 10_000_000_000, 500_000_000, 10_000_000_000, 1000);
        assert_eq!(tight, "daily_cap_exceeded");
    }

    #[test]
    fn release_returns_capacity() {
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        let (_, a) = reserve(&lua, &s, "hr", "gina", 500_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(a, "ok");
        let (_, r) = eval(&lua, &s, RELEASE_LUA, &["hr"]);
        assert_eq!(r, "ok");
        // full equity available again.
        let (_, c) = reserve(&lua, &s, "hr2", "gina", 1_000_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000);
        assert_eq!(c, "ok");
    }

    // ── Pre-audit #6: circuit-breaker + hot-buffer reserve floor (mirror of portfolio::PortfolioGuard) ──

    #[test]
    fn breaker_open_declines_even_a_trivially_valid_charge() {
        // A rich, liquid, uncapped user — normally a trivial approve — is halted while the system-wide
        // breaker is open (breaker=1), with the DISTINCT circuit_breaker_open reason, checked FIRST.
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        let (_, st) = reserve_g(&lua, &s, "b1", "ivy", 1_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000, 1, 0);
        assert_eq!(st, "circuit_breaker_open");
        // No state mutated: with the breaker closed the SAME charge (fresh id) approves.
        let (_, ok) = reserve_g(&lua, &s, "b2", "ivy", 1_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000, 1000, 0, 0);
        assert_eq!(ok, "ok");
    }

    #[test]
    fn reserve_floor_clamps_available_with_a_distinct_reason() {
        // $500 raw idle liquidity, huge equity + uncapped so LIQUIDITY is the binding dimension. Reserve
        // $200 as an always-liquid hot buffer → only $300 usable.
        let lua = Lua::new();
        let s = Rc::new(RefCell::new(MockRedis::default()));
        // Up to the usable $300 approves.
        let (_, ok) = reserve_g(&lua, &s, "r_ok", "jae", 300_000_000, 1_000_000_000_000, 100_000_000_000_000, 500_000_000, 1000, 0, 200_000_000);
        assert_eq!(ok, "ok");
        // At the boundary +1 it would eat the reserve → reserve_floor_breached (there IS raw liquidity,
        // so it is NOT the generic insufficient_liquidity). Fresh mock so the $300 hold above doesn't count.
        let s2 = Rc::new(RefCell::new(MockRedis::default()));
        let (_, floor) = reserve_g(&lua, &s2, "r_over", "jae", 300_000_001, 1_000_000_000_000, 100_000_000_000_000, 500_000_000, 1000, 0, 200_000_000);
        assert_eq!(floor, "reserve_floor_breached");
        // Above the RAW liquidity ($500) it is the absolute-liquidity reason, not the reserve reason.
        let s3 = Rc::new(RefCell::new(MockRedis::default()));
        let (_, liq) = reserve_g(&lua, &s3, "r_liq", "jae", 500_000_001, 1_000_000_000_000, 100_000_000_000_000, 500_000_000, 1000, 0, 200_000_000);
        assert_eq!(liq, "insufficient_liquidity");
    }

    #[test]
    fn breaker0_reserve0_is_identical_to_the_pre_guard_path() {
        // With both gates off the 10-arg guard form must decide EXACTLY as the legacy 8-arg form, for a
        // spread of binding dimensions (approve, equity, cap, liquidity, zero).
        let lua = Lua::new();
        let cases: &[(u128, u128, u128, u128)] = &[
            // (amount, equity, cap, idle)
            (100_000_000, 1_000_000_000, 100_000_000_000, 10_000_000_000), // approve
            (1_000_000_001, 1_000_000_000, 100_000_000_000, 10_000_000_000), // insufficient_equity
            (501_000_000, 10_000_000_000, 500_000_000, 10_000_000_000), // daily_cap_exceeded
            (2_000_000, 10_000_000_000, 10_000_000_000, 1_000_000), // insufficient_liquidity
            (0, 1_000_000_000, 100_000_000_000, 10_000_000_000), // zero_amount
        ];
        for (i, &(amt, eq, cap, idle)) in cases.iter().enumerate() {
            let s_legacy = Rc::new(RefCell::new(MockRedis::default()));
            let s_guard = Rc::new(RefCell::new(MockRedis::default()));
            let hold = format!("c{i}");
            let (la, ls) = reserve(&lua, &s_legacy, &hold, "kai", amt, eq, cap, idle, 1000);
            let (ga, gs) = reserve_g(&lua, &s_guard, &hold, "kai", amt, eq, cap, idle, 1000, 0, 0);
            assert_eq!((ls.as_str(), la.as_str()), (gs.as_str(), ga.as_str()), "case {i} diverged with gates off");
        }
    }

    /// The real proof: run the Lua `RESERVE_LUA` decision and the in-memory `authorize_portfolio`
    /// decision on the SAME scalar inputs and assert they agree, across a grid of
    /// (equity, uheld, cap, spent, idle, gheld, breaker, reserve, amount).
    #[test]
    fn parity_lua_matches_in_memory_across_input_grid() {
        use crate::ledger::{Account, Decision};
        use crate::nav::{NavSnapshot, VaultCollateral};
        use crate::portfolio::{authorize_portfolio, Leg, PortfolioGuard};
        use crate::types::decline_code;

        const NOW: u64 = 1_000_000; // > 86_400 so the spent epoch key is non-trivial

        // The authoritative in-memory decision as a status string (aligned to `decline_code`). A single
        // USDC 1:1 vault with virtual_offset 0 makes equity(shares) == shares exactly, and settleable
        // == idle_buffer, so the scalar inputs map cleanly onto one portfolio leg.
        #[allow(clippy::too_many_arguments)] // the scalar inputs read clearer flat than boxed in a struct
        fn inmem_status(equity: u128, uheld: u128, cap: u128, spent: u128, idle: u128, gheld: u128, breaker: u8, reserve: u128, amount: u128) -> String {
            let nav = NavSnapshot {
                total_assets: 1,
                total_shares: 1,
                virtual_offset: 0, // asset_amount(shares) = shares*1/1 = shares → equity == shares (USDC identity)
                idle_buffer: idle, // settleable_usd() == idle_buffer for USDC
                observed_at_secs: NOW, // fresh (age 0)
                collateral: VaultCollateral::Usdc,
            };
            let leg = Leg { nav, shares: equity, vault_global_holds_usdc: gheld };
            let acct = Account { shares: 0, active_holds_usdc: uheld, daily_spent_usdc: spent, daily_cap_usdc: cap };
            let guard = PortfolioGuard { breaker_open: breaker == 1, min_liquidity_reserve_usdc: reserve };
            match authorize_portfolio(std::slice::from_ref(&leg), &acct, amount, NOW, u64::MAX, &guard) {
                Decision::Approve { .. } => "ok".to_string(),
                Decision::Decline(r) => decline_code(r).to_string(),
            }
        }

        let equities: [u128; 3] = [0, 500_000_000, 1_000_000_000];
        let uhelds:   [u128; 2] = [0, 300_000_000];
        let caps:     [u128; 2] = [400_000_000, 100_000_000_000];
        let spents:   [u128; 2] = [0, 300_000_000];
        let idles:    [u128; 3] = [1_000_000, 400_000_000, 10_000_000_000];
        let ghelds:   [u128; 2] = [0, 300_000_000];
        let breakers: [u8; 2] = [0, 1];
        let reserves: [u128; 3] = [0, 200_000_000, 10_000_000_000];
        let amounts:  [u128; 4] = [0, 1, 250_000_000, 500_000_001];

        let lua = Lua::new();
        let user = "zoe";
        let epoch = NOW / 86_400;
        let spent_key = format!("ea:spent:{user}:{epoch}");
        let mut combos = 0usize;
        let mut id = 0usize;

        for &equity in &equities {
        for &uheld in &uhelds {
        for &cap in &caps {
        for &spent in &spents {
        for &idle in &idles {
        for &gheld in &ghelds {
        for &breaker in &breakers {
        for &reserve in &reserves {
        for &amount in &amounts {
            // Fresh mock per combo, pre-seeded with the user's existing holds/spend counters.
            let s = Rc::new(RefCell::new(MockRedis::default()));
            set_counter(&s, "ea:gheld", gheld);
            set_counter(&s, &format!("ea:uheld:{user}"), uheld);
            set_counter(&s, &spent_key, spent);

            id += 1;
            let hold = format!("p{id}"); // fresh id → idempotency never fires
            let (_, lua_status) = reserve_g(&lua, &s, &hold, user, amount, equity, cap, idle, NOW, breaker, reserve);
            let mem_status = inmem_status(equity, uheld, cap, spent, idle, gheld, breaker, reserve, amount);
            assert_eq!(
                lua_status, mem_status,
                "parity divergence: equity={equity} uheld={uheld} cap={cap} spent={spent} idle={idle} gheld={gheld} breaker={breaker} reserve={reserve} amount={amount}"
            );
            combos += 1;
        }}}}}}}}}

        assert_eq!(combos, 3 * 2 * 2 * 2 * 3 * 2 * 2 * 3 * 4, "grid size");
        assert_eq!(combos, 3456);
    }
}
