//! Redis-backed hold store — the multi-instance sibling of `MemStore`. It runs the proven
//! atomic-reserve Lua scripts (see `redis_lua`) via `EVAL` against a shared Redis, so many edge
//! instances share hold state and the check-and-reserve stays atomic across processes.
//!
//! The heavy equity `mulDiv` stays in RUST (Redis Lua is double-precision — unsafe for big-integer
//! money math): the store reads the user's shares from Redis, values them against the cached NAV, and
//! passes `equity_usd` to the script, which does only the exact add/compare + counter/expiry work.
//! NAV freshness is enforced Rust-side (fail safe → decline) before the script runs.
//!
//! Single-node Redis only (the scripts build keys dynamically in the prune loop). The race-safety
//! logic is already proven by the mlua tests in `redis_lua`; this is the thin transport around it.

use redis::aio::MultiplexedConnection;
use redis::Script;

use crate::ledger::{Decision, Decline};
use crate::nav::NavSnapshot;
use crate::redis_lua::{RELEASE_LUA, RESERVE_LUA, SETTLE_LUA};
use crate::store::{AuthOutcome, DEFAULT_DAILY_CAP};
use crate::Usdc;

pub struct RedisStore {
    conn: MultiplexedConnection,
    reserve: Script,
    settle: Script,
    release: Script,
    /// Cached NAV (global, small) — refreshed per-instance by the chain refresher via `set_nav`.
    nav: NavSnapshot,
    max_nav_age_secs: u64,
    hold_ttl_secs: u64,
    /// Pre-audit #6 spend-safety guard — mirrors `MemStore` (both OFF by default → back-compatible).
    /// Threaded into `RESERVE_LUA` (ARGV[9]/[10]) so this shared-store path decides identically to the
    /// in-memory `portfolio::PortfolioGuard` path when the gates are set.
    min_liquidity_reserve_usdc: Usdc,
    breaker_open: bool,
}

impl RedisStore {
    /// Connect to Redis and prepare the scripts. `nav` is the starting snapshot (kept fresh via
    /// `set_nav`); `max_nav_age_secs` gates staleness; `hold_ttl_secs` is the hold reservation window.
    pub async fn connect(
        url: &str,
        nav: NavSnapshot,
        max_nav_age_secs: u64,
        hold_ttl_secs: u64,
    ) -> redis::RedisResult<Self> {
        let client = redis::Client::open(url)?;
        let conn = client.get_multiplexed_tokio_connection().await?;
        Ok(Self {
            conn,
            reserve: Script::new(RESERVE_LUA),
            settle: Script::new(SETTLE_LUA),
            release: Script::new(RELEASE_LUA),
            nav,
            max_nav_age_secs,
            hold_ttl_secs,
            min_liquidity_reserve_usdc: 0,
            breaker_open: false,
        })
    }

    /// Update the cached NAV (the refresher calls this each poll).
    pub fn set_nav(&mut self, nav: NavSnapshot) {
        self.nav = nav;
    }

    /// Size the always-liquid hot buffer (Pre-audit #6). 0 = off. Mirrors `MemStore::set_liquidity_reserve`.
    pub fn set_liquidity_reserve(&mut self, reserve_usdc: Usdc) {
        self.min_liquidity_reserve_usdc = reserve_usdc;
    }

    /// Trip / reset the system-wide spend circuit-breaker. Mirrors `MemStore::set_breaker`.
    pub fn set_breaker(&mut self, open: bool) {
        self.breaker_open = open;
    }

    /// Publish a user's share balance to the shared store (from the chain indexer).
    pub async fn set_shares(&mut self, user: &str, shares: u128) -> redis::RedisResult<()> {
        redis::cmd("SET")
            .arg(format!("ea:shares:{user}"))
            .arg(shares.to_string())
            .query_async(&mut self.conn)
            .await
    }

    /// Publish a user's daily cap (0 / unset → the global default).
    pub async fn set_daily_cap(&mut self, user: &str, cap: Usdc) -> redis::RedisResult<()> {
        redis::cmd("SET")
            .arg(format!("ea:cap:{user}"))
            .arg(cap.to_string())
            .query_async(&mut self.conn)
            .await
    }

    async fn get_u128(&mut self, key: String, default: u128) -> redis::RedisResult<u128> {
        let v: Option<String> = redis::cmd("GET").arg(key).query_async(&mut self.conn).await?;
        Ok(v.and_then(|s| s.parse().ok()).unwrap_or(default))
    }

    /// Atomic authorize: fail safe on a stale NAV, else value the user's equity in Rust and run the
    /// reserve script. Returns the ledger `Decision` + the created hold id (on approve/duplicate).
    pub async fn try_authorize(
        &mut self,
        hold_id: &str,
        user: &str,
        amount: Usdc,
        now_secs: u64,
    ) -> redis::RedisResult<AuthOutcome> {
        // Fail safe (same as the ledger) BEFORE touching Redis.
        if !self.nav.is_fresh(now_secs, self.max_nav_age_secs) {
            return Ok(AuthOutcome { decision: Decision::Decline(Decline::StaleNav), hold_id: None });
        }
        if !self.nav.price_is_fresh(now_secs, self.max_nav_age_secs) {
            return Ok(AuthOutcome { decision: Decision::Decline(Decline::StalePrice), hold_id: None });
        }

        let shares = self.get_u128(format!("ea:shares:{user}"), 0).await?;
        let equity = self.nav.equity(shares); // Rust-side mulDiv (precision-safe)
        let cap = self.get_u128(format!("ea:cap:{user}"), DEFAULT_DAILY_CAP).await?;
        // Collateral-valued settlement liquidity (USDC identity; ETH = idle WETH × price × γ), matching
        // the in-memory ledger — never the raw WETH idle for an ETH vault.
        let idle = self.nav.settleable_usd();

        let (_amt, status): (String, String) = self
            .reserve
            .prepare_invoke()
            .arg(hold_id)
            .arg(user)
            .arg(amount.to_string())
            .arg(equity.to_string())
            .arg(cap.to_string())
            .arg(idle.to_string())
            .arg(now_secs.to_string())
            .arg(self.hold_ttl_secs.to_string())
            .arg(if self.breaker_open { "1" } else { "0" })
            .arg(self.min_liquidity_reserve_usdc.to_string())
            .invoke_async(&mut self.conn)
            .await?;

        let decision = status_to_decision(&status, amount);
        let hold_id = matches!(status.as_str(), "ok" | "duplicate").then(|| hold_id.to_string());
        Ok(AuthOutcome { decision, hold_id })
    }

