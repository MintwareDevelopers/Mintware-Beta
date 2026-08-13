//! Hold + account store. Increment 2 is an in-memory `MemStore` (a `Mutex` around the state); the
//! Redis-backed store with the same surface arrives in increment 3. The one property that MUST hold in
//! every backend: **authorize is atomic** — the availability check and the hold insert happen under a
//! single critical section, so two concurrent swipes can never both spend the last dollar.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::ledger::{self, Account, Decision, Global};
use crate::nav::NavSnapshot;
use crate::Usdc;

/// Default per-user daily cap when none is set — mirrors the Gateway's `DEFAULT_GLOBAL_DAILY_CAP`.
pub const DEFAULT_DAILY_CAP: Usdc = 1_000_000_000; // $1,000
const SECS_PER_DAY: u64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldStatus {
    Active,
    Settled,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone)]
pub struct Hold {
    pub user: String,
    pub amount_usdc: Usdc,
    pub created_secs: u64,
    pub expiry_secs: u64,
    pub status: HoldStatus,
}

impl Hold {
    fn reserves(&self) -> bool {
        self.status == HoldStatus::Active
    }
}

#[derive(Debug, Clone, Default)]
struct AccountData {
    shares: u128,
    daily_cap_usdc: Usdc, // 0 => use DEFAULT_DAILY_CAP
    spent_epoch_day: u64,
    spent_amount_usdc: Usdc,
}

impl AccountData {
    fn spent_today(&self, now_secs: u64) -> Usdc {
        if now_secs / SECS_PER_DAY == self.spent_epoch_day {
            self.spent_amount_usdc
        } else {
            0 // a new epoch day → the counter has rolled over
        }
    }
    fn cap(&self) -> Usdc {
        if self.daily_cap_usdc > 0 {
            self.daily_cap_usdc
        } else {
            DEFAULT_DAILY_CAP
        }
    }
}

struct Inner {
    nav: NavSnapshot,
    max_nav_age_secs: u64,
    hold_ttl_secs: u64,
    accounts: HashMap<String, AccountData>,
    holds: HashMap<String, Hold>,
}

/// In-memory implementation. `Send + Sync` via the inner `Mutex`; cheap to share behind an `Arc`.
pub struct MemStore {
    inner: Mutex<Inner>,
}

/// The result of an authorization attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthOutcome {
    pub decision: Decision,
    /// Present iff the decision was `Approve` — the created hold's id.
    pub hold_id: Option<String>,
}

impl MemStore {
    pub fn new(nav: NavSnapshot, max_nav_age_secs: u64, hold_ttl_secs: u64) -> Self {
        Self {
            inner: Mutex::new(Inner {
                nav,
                max_nav_age_secs,
                hold_ttl_secs,
                accounts: HashMap::new(),
                holds: HashMap::new(),
            }),
        }
    }

    // ── feeds (later: the on-chain indexer / NAV refresher write these) ─────────────
    pub fn set_nav(&self, nav: NavSnapshot) {
        self.inner.lock().unwrap().nav = nav;
    }
    pub fn set_shares(&self, user: &str, shares: u128) {
        self.inner.lock().unwrap().accounts.entry(user.to_string()).or_default().shares = shares;
    }
    pub fn set_daily_cap(&self, user: &str, cap: Usdc) {
        self.inner.lock().unwrap().accounts.entry(user.to_string()).or_default().daily_cap_usdc = cap;
    }

