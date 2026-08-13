//! The axum HTTP surface over the hold store + optional EDGE_SIGNER. Thin glue: parse →
//! `store.try_authorize` → (for >= $250) sign an edge auth → JSON. A decline is a normal business
//! outcome (HTTP 200 with `approved:false`); only malformed input is 400.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use alloy_primitives::{hex, keccak256, Address};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::signer::{EdgeSigner, DEFAULT_EDGE_WINDOW_SECS, HIGH_VALUE_THRESHOLD};
use crate::store::{Hold, HoldStatus, MemStore};
use crate::types::{AuthorizeRequest, AuthorizeResponse, EdgeAuthView, HoldView};

/// Shared handler state: the hold store plus (optionally) the edge signer for high-value charges.
#[derive(Clone)]
pub struct AppCtx {
    pub store: Arc<MemStore>,
    pub edge: Option<Arc<EdgeSigner>>,
}

/// Wall-clock seconds. Isolated so the hot path has a single time source.
fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn app(ctx: AppCtx) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/authorize", post(authorize))
        .route("/holds/:id", get(get_hold))
        .with_state(ctx)
}

async fn health() -> &'static str {
    "ok"
}

fn declined(reason: &'static str) -> AuthorizeResponse {
    AuthorizeResponse { approved: false, hold_id: None, hold_usdc: None, decline_reason: Some(reason), edge_auth: None }
}

async fn authorize(State(ctx): State<AppCtx>, Json(req): Json<AuthorizeRequest>) -> impl IntoResponse {
    let amount = match req.amount_usdc.parse::<u128>() {
        Ok(a) => a,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_amount" }))).into_response(),
    };
    let now = now_secs();
    // Canonicalize the user key to lowercase 0x-hex so it matches what the refresher writes (addr_key).
    let user = req.user.trim().to_lowercase();
    let hold_id = req.hold_id.clone().unwrap_or_else(|| format!("edge:{user}:{amount}:{now}"));

    // High-value (>= $250) charges need a signed edge auth the Gateway will accept. Gate BEFORE
    // reserving so we never strand a hold we couldn't fulfil.
    let high_value = amount >= HIGH_VALUE_THRESHOLD;
    if high_value {
        if ctx.edge.is_none() {
            return (StatusCode::OK, Json(declined("edge_unavailable"))).into_response();
        }
        if user.parse::<Address>().is_err() {
            return (StatusCode::OK, Json(declined("invalid_user"))).into_response();
        }
    }

    let out = ctx.store.try_authorize(&hold_id, &user, amount, now);
    let mut resp = AuthorizeResponse::from_decision(out.decision, out.hold_id);

    if resp.approved && high_value {
        let edge = ctx.edge.as_ref().expect("gated above");
        let user_addr: Address = user.parse().expect("gated above");
        let hold_b32 = keccak256(hold_id.as_bytes()); // bytes32 the Gateway settles under
        match edge.sign(hold_b32, user_addr, amount, now, DEFAULT_EDGE_WINDOW_SECS) {
            Ok(signed) => {
                resp.edge_auth = Some(EdgeAuthView {
                    hold_id: format!("0x{}", hex::encode(signed.hold_id)),
                    user: format!("0x{}", hex::encode(signed.user)),
                    amount_usdc: signed.amount_usdc.to_string(),
                    nonce: signed.nonce.to_string(),
                    expiry: signed.expiry.to_string(),
                    signature: signed.signature_hex(),
                });
            }
            Err(e) => {
                // Signing failed AFTER reserving → release the hold and decline (don't leak capacity).
                ctx.store.cancel(&hold_id);
                eprintln!("edge-auth: sign failed, releasing hold {hold_id}: {e}");
                return (StatusCode::OK, Json(declined("edge_sign_failed"))).into_response();
            }
        }
    }

    (StatusCode::OK, Json(resp)).into_response()
}

async fn get_hold(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    match ctx.store.get_hold(&id) {
        Some(h) => (StatusCode::OK, Json(hold_view(&id, &h))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "not_found" }))).into_response(),
    }
}

fn hold_view(id: &str, h: &Hold) -> HoldView {
    HoldView {
        hold_id: id.to_string(),
        user: h.user.clone(),
        amount_usdc: h.amount_usdc.to_string(),
        status: status_str(h.status),
        created_secs: h.created_secs,
        expiry_secs: h.expiry_secs,
    }
}

