//! The authorization decision core — the sub-150ms risk logic behind every card swipe.
//!
//! A charge is APPROVED only if it clears ALL of: per-user equity, the daily cap, and global
//! settlement liquidity — each a distinct decline reason, checked in a fixed priority order so the
//! response is deterministic. APPROVE reserves a hold of the amount, which reduces both the user's and
//! the global available capacity until it settles on-chain or its TTL expires. Pure + synchronous:
//! the caller supplies the current `Account`/`Global`/`NavSnapshot` (read from Redis/cache upstream).

use crate::{nav::NavSnapshot, Usdc};

/// Per-user spend state at authorization time (read from the hold/counter store).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Account {
    /// The user's vault share balance (valued against the cached NAV).
    pub shares: u128,
    /// Sum of THIS user's currently-active holds (reserved, not yet settled/expired), in USDC.
    pub active_holds_usdc: Usdc,
    /// USDC this user has already spent in the current daily epoch.
    pub daily_spent_usdc: Usdc,
    /// The user's daily cap (mirror of the Gateway's per-user cap / global default), in USDC.
    pub daily_cap_usdc: Usdc,
}

/// Vault-wide state that bounds every authorization (shared across all users).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Global {
    /// Sum of ALL users' active holds. Every hold must be settleable, so the total can't exceed the
    /// idle buffer — otherwise a later `settleSpend` reverts `InsufficientIdleLiquidity`.
    pub total_active_holds_usdc: Usdc,
}

/// Why a charge was declined. Priority order matches `authorize`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decline {
    /// The cached NAV is older than the allowed age — fail safe rather than authorize stale.
    StaleNav,
    /// Zero (or dust-to-zero) amount.
    ZeroAmount,
    /// Amount exceeds the user's equity net of their own active holds.
    InsufficientEquity,
    /// Amount would exceed the user's remaining daily cap.
    DailyCapExceeded,
    /// Amount exceeds the vault's settleable liquidity net of all active holds.
    InsufficientLiquidity,
}

/// The authorization outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Approved — reserve a hold of exactly `hold_usdc`.
    Approve { hold_usdc: Usdc },
    /// Declined, with the binding reason.
    Decline(Decline),
}

/// The spendable capacity right now = the tightest of the three bounds. (Assumes a fresh NAV; the
/// staleness check lives in `authorize`.)
pub fn available(nav: &NavSnapshot, acct: &Account, global: &Global) -> Usdc {
    let equity = nav.equity(acct.shares);
    let per_user = equity.saturating_sub(acct.active_holds_usdc);
    let cap_room = acct.daily_cap_usdc.saturating_sub(acct.daily_spent_usdc);
    let liquidity = nav.idle_buffer.saturating_sub(global.total_active_holds_usdc);
    per_user.min(cap_room).min(liquidity)
}