    // ── the hot path: atomic authorize ─────────────────────────────────────────────
    /// Reserve capacity for `amount` under `hold_id` if — and only if — the charge clears every gate,
    /// evaluated against a freshly-pruned view. The check and the hold insert share one lock, so the
    /// decision can never be invalidated by a racing authorize before the hold lands.
    pub fn try_authorize(&self, hold_id: &str, user: &str, amount: Usdc, now_secs: u64) -> AuthOutcome {
        let mut g = self.inner.lock().unwrap();
        Self::prune_expired(&mut g, now_secs);

        // An already-known hold id is idempotent-ish: an active/settled one is not re-reserved.
        if let Some(h) = g.holds.get(hold_id) {
            if h.status == HoldStatus::Active || h.status == HoldStatus::Settled {
                return AuthOutcome { decision: h_decision(h), hold_id: Some(hold_id.to_string()) };
            }
        }

        let acct = Self::account_view(&g, user, now_secs);
        let global = Global { total_active_holds_usdc: Self::total_active_holds(&g) };
        let decision = ledger::authorize(&g.nav, &acct, &global, amount, now_secs, g.max_nav_age_secs);

        if let Decision::Approve { hold_usdc } = decision {
            let ttl = g.hold_ttl_secs;
            g.holds.insert(hold_id.to_string(), Hold {
                user: user.to_string(),
                amount_usdc: hold_usdc,
                created_secs: now_secs,
                expiry_secs: now_secs.saturating_add(ttl),
                status: HoldStatus::Active,
            });
            return AuthOutcome { decision, hold_id: Some(hold_id.to_string()) };
        }
        AuthOutcome { decision, hold_id: None }
    }

    /// Mark a hold settled (called by the relayer after `settleSpend` lands) and roll its amount into
    /// the user's daily-spend counter. Returns false if the hold is unknown or not active.
    pub fn settle(&self, hold_id: &str, now_secs: u64) -> bool {
        let mut g = self.inner.lock().unwrap();
        let (user, amount) = match g.holds.get(hold_id) {
            Some(h) if h.status == HoldStatus::Active => (h.user.clone(), h.amount_usdc),
            _ => return false,
        };
        g.holds.get_mut(hold_id).unwrap().status = HoldStatus::Settled;
        let epoch = now_secs / SECS_PER_DAY;
        let a = g.accounts.entry(user).or_default();
        if a.spent_epoch_day != epoch {
            a.spent_epoch_day = epoch;
            a.spent_amount_usdc = 0;
        }
        a.spent_amount_usdc = a.spent_amount_usdc.saturating_add(amount);
        true
    }

    /// Release a hold (e.g. Rain reversed the auth). Returns false if unknown or not active.
    pub fn cancel(&self, hold_id: &str) -> bool {
        let mut g = self.inner.lock().unwrap();
        match g.holds.get_mut(hold_id) {
            Some(h) if h.status == HoldStatus::Active => {
                h.status = HoldStatus::Cancelled;
                true
            }
            _ => false,
        }
    }

    pub fn get_hold(&self, hold_id: &str) -> Option<Hold> {
        self.inner.lock().unwrap().holds.get(hold_id).cloned()
    }

    /// Available spend for a user right now (post-prune). Handy for a balance endpoint + tests.
    pub fn available(&self, user: &str, now_secs: u64) -> Usdc {
        let mut g = self.inner.lock().unwrap();
        Self::prune_expired(&mut g, now_secs);
        let acct = Self::account_view(&g, user, now_secs);
        let global = Global { total_active_holds_usdc: Self::total_active_holds(&g) };
        ledger::available(&g.nav, &acct, &global)
    }

    // ── internals ──────────────────────────────────────────────────────────────────
    fn prune_expired(g: &mut Inner, now_secs: u64) {
        for h in g.holds.values_mut() {
            if h.status == HoldStatus::Active && now_secs > h.expiry_secs {
                h.status = HoldStatus::Expired;
            }
        }
    }
    fn user_active_holds(g: &Inner, user: &str) -> Usdc {
        g.holds.values().filter(|h| h.reserves() && h.user == user).map(|h| h.amount_usdc).fold(0, Usdc::saturating_add)
    }
    fn total_active_holds(g: &Inner) -> Usdc {
        g.holds.values().filter(|h| h.reserves()).map(|h| h.amount_usdc).fold(0, Usdc::saturating_add)
    }
    fn account_view(g: &Inner, user: &str, now_secs: u64) -> Account {
        let d = g.accounts.get(user).cloned().unwrap_or_default();
        Account {
            shares: d.shares,
            active_holds_usdc: Self::user_active_holds(g, user),
            daily_spent_usdc: d.spent_today(now_secs),
            daily_cap_usdc: d.cap(),
        }
    }
}

