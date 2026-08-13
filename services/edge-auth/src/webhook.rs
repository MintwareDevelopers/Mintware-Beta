//! Rain card-rail webhook ingest (increment 6). Rain notifies us of a card charge's lifecycle; we map
//! those to hold actions: a **capture** settles the hold (releases its reservation + rolls into daily
//! spend, and hands off to the relayer for on-chain `settleSpend`); a **reversal/void** releases the
//! hold. Every webhook is HMAC-SHA256-verified over the RAW body before it can touch state.
//!
//! NOTE: the exact header name + digest encoding are Rain-specific; this uses the common
//! `X-Rain-Signature: <hex(hmac_sha256(secret, raw_body))>` scheme — adjust to Rain's actual contract
//! at integration. The verification + mapping logic is what matters and is what's tested here.

use axum::http::StatusCode;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::store::MemStore;

pub const SIGNATURE_HEADER: &str = "x-rain-signature";

/// Constant-time verify of `hex(hmac_sha256(secret, body))` against the provided hex signature.
pub fn verify_signature(secret: &[u8], body: &[u8], provided_hex: &str) -> bool {
    let provided = match hex_decode(provided_hex.trim().trim_start_matches("0x")) {
        Some(b) => b,
        None => return false,
    };
    let mut mac = match Hmac::<Sha256>::new_from_slice(secret) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    mac.verify_slice(&provided).is_ok() // constant-time
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

/// The subset of a Rain webhook we act on. Unknown `event_type`s are acknowledged as no-ops.
#[derive(Debug, Clone, Deserialize)]
pub struct RainEvent {
    pub event_type: String,
    pub hold_id: String,
}

/// What a Rain event maps to on our side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Charge captured → settle the hold (and enqueue on-chain settlement).
    Settle,
    /// Charge reversed/voided/expired → release the hold.
    Release,
    /// Anything else → acknowledge, do nothing.
    Ignore,
}

/// Map a Rain event type to an action. Kept pure + table-driven for easy review.
pub fn action_for(event_type: &str) -> Action {
    match event_type.to_ascii_lowercase().as_str() {
        "capture" | "charge.captured" | "settlement" => Action::Settle,
        "reversal" | "void" | "auth.reversed" | "refund" | "expired" => Action::Release,
        _ => Action::Ignore,
    }
}

/// Verify + apply a Rain webhook, returning the HTTP status + JSON body. Pure over its inputs (the
/// axum route in `server.rs` just extracts the header/body and calls this), so it is fully unit-tested.
pub fn process(secret: Option<&[u8]>, store: &MemStore, sig: &str, body: &[u8], now_secs: u64) -> (StatusCode, Value) {
    let secret = match secret {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "webhooks_disabled" })),
    };
    if !verify_signature(secret, body, sig) {
        return (StatusCode::UNAUTHORIZED, json!({ "error": "bad_signature" }));
    }
    let event: RainEvent = match serde_json::from_slice(body) {
        Ok(e) => e,
        Err(_) => return (StatusCode::BAD_REQUEST, json!({ "error": "bad_payload" })),
    };

    let action = action_for(&event.event_type);
    let applied = match action {
        // TODO(6b): on Settle, also enqueue the relayer's on-chain settleSpend for this hold.
        Action::Settle => store.settle(&event.hold_id, now_secs),
        Action::Release => store.cancel(&event.hold_id),
        Action::Ignore => false,
    };
    (StatusCode::OK, json!({ "ok": true, "action": action_str(action), "applied": applied }))
}