pub fn status_str(s: HoldStatus) -> &'static str {
    match s {
        HoldStatus::Active => "active",
        HoldStatus::Settled => "settled",
        HoldStatus::Cancelled => "cancelled",
        HoldStatus::Expired => "expired",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::NavSnapshot;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt; // oneshot

    const GATEWAY: &str = "0x26ce3baff473b24e8afe932dfb6d68adca8048b0";
    const KEY: &str = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    // A real 20-byte address for `alice` so high-value signing can parse it.
    const ALICE: &str = "0x00000000000000000000000000000000a11ce000";

    fn base_store() -> MemStore {
        let nav = NavSnapshot { total_assets: 10_000_000_000, total_shares: 10_000_000_000, virtual_offset: 1_000, idle_buffer: 10_000_000_000, observed_at_secs: 0, collateral: crate::nav::VaultCollateral::Usdc };
        let s = MemStore::new(nav, u64::MAX, 600);
        s.set_shares(ALICE, 1_000_000_000); // $1,000 equity
        s.set_daily_cap(ALICE, 100_000_000_000);
        s
    }
    fn ctx_no_signer() -> AppCtx {
        AppCtx { store: Arc::new(base_store()), edge: None }
    }
    fn ctx_with_signer() -> AppCtx {
        AppCtx {
            store: Arc::new(base_store()),
            edge: Some(Arc::new(EdgeSigner::from_hex_key(KEY, GATEWAY.parse().unwrap(), 84532).unwrap())),
        }
    }

    async fn post_authorize(ctx: AppCtx, body: &str) -> (StatusCode, serde_json::Value) {
        let resp = app(ctx)
            .oneshot(Request::builder().method("POST").uri("/authorize").header("content-type", "application/json").body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn health_ok() {
        let resp = app(ctx_no_signer()).oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn authorize_approves_within_balance() {
        let (status, body) = post_authorize(ctx_no_signer(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"100000000","hold_id":"h1"}}"#)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["approved"], true);
        assert_eq!(body["hold_usdc"], "100000000");
        assert!(body.get("edge_auth").is_none()); // sub-$250 → no edge sig
    }

    #[tokio::test]
    async fn authorize_declines_over_equity_with_reason() {
        // $2,000 is high-value, so use the signer ctx (else the edge-unavailable gate fires first);
        // the ledger equity check still runs after the signer-presence gate and binds.
        let (status, body) = post_authorize(ctx_with_signer(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"2000000000","hold_id":"h1"}}"#)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["approved"], false);
        assert_eq!(body["decline_reason"], "insufficient_equity");
    }

    #[tokio::test]
    async fn authorize_rejects_malformed_amount() {
        let (status, body) = post_authorize(ctx_no_signer(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"not-a-number"}}"#)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_amount");
    }

    #[tokio::test]
    async fn high_value_without_signer_declines_edge_unavailable() {
        // $300 >= $250 but no signer configured → decline, and NO hold is reserved.
        let ctx = ctx_no_signer();
        let (_s, body) = post_authorize(ctx.clone(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"300000000","hold_id":"hv1"}}"#)).await;
        assert_eq!(body["approved"], false);
        assert_eq!(body["decline_reason"], "edge_unavailable");
        assert!(ctx.store.get_hold("hv1").is_none(), "no hold should be reserved");
    }

    #[tokio::test]
    async fn high_value_with_signer_approves_and_signs() {
        let (status, body) = post_authorize(ctx_with_signer(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"300000000","hold_id":"hv2"}}"#)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["approved"], true);
        let ea = &body["edge_auth"];
        assert!(ea.is_object(), "high-value approval must carry edge_auth");
        // bytes32 hold id + a 65-byte (132-hex + 0x) signature.
        assert_eq!(ea["hold_id"].as_str().unwrap().len(), 66);
        assert_eq!(ea["signature"].as_str().unwrap().len(), 2 + 130);
        assert_eq!(ea["amount_usdc"], "300000000");
    }

    #[tokio::test]
    async fn get_hold_roundtrips_then_404() {
        let ctx = ctx_no_signer();
        let _ = post_authorize(ctx.clone(), &format!(r#"{{"user":"{ALICE}","amount_usdc":"100000000","hold_id":"hX"}}"#)).await;
        let ok = app(ctx.clone()).oneshot(Request::builder().uri("/holds/hX").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let miss = app(ctx).oneshot(Request::builder().uri("/holds/nope").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(miss.status(), StatusCode::NOT_FOUND);
    }
}