fn h_decision(h: &Hold) -> Decision {
    Decision::Approve { hold_usdc: h.amount_usdc }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::Decline;

    fn nav() -> NavSnapshot {
        NavSnapshot { total_assets: 10_000_000_000, total_shares: 10_000_000_000, virtual_offset: 1_000, idle_buffer: 10_000_000_000, observed_at_secs: 1_000 }
    }
    // store with a $10k-liquid vault, 30s NAV age, 600s hold TTL; one user with $1,000 equity.
    fn store() -> MemStore {
        let s = MemStore::new(nav(), 30, 600);
        s.set_shares("alice", 1_000_000_000);
        s.set_daily_cap("alice", 100_000_000_000); // effectively uncapped for equity-focused tests
        s
    }
    const NOW: u64 = 1_010;

    #[test]
    fn approve_creates_active_hold() {
        let s = store();
        let out = s.try_authorize("h1", "alice", 100_000_000, NOW);
        assert_eq!(out.decision, Decision::Approve { hold_usdc: 100_000_000 });
        assert_eq!(s.get_hold("h1").unwrap().status, HoldStatus::Active);
    }

    #[test]
    fn hold_reduces_subsequent_available_then_settles() {
        let s = store();
        assert_eq!(s.available("alice", NOW), 1_000_000_000); // full equity (uncapped)
        s.try_authorize("h1", "alice", 600_000_000, NOW);
        assert_eq!(s.available("alice", NOW), 400_000_000); // $600 reserved
        // a second charge can't exceed the remaining $400.
        assert_eq!(s.try_authorize("h2", "alice", 400_000_001, NOW).decision, Decision::Decline(Decline::InsufficientEquity));
        assert_eq!(s.try_authorize("h2", "alice", 400_000_000, NOW).decision, Decision::Approve { hold_usdc: 400_000_000 });
        // settling h1 moves it out of "reserved" into daily-spent (still counted vs the cap).
        assert!(s.settle("h1", NOW));
        assert_eq!(s.get_hold("h1").unwrap().status, HoldStatus::Settled);
    }

    #[test]
    fn expired_hold_releases_capacity() {
        let s = store();
        s.try_authorize("h1", "alice", 700_000_000, NOW);
        assert_eq!(s.available("alice", NOW), 300_000_000);
        // after the TTL (600s), the hold auto-releases on the next touch.
        let later = NOW + 601;
        assert_eq!(s.available("alice", later), 1_000_000_000);
        assert_eq!(s.get_hold("h1").unwrap().status, HoldStatus::Expired);
    }

    #[test]
    fn cancel_releases_capacity() {
        let s = store();
        s.try_authorize("h1", "alice", 500_000_000, NOW);
        assert!(s.cancel("h1"));
        assert_eq!(s.available("alice", NOW), 1_000_000_000);
        assert!(!s.cancel("h1")); // already cancelled → no-op
    }

    #[test]
    fn unknown_user_has_zero_equity() {
        let s = store();
        assert_eq!(s.try_authorize("h1", "bob", 1_000_000, NOW).decision, Decision::Decline(Decline::InsufficientEquity));
    }

    #[test]
    fn duplicate_hold_id_is_not_double_reserved() {
        let s = store();
        let a = s.try_authorize("dup", "alice", 100_000_000, NOW);
        let b = s.try_authorize("dup", "alice", 100_000_000, NOW); // same id again
        assert_eq!(a.decision, b.decision);
        // only $100 reserved once → $900 still available, not $800.
        assert_eq!(s.available("alice", NOW), 900_000_000);
    }

    #[test]
    fn settled_amount_counts_against_daily_cap() {
        let s = MemStore::new(nav(), 30, 600);
        s.set_shares("carol", 10_000_000_000); // $10k equity, so equity never binds
        s.set_daily_cap("carol", 500_000_000);  // $500 cap
        assert!(matches!(s.try_authorize("h1", "carol", 300_000_000, NOW).decision, Decision::Approve { .. }));
        assert!(s.settle("h1", NOW)); // $300 now spent
        // $250 more would exceed the $500 cap ($300 spent + $250 = $550).
        assert_eq!(s.try_authorize("h2", "carol", 250_000_000, NOW).decision, Decision::Decline(Decline::DailyCapExceeded));
        assert!(matches!(s.try_authorize("h2", "carol", 200_000_000, NOW).decision, Decision::Approve { .. }));
    }
}