    /// Settle a hold (relayer, post on-chain settle) — releases the reservation + rolls into spend.
    pub async fn settle(&mut self, hold_id: &str, now_secs: u64) -> redis::RedisResult<bool> {
        let (_amt, status): (String, String) = self
            .settle
            .prepare_invoke()
            .arg(hold_id)
            .arg(now_secs.to_string())
            .invoke_async(&mut self.conn)
            .await?;
        Ok(status == "ok")
    }

    /// Release/cancel an active hold (Rain reversal).
    pub async fn cancel(&mut self, hold_id: &str) -> redis::RedisResult<bool> {
        let (_amt, status): (String, String) =
            self.release.prepare_invoke().arg(hold_id).invoke_async(&mut self.conn).await?;
        Ok(status == "ok")
    }
}

/// Map the Lua script's status string to a ledger `Decision`. Unknown → conservative decline.
fn status_to_decision(status: &str, amount: Usdc) -> Decision {
    match status {
        "ok" | "duplicate" => Decision::Approve { hold_usdc: amount },
        "zero_amount" => Decision::Decline(Decline::ZeroAmount),
        "insufficient_equity" => Decision::Decline(Decline::InsufficientEquity),
        "daily_cap_exceeded" => Decision::Decline(Decline::DailyCapExceeded),
        "insufficient_liquidity" => Decision::Decline(Decline::InsufficientLiquidity),
        "reserve_floor_breached" => Decision::Decline(Decline::ReserveFloorBreached),
        "circuit_breaker_open" => Decision::Decline(Decline::CircuitBreakerOpen),
        _ => Decision::Decline(Decline::InsufficientEquity),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::VaultCollateral;

    #[test]
    fn status_mapping_is_exhaustive_and_correct() {
        assert_eq!(status_to_decision("ok", 5), Decision::Approve { hold_usdc: 5 });
        assert_eq!(status_to_decision("duplicate", 5), Decision::Approve { hold_usdc: 5 });
        assert_eq!(status_to_decision("zero_amount", 5), Decision::Decline(Decline::ZeroAmount));
        assert_eq!(status_to_decision("insufficient_equity", 5), Decision::Decline(Decline::InsufficientEquity));
        assert_eq!(status_to_decision("daily_cap_exceeded", 5), Decision::Decline(Decline::DailyCapExceeded));
        assert_eq!(status_to_decision("insufficient_liquidity", 5), Decision::Decline(Decline::InsufficientLiquidity));
        assert_eq!(status_to_decision("reserve_floor_breached", 5), Decision::Decline(Decline::ReserveFloorBreached));
        assert_eq!(status_to_decision("circuit_breaker_open", 5), Decision::Decline(Decline::CircuitBreakerOpen));
        assert_eq!(status_to_decision("???", 5), Decision::Decline(Decline::InsufficientEquity));
    }

    // Full round-trip against a real Redis. Self-skips unless REDIS_URL is set:
    //   REDIS_URL=redis://127.0.0.1/ cargo test --test-threads=1 redis_store
    #[tokio::test]
    async fn reserve_settle_cancel_against_real_redis() {
        let url = match std::env::var("REDIS_URL") {
            Ok(u) => u,
            Err(_) => {
                eprintln!("skip: set REDIS_URL to run the real-Redis round-trip");
                return;
            }
        };
        let nav = NavSnapshot {
            total_assets: 10_000_000_000,
            total_shares: 10_000_000_000,
            virtual_offset: 1_000,
            idle_buffer: 10_000_000_000,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Usdc,
        };
        let mut s = RedisStore::connect(&url, nav, u64::MAX, 600).await.expect("connect");
        // isolate this run
        let u = format!("u{}", 1000);
        s.set_shares(&u, 1_000_000_000).await.unwrap(); // $1,000 equity
        s.set_daily_cap(&u, 100_000_000_000).await.unwrap();

        let a = s.try_authorize("rs_h1", &u, 600_000_000, 1000).await.unwrap();
        assert!(matches!(a.decision, Decision::Approve { .. }));
        // $500 more exceeds the $400 remaining equity.
        let b = s.try_authorize("rs_h2", &u, 500_000_000, 1000).await.unwrap();
        assert_eq!(b.decision, Decision::Decline(Decline::InsufficientEquity));
        // settle h1, then cancel is a no-op on a settled hold.
        assert!(s.settle("rs_h1", 1000).await.unwrap());
        assert!(!s.cancel("rs_h1").await.unwrap());
    }
}
