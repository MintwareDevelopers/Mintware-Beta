//! Cached vault NAV — the O(1) read the hot path values a user's equity against.
//!
//! Single-asset USDC vaults are **price-free**: equity is `convertToAssets(shares)` (the vault's own
//! virtual-offset math, round DOWN) with no oracle in the money path. The `VaultCollateral` seam lets
//! a non-stable vault (ETH/WETH/LST) apply a push price + LTV haircut — but that arm is **dark** until
//! the multi-collateral risk work lands (see the spec). USDC stays the exact price-free identity, so
//! turning the seam on for USDC changes nothing.

use crate::{mul_div_floor, Shares, Usdc};

const WAD: u128 = 1_000_000_000_000_000_000; // 1e18 — asset-native scale for ETH-like collateral
const BPS: u128 = 10_000;

/// What a vault holds behind its shares — decides how shares convert to *spendable USD*.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultCollateral {
    /// Price-free stablecoin: γ = 1, P = $1. The ONLY variant enabled in production.
    Usdc,
    /// SEAM ONLY — dark until multi-collateral ships (oracle + staleness, settlement ETH→USDC swap,
    /// γ VaR-modeled to cover intra-hold drawdown + settlement slippage). Carries its own push price
    /// (USD, 6dp), LTV haircut (bps), and the price's own observation time for a staleness guard.
    Eth { price_usd_6dp: u128, haircut_bps: u16, price_observed_at_secs: u64 },
}

impl VaultCollateral {
    /// Build the ETH variant with a MODEL-derived haircut (`crate::haircut::var_haircut_bps`) rather than
    /// a magic constant — the risk gate `nav.rs` refers to. `price_usd_6dp` + `price_observed_at_secs`
    /// come from the oracle push; `params` are the VaR inputs (config). This is how the reader/refresher
    /// turns a fetched ETH/USD price into a staleness-guarded, VaR-haircut collateral snapshot.
    pub fn eth_from_model(
        price_usd_6dp: u128,
        price_observed_at_secs: u64,
        params: crate::haircut::HaircutParams,
    ) -> Self {
        VaultCollateral::Eth {
            price_usd_6dp,
            haircut_bps: crate::haircut::var_haircut_bps(params),
            price_observed_at_secs,
        }
    }
}

/// A point-in-time view of the vault, refreshed from chain on an interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NavSnapshot {
    /// `adapter.totalAssets() + usdc.balanceOf(vault)` — the vault's total backing (asset-native units).
    pub total_assets: Usdc,
    /// `vault.totalShares()`.
    pub total_shares: Shares,
    /// The vault's symmetric virtual offset (`VIRTUAL`, = 1e3). Added to BOTH sides of the ratio.
    pub virtual_offset: u128,
    /// `vault.idleBuffer()` — USDC withdrawable right now (the global settlement-liquidity gate).
    pub idle_buffer: Usdc,
    /// Unix seconds when this snapshot was read from chain.
    pub observed_at_secs: u64,
    /// What backs the shares (drives share→USD conversion). Defaults to the price-free USDC identity.
    pub collateral: VaultCollateral,
}

impl NavSnapshot {
    /// Raw vault asset amount for `shares` (asset-native units) — `shares·(ta+V)/(ts+V)`, round DOWN.
    /// Identical to the vault's `convertToAssets`.
    pub fn asset_amount(&self, shares: Shares) -> u128 {
        mul_div_floor(
            shares,
            self.total_assets.saturating_add(self.virtual_offset),
            self.total_shares.saturating_add(self.virtual_offset),
        )
    }

    /// SPENDABLE USD (6dp) for `shares`, collateral-aware — the number authorizations are sized against.
    /// USDC = identity (price-free). ETH applies push price + haircut, overflow-safe, rounding DOWN so
    /// the edge never over-credits.
    pub fn equity(&self, shares: Shares) -> Usdc {
        let base = self.asset_amount(shares);
        match self.collateral {
            VaultCollateral::Usdc => base, // already USD (6dp), γ=1
            VaultCollateral::Eth { price_usd_6dp, haircut_bps, .. } => {
                // base is ETH-native (1e18). base(1e18) * P(6dp) / 1e18 => USD(6dp); then apply γ.
                let gross_usd = mul_div_floor(base, price_usd_6dp, WAD);
                mul_div_floor(gross_usd, haircut_bps as u128, BPS)
            }
        }
    }

    /// True if the snapshot is no older than `max_age_secs`. Clock skew (now < observed) → fresh.
    pub fn is_fresh(&self, now_secs: u64, max_age_secs: u64) -> bool {
        now_secs.saturating_sub(self.observed_at_secs) <= max_age_secs
    }