fn action_str(a: Action) -> &'static str {
    match a {
        Action::Settle => "settle",
        Action::Release => "release",
        Action::Ignore => "ignore",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &[u8], body: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        mac.update(body);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn signature_roundtrips_and_rejects_tampering() {
        let secret = b"rain-secret";
        let body = br#"{"event_type":"capture","hold_id":"h1"}"#;
        let sig = sign(secret, body);
        assert!(verify_signature(secret, body, &sig));
        assert!(verify_signature(secret, body, &format!("0x{sig}"))); // 0x-prefix tolerated
        // wrong secret, tampered body, and garbage sig all fail.
        assert!(!verify_signature(b"wrong", body, &sig));
        assert!(!verify_signature(secret, br#"{"event_type":"capture","hold_id":"h2"}"#, &sig));
        assert!(!verify_signature(secret, body, "notahexsignature"));
        assert!(!verify_signature(secret, body, ""));
    }

    #[test]
    fn event_mapping_is_correct() {
        assert_eq!(action_for("capture"), Action::Settle);
        assert_eq!(action_for("Charge.Captured"), Action::Settle);
        assert_eq!(action_for("reversal"), Action::Release);
        assert_eq!(action_for("REFUND"), Action::Release);
        assert_eq!(action_for("auth.created"), Action::Ignore);
    }

    use crate::nav::{NavSnapshot, VaultCollateral};
    use crate::store::{HoldStatus, MemStore};

    fn store_with_hold(hold_id: &str) -> MemStore {
        let nav = NavSnapshot { total_assets: 10_000_000_000, total_shares: 10_000_000_000, virtual_offset: 1_000, idle_buffer: 10_000_000_000, observed_at_secs: 0, collateral: VaultCollateral::Usdc };
        let s = MemStore::new(nav, u64::MAX, 600);
        s.set_shares("alice", 1_000_000_000);
        s.set_daily_cap("alice", 100_000_000_000);
        s.try_authorize(hold_id, "alice", 100_000_000, 1000);
        s
    }

    #[test]
    fn capture_settles_the_hold() {
        let secret = b"sek";
        let s = store_with_hold("h1");
        let body = br#"{"event_type":"capture","hold_id":"h1"}"#;
        let (code, v) = process(Some(secret), &s, &sign(secret, body), body, 1000);
        assert_eq!(code, StatusCode::OK);
        assert_eq!(v["action"], "settle");
        assert_eq!(v["applied"], true);
        assert_eq!(s.get_hold("h1").unwrap().status, HoldStatus::Settled);
    }

    #[test]
    fn reversal_releases_the_hold() {
        let secret = b"sek";
        let s = store_with_hold("h2");
        let body = br#"{"event_type":"reversal","hold_id":"h2"}"#;
        let (code, v) = process(Some(secret), &s, &sign(secret, body), body, 1000);
        assert_eq!(code, StatusCode::OK);
        assert_eq!(v["action"], "release");
        assert_eq!(s.get_hold("h2").unwrap().status, HoldStatus::Cancelled);
    }

    #[test]
    fn bad_signature_is_rejected_and_state_untouched() {
        let s = store_with_hold("h3");
        let body = br#"{"event_type":"capture","hold_id":"h3"}"#;
        let (code, _) = process(Some(b"sek"), &s, "deadbeef", body, 1000);
        assert_eq!(code, StatusCode::UNAUTHORIZED);
        assert_eq!(s.get_hold("h3").unwrap().status, HoldStatus::Active); // unchanged
    }

    #[test]
    fn unknown_event_is_acked_no_op() {
        let secret = b"sek";
        let s = store_with_hold("h4");
        let body = br#"{"event_type":"auth.created","hold_id":"h4"}"#;
        let (code, v) = process(Some(secret), &s, &sign(secret, body), body, 1000);
        assert_eq!(code, StatusCode::OK);
        assert_eq!(v["action"], "ignore");
        assert_eq!(s.get_hold("h4").unwrap().status, HoldStatus::Active);
    }

    #[test]
    fn disabled_when_no_secret() {
        let s = store_with_hold("h5");
        let (code, _) = process(None, &s, "x", b"{}", 1000);
        assert_eq!(code, StatusCode::SERVICE_UNAVAILABLE);
    }

    mod hex {
        pub fn encode(b: impl AsRef<[u8]>) -> String {
            b.as_ref().iter().map(|x| format!("{x:02x}")).collect()
        }
    }
}
