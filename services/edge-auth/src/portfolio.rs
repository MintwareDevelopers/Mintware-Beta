//! Multi-collateral portfolio aggregation — a user's card limit summed across their vault positions.
//!
//! The single-vault `ledger::authorize` values ONE position. A treasury/LP may hold several vaults at
//! once (USDC + ETH + LSTs); their spendable limit is the SUM of the per-position equities. This module
//! is exactly the brief's `NAV_spendable = Σ_i (Shares_i · Ratio_i · P_i · γ_i) − holds`, where each
//! leg's `nav.equity(shares)` already IS `Shares · Ratio · (P·γ)` (collateral-aware, overflow-safe,
//! round-DOWN — `nav.rs`). USDC legs stay the price-free identity; ETH legs apply price × VaR-haircut.
//!
//! Two safety rules that make aggregation sound:
//!   1. **All legs fresh or fail safe.** A single stale NAV or stale ETH price makes the WHOLE basket
//!      unvaluable → decline (you must not authorize against a leg you can't price right now).
//!   2. **Strict generalization.** A one-leg portfolio is IDENTICAL to `ledger::authorize` on that vault
//!      (proven by test), so this is purely additive — nothing about the single-vault path changes.

use crate::ledger::{Account, Decision, Decline};
use crate::nav::NavSnapshot;
use crate::{Shares, Usdc};

/// One leg of a user's portfolio: their stake in a single vault, plus that vault's total active holds
/// (for the per-leg settlement-liquidity gate — each vault can only settle up to its own idle buffer).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Leg {
    pub nav: NavSnapshot,
    pub shares: Shares,
    /// ALL users' active holds in THIS vault (the leg's liquidity is `idle_buffer − this`).
    pub vault_global_holds_usdc: Usdc,
}

impl Leg {
    fn equity(&self) -> Usdc {
        self.nav.equity(self.shares)
    }
    /// USDC this leg can actually settle right now: its vault's idle buffer (collateral-valued — USDC
    /// identity, ETH = idle WETH × price × γ the settlement swap can realize) net of that vault's holds.
    fn settleable(&self) -> Usdc {
        self.nav.settleable_usd().saturating_sub(self.vault_global_holds_usdc)
    }
}

/// The aggregate SPENDABLE across all legs = tightest of {Σ equity − holds, daily-cap room, Σ settleable}.
/// Assumes the legs are fresh (freshness is enforced in `authorize_portfolio`). `acct.shares` is IGNORED
/// here — per-leg shares live on each `Leg`; the account supplies only the user-level holds + daily cap.
pub fn portfolio_available(legs: &[Leg], acct: &Account) -> Usdc {
    let gross_equity = legs.iter().fold(0u128, |a, l| a.saturating_add(l.equity()));
    let liquidity = legs.iter().fold(0u128, |a, l| a.saturating_add(l.settleable()));

    let per_user = gross_equity.saturating_sub(acct.active_holds_usdc);
    let cap_room = acct
        .daily_cap_usdc
        .saturating_sub(acct.daily_spent_usdc.saturating_add(acct.active_holds_usdc));
    per_user.min(cap_room).min(liquidity)
}