    /// For ETH collateral, whether the push PRICE is fresh (its own staleness guard). Always true for
    /// USDC — there is no price to go stale.
    pub fn price_is_fresh(&self, now_secs: u64, max_price_age_secs: u64) -> bool {
        match self.collateral {
            VaultCollateral::Usdc => true,
            VaultCollateral::Eth { price_observed_at_secs, .. } => {
                now_secs.saturating_sub(price_observed_at_secs) <= max_price_age_secs
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usdc_nav(total_assets: Usdc, total_shares: Shares) -> NavSnapshot {
        NavSnapshot {
            total_assets,
            total_shares,
            virtual_offset: 1_000,
            idle_buffer: total_assets,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Usdc,
        }
    }

    #[test]
    fn usdc_equity_is_price_free_identity() {
        let n = usdc_nav(1_000_000_000, 1_000_000_000);
        let e = n.equity(1_000_000_000);
        assert_eq!(e, n.asset_amount(1_000_000_000)); // identity — γ=1, P=1
        assert!(e <= 1_000_000_000 && 1_000_000_000 - e <= 2);
    }

    #[test]
    fn usdc_equity_rises_with_yield() {
        let before = usdc_nav(1_000_000_000, 1_000_000_000).equity(500_000_000);
        let after = usdc_nav(1_100_000_000, 1_000_000_000).equity(500_000_000);
        assert!(after > before);
    }

    #[test]
    fn eth_from_model_flows_var_haircut_into_equity() {
        // The MODEL haircut (~73.68% for the ETH defaults) — not a magic constant — reaches `equity`.
        let two_eth = 2_000_000_000_000_000_000u128; // 2e18
        let collateral =
            VaultCollateral::eth_from_model(2_000_000_000, 1_000, crate::haircut::HaircutParams::ETH_DEFAULT);
        let VaultCollateral::Eth { haircut_bps, .. } = collateral else { panic!("expected Eth") };
        assert!((7_300..=7_450).contains(&haircut_bps), "model haircut = {haircut_bps} bps");

        let n = NavSnapshot {
            total_assets: two_eth,
            total_shares: two_eth,
            virtual_offset: 1_000,
            idle_buffer: 0,
            observed_at_secs: 1_000,
            collateral,
        };
        // gross = 2 ETH × $2,000 = $4,000 (6dp); equity = gross × γ, rounded down.
        let usd = n.equity(two_eth);
        let expected = 4_000_000_000u128 * haircut_bps as u128 / 10_000;
        assert!(usd.abs_diff(expected) <= 2, "equity {usd} vs expected {expected}");
    }

    #[test]
    fn eth_equity_applies_price_and_haircut_rounding_down() {
        // 2 ETH of shares (1:1 vault, 18dp), ETH=$2,000 (6dp), γ=0.70 → 2 * 2000 * 0.70 = $2,800.
        let two_eth = 2_000_000_000_000_000_000u128; // 2e18
        let n = NavSnapshot {
            total_assets: two_eth,
            total_shares: two_eth,
            virtual_offset: 1_000,
            idle_buffer: 0,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Eth { price_usd_6dp: 2_000_000_000, haircut_bps: 7_000, price_observed_at_secs: 1_000 },
        };
        let usd = n.equity(two_eth);
        assert!((2_799_000_000..=2_800_000_000).contains(&usd), "got {usd}");
        // haircut strictly reduces vs no-haircut gross ($4,000).
        assert!(usd < 4_000_000_000);
    }

    #[test]
    fn eth_equity_no_overflow_for_a_whale() {
        // 10,000 ETH shares × $3,000 — the naive `shares * ratio` would blow past u128; must not panic.
        let ten_k_eth = 10_000u128 * WAD; // 1e22
        let n = NavSnapshot {
            total_assets: ten_k_eth,
            total_shares: ten_k_eth,
            virtual_offset: 1_000,
            idle_buffer: 0,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Eth { price_usd_6dp: 3_000_000_000, haircut_bps: 7_000, price_observed_at_secs: 1_000 },
        };
        // 10_000 * 3_000 * 0.7 = $21,000,000 → 21e12 (6dp).
        assert_eq!(n.equity(ten_k_eth), 21_000_000_000_000);
    }

    #[test]
    fn freshness_guards() {
        let n = usdc_nav(1, 1);
        assert!(n.is_fresh(1_030, 30));
        assert!(!n.is_fresh(1_031, 30));
        // USDC has no price → price_is_fresh always true.
        assert!(n.price_is_fresh(999_999, 30));
        // ETH price staleness is independent of the NAV.
        let eth = NavSnapshot { collateral: VaultCollateral::Eth { price_usd_6dp: 1, haircut_bps: 7_000, price_observed_at_secs: 1_000 }, ..n };
        assert!(eth.price_is_fresh(1_030, 30));
        assert!(!eth.price_is_fresh(1_031, 30));
    }
}
