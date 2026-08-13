//! Cached vault NAV — the O(1) read the hot path values a user's equity against.
//!
//! Price-free by construction (single-asset USDC vault), so equity is computed with the *same*
//! symmetric virtual-offset math as `MintwareYieldVault.convertToAssets` (round DOWN). A staleness
//! guard lets the caller fail safe (decline) rather than authorize against an old snapshot.

use crate::{mul_div_floor, Shares, Usdc};

/// A point-in-time view of the vault, refreshed from chain on an interval (later increment).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NavSnapshot {
    /// `adapter.totalAssets() + usdc.balanceOf(vault)` — the vault's total USDC backing.
    pub total_assets: Usdc,
    /// `vault.totalShares()`.
    pub total_shares: Shares,
    /// The vault's symmetric virtual offset (`VIRTUAL`, = 1e3). Added to BOTH sides of the ratio.
    pub virtual_offset: u128,
    /// `vault.idleBuffer()` — USDC withdrawable right now (the global settlement-liquidity gate).
    pub idle_buffer: Usdc,
    /// Unix seconds when this snapshot was read from chain.
    pub observed_at_secs: u64,
}

impl NavSnapshot {
    /// USDC redeemable for `shares` at this NAV — `shares · (ta + V) / (ts + V)`, rounded DOWN.
    /// Identical to the vault's `convertToAssets`, so the edge never over-credits a user.
    pub fn equity(&self, shares: Shares) -> Usdc {
        mul_div_floor(
            shares,
            self.total_assets.saturating_add(self.virtual_offset),
            self.total_shares.saturating_add(self.virtual_offset),
        )
    }

    /// True if the snapshot is no older than `max_age_secs` at `now_secs`. A monotonic-clock skew
    /// (now < observed) is treated as fresh (age 0) rather than panicking.
    pub fn is_fresh(&self, now_secs: u64, max_age_secs: u64) -> bool {
        now_secs.saturating_sub(self.observed_at_secs) <= max_age_secs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nav(total_assets: Usdc, total_shares: Shares) -> NavSnapshot {
        NavSnapshot { total_assets, total_shares, virtual_offset: 1_000, idle_buffer: total_assets, observed_at_secs: 1_000 }
    }

    #[test]
    fn equity_at_genesis_parity_is_one_to_one_minus_offset_dust() {
        // Fresh vault, one depositor of $1,000 → shares ~= assets; equity round-trips within dust.
        let n = nav(1_000_000_000, 1_000_000_000);
        let e = n.equity(1_000_000_000);
        assert!(e <= 1_000_000_000, "equity must never exceed contributed (round down)");
        assert!(1_000_000_000 - e <= 2, "round-trip lost more than dust");
    }

    #[test]
    fn equity_rises_with_yield() {
        // Same shares, more assets (Aave interest) → more equity. Price-free NAV only goes up.
        let before = nav(1_000_000_000, 1_000_000_000).equity(500_000_000);
        let after = nav(1_100_000_000, 1_000_000_000).equity(500_000_000);
        assert!(after > before, "equity should rise as total_assets grows");
    }

    #[test]
    fn equity_rounds_down_never_over_credits() {
        // 1 share of a pool where ta/ts is fractional must floor.
        let n = nav(3, 2); // (3+1000)/(2+1000) < 1.001
        assert_eq!(n.equity(1), mul_div_floor(1, 1003, 1002));
    }

    #[test]
    fn freshness_guard() {
        let n = nav(1, 1);
        assert!(n.is_fresh(1_000, 30)); // exactly observed
        assert!(n.is_fresh(1_030, 30)); // at the boundary
        assert!(!n.is_fresh(1_031, 30)); // one second stale
        assert!(n.is_fresh(900, 30)); // clock skew (now < observed) treated as fresh
    }
}
