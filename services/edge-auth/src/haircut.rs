//! VaR-based collateral haircut (γ) for volatile-collateral vaults (multi-collateral gate).
//!
//! A card AUTH is an unbounded-duration directional short on the collateral: the USD spend limit is
//! COMMITTED at auth time, but the collateral is only converted to USDC at BATCH settlement. So the
//! haircut must survive the worst-case DRAWDOWN over the auth→settlement window PLUS the settlement
//! swap slippage — otherwise the edge over-authorizes and the protocol eats the shortfall. This is the
//! risk model `nav.rs` refers to as the gate before the ETH arm can go live; a static 70% is only a
//! magic number until it is tied to a hold-duration policy + a volatility assumption.
//!
//! Model: `γ = 1 − (z·σ·√T + slippage)`, clamped to `[0, 1]`.
//!   - `σ` annualized volatility of the collateral, `T` the max hold in years, `z` the one-sided
//!     confidence z-score (Gaussian drawdown approximation), `slippage` the batch-swap buffer.
//! Computed OFF the hot path (at vault config / refresh time) — so f64 is fine here; the result is
//! stored as `haircut_bps: u16` and the per-authorization money math stays integer/`U256` (see
//! `nav.rs::equity`). Rounds DOWN (more haircut) so it never over-credits.

/// Inputs to the VaR haircut. All four are CONFIG — risk can retune without a code change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HaircutParams {
    /// Annualized volatility of the collateral, in bps (e.g. `8_000` = 80%).
    pub vol_annual_bps: u32,
    /// Max card-hold duration the haircut must survive, in seconds (the auth→settlement window —
    /// e.g. `604_800` = 7 days). Longer holds ⇒ larger drawdown ⇒ tighter γ.
    pub max_hold_secs: u64,
    /// One-sided confidence z-score × 1000 (e.g. `2_330` = 2.33 ≈ 99% one-sided).
    pub z_score_milli: u32,
    /// Settlement slippage buffer for the batch ETH→USDC swap, in bps (e.g. `50` = 0.5%).
    pub settlement_slippage_bps: u32,
}

impl HaircutParams {
    /// Defensible defaults for ETH collateral: 80% vol, 7-day max hold, 99% one-sided, 0.5% slippage.
    /// These compute to γ ≈ 0.737 — i.e. they roughly VALIDATE the legacy static 70%, but now the number
    /// is principled + tunable (a 30-day hold policy would tighten γ to ~0.46).
    pub const ETH_DEFAULT: HaircutParams = HaircutParams {
        vol_annual_bps: 8_000,
        max_hold_secs: 604_800, // 7 days
        z_score_milli: 2_330,
        settlement_slippage_bps: 50,
    };
}

const SECS_PER_YEAR: f64 = 365.0 * 24.0 * 3600.0;
const MAX_BPS: u16 = 10_000;

/// The safe loan-to-value haircut γ in bps (`0..=10_000`) = `1 − (z·σ·√T + slippage)`, floored at 0 and
/// capped at 100% LTV. Monotone: γ decreases as vol, hold-duration, confidence, or slippage rise.
pub fn var_haircut_bps(p: HaircutParams) -> u16 {
    let z = p.z_score_milli as f64 / 1_000.0;
    let sigma = p.vol_annual_bps as f64 / 10_000.0;
    let t_years = p.max_hold_secs as f64 / SECS_PER_YEAR;
    let drawdown = z * sigma * t_years.sqrt();
    let slippage = p.settlement_slippage_bps as f64 / 10_000.0;

    let gamma = 1.0 - (drawdown + slippage);
    if gamma <= 0.0 {
        return 0; // risk exceeds the collateral over the window → lend nothing (fail safe)
    }
    let bps = (gamma * 10_000.0).floor(); // round DOWN → never over-credit
    if bps >= MAX_BPS as f64 { MAX_BPS } else { bps as u16 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_validates_the_legacy_70pct() {
        // The old magic 70% is ≈ a 7-day / 99% / 80%-vol VaR — now principled.
        let g = var_haircut_bps(HaircutParams::ETH_DEFAULT);
        assert!((7_300..=7_450).contains(&g), "default γ = {g} bps, expected ~7368");
    }

    #[test]
    fn tighter_for_longer_holds() {
        let short = var_haircut_bps(HaircutParams { max_hold_secs: 86_400, ..HaircutParams::ETH_DEFAULT }); // 1d
        let long = var_haircut_bps(HaircutParams { max_hold_secs: 2_592_000, ..HaircutParams::ETH_DEFAULT }); // 30d
        assert!(long < short, "30d γ ({long}) must be tighter than 1d γ ({short})");
        assert!(long < 6_000, "a 30-day hold should force a materially tighter haircut, got {long}");
    }

    #[test]
    fn tighter_for_higher_vol_and_confidence() {
        let base = var_haircut_bps(HaircutParams::ETH_DEFAULT);
        let hi_vol = var_haircut_bps(HaircutParams { vol_annual_bps: 12_000, ..HaircutParams::ETH_DEFAULT });
        let hi_conf = var_haircut_bps(HaircutParams { z_score_milli: 3_090, ..HaircutParams::ETH_DEFAULT }); // 99.9%
        assert!(hi_vol < base, "higher vol must tighten γ");
        assert!(hi_conf < base, "higher confidence must tighten γ");
    }

    #[test]
    fn clamps_to_zero_when_risk_exceeds_collateral() {
        // Absurd vol + long hold → drawdown > 100% → γ floors at 0, never negative/underflow.
        let g = var_haircut_bps(HaircutParams {
            vol_annual_bps: 30_000, max_hold_secs: 31_536_000, z_score_milli: 3_000, settlement_slippage_bps: 100,
        });
        assert_eq!(g, 0);
    }

    #[test]
    fn caps_at_100pct_ltv_for_zero_risk() {
        let g = var_haircut_bps(HaircutParams {
            vol_annual_bps: 0, max_hold_secs: 0, z_score_milli: 0, settlement_slippage_bps: 0,
        });
        assert_eq!(g, MAX_BPS); // never lend MORE than the collateral
    }

    #[test]
    fn monotone_non_increasing_in_hold_duration() {
        let mut prev = MAX_BPS;
        for days in [0u64, 1, 3, 7, 14, 30, 90] {
            let g = var_haircut_bps(HaircutParams { max_hold_secs: days * 86_400, ..HaircutParams::ETH_DEFAULT });
            assert!(g <= prev, "γ rose at {days}d: {g} > {prev}");
            prev = g;
        }
    }
}