/// Decide APPROVE/DECLINE for a charge of `amount` against the whole portfolio. Same priority order +
/// decline reasons as `ledger::authorize`, generalized over legs: freshness (ALL legs), non-zero amount,
/// aggregate equity net of holds, daily cap, aggregate settlement liquidity.
pub fn authorize_portfolio(
    legs: &[Leg],
    acct: &Account,
    amount: Usdc,
    now_secs: u64,
    max_nav_age_secs: u64,
) -> Decision {
    // Rule 1: a single stale/unvaluable leg fails the whole basket safe. NAV staleness before price
    // staleness, matching the single-vault priority order.
    for l in legs {
        if !l.nav.is_fresh(now_secs, max_nav_age_secs) {
            return Decision::Decline(Decline::StaleNav);
        }
        if !l.nav.price_is_fresh(now_secs, max_nav_age_secs) {
            return Decision::Decline(Decline::StalePrice);
        }
    }
    if amount == 0 {
        return Decision::Decline(Decline::ZeroAmount);
    }
    let gross_equity = legs.iter().fold(0u128, |a, l| a.saturating_add(l.equity()));
    if amount > gross_equity.saturating_sub(acct.active_holds_usdc) {
        return Decision::Decline(Decline::InsufficientEquity);
    }
    if amount
        > acct
            .daily_cap_usdc
            .saturating_sub(acct.daily_spent_usdc.saturating_add(acct.active_holds_usdc))
    {
        return Decision::Decline(Decline::DailyCapExceeded);
    }
    let liquidity = legs.iter().fold(0u128, |a, l| a.saturating_add(l.settleable()));
    if amount > liquidity {
        return Decision::Decline(Decline::InsufficientLiquidity);
    }
    Decision::Approve { hold_usdc: amount }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::{authorize, Global};
    use crate::nav::VaultCollateral;

    const NOW: u64 = 1_010;
    const MAX_AGE: u64 = 30;

    fn usdc_nav(total_assets: Usdc, idle: Usdc) -> NavSnapshot {
        NavSnapshot {
            total_assets,
            total_shares: total_assets, // 1:1 vault
            virtual_offset: 1_000,
            idle_buffer: idle,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Usdc,
        }
    }

    fn eth_nav(total_eth_assets: Usdc, idle_usdc: Usdc, price_6dp: u128, price_age_ok: bool) -> NavSnapshot {
        NavSnapshot {
            total_assets: total_eth_assets,
            total_shares: total_eth_assets, // 1:1 (18dp) shares↔ETH
            virtual_offset: 1_000,
            idle_buffer: idle_usdc,
            observed_at_secs: 1_000,
            collateral: VaultCollateral::Eth {
                price_usd_6dp: price_6dp,
                haircut_bps: 7_000,
                price_observed_at_secs: if price_age_ok { 1_000 } else { 700 }, // 700 → age 310 > 30 = stale
            },
        }
    }

    fn acct(holds: Usdc, spent: Usdc, cap: Usdc) -> Account {
        Account { shares: 0, active_holds_usdc: holds, daily_spent_usdc: spent, daily_cap_usdc: cap }
    }

    #[test]
    fn single_leg_is_identical_to_single_vault_authorize() {
        // Strict generalization: one USDC leg must decide EXACTLY like ledger::authorize on that vault.
        let nav = usdc_nav(10_000_000_000, 10_000_000_000);
        let shares = 4_000_000_000u128;
        let a = Account { shares, active_holds_usdc: 100_000_000, daily_spent_usdc: 0, daily_cap_usdc: u128::MAX };
        let g = Global { total_active_holds_usdc: 100_000_000 };
        let leg = Leg { nav, shares, vault_global_holds_usdc: g.total_active_holds_usdc };

        for amount in [1u128, 500_000_000, 3_899_000_000, 3_900_000_001, 9_000_000_000] {
            assert_eq!(
                authorize_portfolio(std::slice::from_ref(&leg), &a, amount, NOW, MAX_AGE),
                authorize(&nav, &a, &g, amount, NOW, MAX_AGE),
                "portfolio diverged from single-vault at amount {amount}"
            );
        }
    }

    #[test]
    fn sums_equity_across_usdc_and_eth_legs() {
        // USDC leg: 2,000 shares of a 1:1 vault → $2,000. ETH leg: 1 ETH @ $3,000 × 0.70 = $2,100.
        let usdc = Leg {
            nav: usdc_nav(1_000_000_000_000, 1_000_000_000_000),
            shares: 2_000_000_000, // $2,000 (6dp)
            vault_global_holds_usdc: 0,
        };
        let eth = Leg {
            nav: eth_nav(1_000_000_000_000_000_000_000, 1_000_000_000_000, 3_000_000_000, true), // deep ETH vault
            shares: 1_000_000_000_000_000_000, // 1 ETH
            vault_global_holds_usdc: 0,
        };
        let legs = [usdc, eth];
        let a = acct(0, 0, u128::MAX);

        // aggregate equity ≈ $2,000 + $2,100 = $4,100.
        assert_eq!(portfolio_available(&legs, &a), 4_100_000_000);
        // a charge inside the sum approves; just over declines InsufficientEquity.
        assert_eq!(authorize_portfolio(&legs, &a, 4_100_000_000, NOW, MAX_AGE), Decision::Approve { hold_usdc: 4_100_000_000 });
        assert_eq!(authorize_portfolio(&legs, &a, 4_100_000_001, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientEquity));
        // neither single leg alone could cover $2,100+$2,000 — the SUM is what unlocks it.
        assert_eq!(authorize_portfolio(std::slice::from_ref(&legs[0]), &a, 2_100_000_000, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientEquity));
    }

    #[test]
    fn any_stale_leg_fails_the_whole_portfolio_safe() {
        let good_usdc = Leg { nav: usdc_nav(1_000_000_000_000, 1_000_000_000_000), shares: 2_000_000_000, vault_global_holds_usdc: 0 };
        // ETH leg with a STALE push price (fresh NAV) → StalePrice, even though the USDC leg is fine.
        let stale_eth = Leg {
            nav: eth_nav(1_000_000_000_000_000_000_000, 1_000_000_000_000, 3_000_000_000, false),
            shares: 1_000_000_000_000_000_000,
            vault_global_holds_usdc: 0,
        };
        let a = acct(0, 0, u128::MAX);
        assert_eq!(authorize_portfolio(&[good_usdc, stale_eth], &a, 1_000_000, NOW, MAX_AGE), Decision::Decline(Decline::StalePrice));
    }

    #[test]
    fn aggregate_settlement_liquidity_bounds_the_charge() {
        // Both legs value-rich but each thin on idle → the SUMMED settleable is the binding gate.
        let l0 = Leg { nav: usdc_nav(1_000_000_000_000, 300_000_000), shares: 900_000_000_000, vault_global_holds_usdc: 0 };
        let l1 = Leg { nav: usdc_nav(1_000_000_000_000, 200_000_000), shares: 900_000_000_000, vault_global_holds_usdc: 0 };
        let a = acct(0, 0, u128::MAX);
        // equity is huge, but liquidity = 300 + 200 = $500. $500 approves, $501 declines InsufficientLiquidity.
        assert_eq!(authorize_portfolio(&[l0, l1], &a, 500_000_000, NOW, MAX_AGE), Decision::Approve { hold_usdc: 500_000_000 });
        assert_eq!(authorize_portfolio(&[l0, l1], &a, 500_000_001, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientLiquidity));
    }

    #[test]
    fn eth_leg_settleable_is_haircut_converted_not_raw_weth() {
        // ETH leg with 1 ETH idle (1e18 WETH-native) + ample equity so LIQUIDITY is the binding gate.
        // Correct settleable = 1 ETH × $3,000 × γ0.70 = $2,100 — NOT the raw 1e18 mis-read as $1e12 USDC.
        let one_eth = 1_000_000_000_000_000_000u128;
        let eth = Leg {
            nav: eth_nav(1_000_000_000_000_000_000_000, one_eth, 3_000_000_000, true), // idle = 1 ETH
            shares: 1_000_000_000_000_000_000_000, // 1,000 ETH shares → ~$2.1M equity (never the gate)
            vault_global_holds_usdc: 0,
        };
        let a = acct(0, 0, u128::MAX);
        let legs = [eth];
        // $2,100 approves; $2,100.000001 declines on the converted settlement liquidity.
        assert_eq!(authorize_portfolio(&legs, &a, 2_100_000_000, NOW, MAX_AGE), Decision::Approve { hold_usdc: 2_100_000_000 });
        assert_eq!(authorize_portfolio(&legs, &a, 2_100_000_001, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientLiquidity));
        // The raw-WETH bug would have (wrongly) approved a $1,000,000 charge — prove it now DECLINES.
        assert_eq!(authorize_portfolio(&legs, &a, 1_000_000_000_000, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientLiquidity));
    }

    #[test]
    fn empty_portfolio_has_zero_equity() {
        let a = acct(0, 0, u128::MAX);
        assert_eq!(portfolio_available(&[], &a), 0);
        assert_eq!(authorize_portfolio(&[], &a, 1, NOW, MAX_AGE), Decision::Decline(Decline::InsufficientEquity));
    }
}
