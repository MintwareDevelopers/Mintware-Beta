//! YPN edge-auth engine — the head of the off-chain payment pipeline.
//!
//! Answers a card authorization in sub-150ms off a *cached* vault NAV, without touching the chain in
//! the hot path. This crate is increment 1: the **authorization decision core** — pure risk logic that
//! decides APPROVE/DECLINE and sizes a hold. HTTP (axum), Redis-backed holds, on-chain NAV refresh, and
//! the EDGE_SIGNER are later increments (see `docs/developers/ypn-edge-auth-spec.md`).
//!
//! The core never moves funds; it only reserves spending capacity (a hold). Settlement is the live
//! on-chain `MintwarePaymentGateway`, driven later by the relayer.

pub mod chain;
pub mod ledger;
pub mod nav;
pub mod refresher;
pub mod server;
pub mod store;
pub mod types;

pub use ledger::{authorize, available, Account, Decision, Decline, Global};
pub use nav::NavSnapshot;
pub use store::{AuthOutcome, Hold, HoldStatus, MemStore};

/// USDC amount, 6 decimals (matches the on-chain settlement asset).
pub type Usdc = u128;
/// Vault share amount.
pub type Shares = u128;

/// `a * b / c`, rounding DOWN, without overflowing on the intermediate product.
///
/// Mirrors the vault's `mulDiv(..., Rounding.Floor)`. Realistic values (shares/assets ≤ ~1e15) fit in
/// a single `u128` product, but we fall back to a reduced-remainder computation if `a * b` would
/// overflow — so the core is correct for any input, never panicking.
pub(crate) fn mul_div_floor(a: u128, b: u128, c: u128) -> u128 {
    // c is always `total_shares + virtual_offset` (>= 1e3) in real use, so it is never 0; guard
    // defensively anyway — a payment path must never panic, so degrade to 0 rather than divide by zero.
    if c == 0 {
        return 0;
    }
    match a.checked_mul(b) {
        Some(p) => p / c,
        None => {
            // a*b/c  =  (a/c)*b + ((a%c)*b)/c, recursing only on the remainder term (a%c < c).
            let hi = (a / c).saturating_mul(b);
            let lo = mul_div_floor(a % c, b, c);
            hi.saturating_add(lo)
        }
    }
}

#[cfg(test)]
mod mul_div_tests {
    use super::mul_div_floor;

    #[test]
    fn basic_floor() {
        assert_eq!(mul_div_floor(10, 3, 4), 7); // 30/4 = 7.5 -> 7
        assert_eq!(mul_div_floor(0, 5, 7), 0);
        assert_eq!(mul_div_floor(1_000_000, 1, 1), 1_000_000);
    }

    #[test]
    fn no_overflow_on_huge_product() {
        // a*b overflows u128 (both ~1.8e38); the reduced path must still give a*b/c exactly.
        let a = u128::MAX / 2;
        let b = 4u128;
        let c = 8u128;
        // (MAX/2 * 4) / 8 == MAX/2 / 2 == MAX/4
        assert_eq!(mul_div_floor(a, b, c), a / 2);
    }

    #[test]
    fn div_by_zero_is_zero_not_panic() {
        assert_eq!(mul_div_floor(5, 5, 0), 0);
    }
}