/// Decide APPROVE/DECLINE for a charge of `amount` USDC. Checks, in priority order: NAV freshness,
/// non-zero amount, per-user equity, daily cap, global liquidity. On APPROVE the caller must reserve
/// a hold of `amount` (atomically) before returning success to the card network.
pub fn authorize(
    nav: &NavSnapshot,
    acct: &Account,
    global: &Global,
    amount: Usdc,
    now_secs: u64,
    max_nav_age_secs: u64,
) -> Decision {
    if !nav.is_fresh(now_secs, max_nav_age_secs) {
        return Decision::Decline(Decline::StaleNav);
    }
    if amount == 0 {
        return Decision::Decline(Decline::ZeroAmount);
    }
    let equity = nav.equity(acct.shares);
    if amount > equity.saturating_sub(acct.active_holds_usdc) {
        return Decision::Decline(Decline::InsufficientEquity);
    }
    if amount > acct.daily_cap_usdc.saturating_sub(acct.daily_spent_usdc) {
        return Decision::Decline(Decline::DailyCapExceeded);
    }
    if amount > nav.idle_buffer.saturating_sub(global.total_active_holds_usdc) {
        return Decision::Decline(Decline::InsufficientLiquidity);
    }
    Decision::Approve { hold_usdc: amount }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deep, liquid vault so a single knob isolates the gate under test.
    fn fresh_nav() -> NavSnapshot {
        NavSnapshot {
            total_assets: 10_000_000_000,   // $10,000 backing
            total_shares: 10_000_000_000,   // ~1:1 shares
            virtual_offset: 1_000,
            idle_buffer: 10_000_000_000,    // fully liquid
            observed_at_secs: 1_000,
        }
    }
    // $1,000 equity, no holds, $500 daily cap unused.
    fn acct() -> Account {
        Account { shares: 1_000_000_000, active_holds_usdc: 0, daily_spent_usdc: 0, daily_cap_usdc: 500_000_000 }
    }
    fn global() -> Global {
        Global { total_active_holds_usdc: 0 }
    }
    const NOW: u64 = 1_010;
    const MAX_AGE: u64 = 30;

    fn auth(a: &Account, g: &Global, amt: Usdc) -> Decision {
        authorize(&fresh_nav(), a, g, amt, NOW, MAX_AGE)
    }

    #[test]
    fn approves_within_all_bounds() {
        // $100 <= $1000 equity, <= $500 cap, <= $10k liquidity → approve, hold == amount.
        assert_eq!(auth(&acct(), &global(), 100_000_000), Decision::Approve { hold_usdc: 100_000_000 });
    }

    #[test]
    fn declines_zero() {
        assert_eq!(auth(&acct(), &global(), 0), Decision::Decline(Decline::ZeroAmount));
    }

    #[test]
    fn declines_over_equity() {
        // $600 > $500 cap would trip the cap first; use a higher cap to isolate equity ($1000).
        let mut a = acct();
        a.daily_cap_usdc = 100_000_000_000; // effectively uncapped
        assert_eq!(auth(&a, &global(), 1_000_000_001), Decision::Decline(Decline::InsufficientEquity));
        // exactly equity is fine.
        assert_eq!(auth(&a, &global(), 1_000_000_000), Decision::Approve { hold_usdc: 1_000_000_000 });
    }

    #[test]
    fn active_holds_reduce_user_available() {
        let mut a = acct();
        a.daily_cap_usdc = 100_000_000_000;
        a.active_holds_usdc = 900_000_000; // $900 already reserved → $100 left of $1000 equity
        assert_eq!(auth(&a, &global(), 100_000_000), Decision::Approve { hold_usdc: 100_000_000 });
        assert_eq!(auth(&a, &global(), 100_000_001), Decision::Decline(Decline::InsufficientEquity));
    }

    #[test]
    fn declines_over_daily_cap() {
        // Equity ($1000) and liquidity are ample; the $500 cap binds.
        assert_eq!(auth(&acct(), &global(), 500_000_001), Decision::Decline(Decline::DailyCapExceeded));
        assert_eq!(auth(&acct(), &global(), 500_000_000), Decision::Approve { hold_usdc: 500_000_000 });
    }

    #[test]
    fn daily_spent_reduces_cap_room() {
        let mut a = acct();
        a.daily_spent_usdc = 450_000_000; // $50 of the $500 cap left
        assert_eq!(auth(&a, &global(), 50_000_000), Decision::Approve { hold_usdc: 50_000_000 });
        assert_eq!(auth(&a, &global(), 50_000_001), Decision::Decline(Decline::DailyCapExceeded));
    }

    #[test]
    fn declines_over_global_liquidity() {
        // A rich, high-cap user, but the vault is almost fully reserved by OTHER users' holds.
        let mut a = acct();
        a.shares = 10_000_000_000;          // $10k equity
        a.daily_cap_usdc = 100_000_000_000; // uncapped
        let g = Global { total_active_holds_usdc: 9_999_000_000 }; // only $1 of idle buffer free
        assert_eq!(auth(&a, &g, 2_000_000), Decision::Decline(Decline::InsufficientLiquidity));
        assert_eq!(auth(&a, &g, 1_000_000), Decision::Approve { hold_usdc: 1_000_000 });
    }

    #[test]
    fn declines_stale_nav_before_anything_else() {
        // Even a trivially-valid $1 charge is declined if the NAV is stale (fail safe).
        let stale = NavSnapshot { observed_at_secs: 900, ..fresh_nav() }; // now=1010, age 110 > 30
        assert_eq!(
            authorize(&stale, &acct(), &global(), 1_000_000, NOW, MAX_AGE),
            Decision::Decline(Decline::StaleNav)
        );
    }

    #[test]
    fn available_is_the_tightest_bound() {
        // equity $1000, cap $500, liquidity $10k → available = $500 (the cap).
        assert_eq!(available(&fresh_nav(), &acct(), &global()), 500_000_000);
        // raise the cap → equity ($1000) binds.
        let mut a = acct();
        a.daily_cap_usdc = 100_000_000_000;
        assert_eq!(available(&fresh_nav(), &a, &global()), 1_000_000_000);
        // now starve liquidity → liquidity binds.
        let g = Global { total_active_holds_usdc: 9_999_500_000 }; // $0.5 free
        assert_eq!(available(&fresh_nav(), &a, &g), 500_000);
    }

    #[test]
    fn approving_up_to_available_always_succeeds_and_one_over_fails() {
        let a = acct();
        let g = global();
        let avail = available(&fresh_nav(), &a, &g);
        assert!(matches!(auth(&a, &g, avail), Decision::Approve { .. }));
        assert!(matches!(auth(&a, &g, avail + 1), Decision::Decline(_)));
    }
}
