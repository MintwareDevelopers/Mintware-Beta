//! The axum HTTP surface over the hold store. Thin glue: parse → `store.try_authorize` → JSON. A
//! decline is a normal business outcome (HTTP 200 with `approved:false`); only malformed input is 400.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::store::{Hold, HoldStatus, MemStore};
use crate::types::{AuthorizeRequest, AuthorizeResponse, HoldView};

pub type AppState = Arc<MemStore>;

/// Wall-clock seconds. Isolated so the hot path has a single time source.
fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn app(store: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/authorize", post(authorize))
        .route("/holds/:id", get(get_hold))
        .with_state(store)
}

async fn health() -> &'static str {
    "ok"
}

async fn authorize(State(store): State<AppState>, Json(req): Json<AuthorizeRequest>) -> impl IntoResponse {
    let amount = match req.amount_usdc.parse::<u128>() {
        Ok(a) => a,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_amount" }))).into_response(),
    };
    let now = now_secs();
    // Rain normally supplies the hold/auth id; mint a deterministic fallback if absent.
    let hold_id = req.hold_id.clone().unwrap_or_else(|| format!("edge:{}:{}:{}", req.user, amount, now));

    let out = store.try_authorize(&hold_id, &req.user, amount, now);
    (StatusCode::OK, Json(AuthorizeResponse::from_decision(out.decision, out.hold_id))).into_response()
}

async fn get_hold(State(store): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match store.get_hold(&id) {
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

    fn test_store() -> AppState {
        // max_nav_age huge so wall-clock freshness always passes in tests; $10k liquid vault.
        let nav = NavSnapshot { total_assets: 10_000_000_000, total_shares: 10_000_000_000, virtual_offset: 1_000, idle_buffer: 10_000_000_000, observed_at_secs: 0 };
        let s = MemStore::new(nav, u64::MAX, 600);
        s.set_shares("alice", 1_000_000_000); // $1,000 equity
        s.set_daily_cap("alice", 100_000_000_000);
        Arc::new(s)
    }

    async fn post_authorize(store: AppState, body: &str) -> (StatusCode, serde_json::Value) {
        let resp = app(store)
            .oneshot(Request::builder().method("POST").uri("/authorize").header("content-type", "application/json").body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn health_ok() {
        let resp = app(test_store()).oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn authorize_approves_within_balance() {
        let (status, body) = post_authorize(test_store(), r#"{"user":"alice","amount_usdc":"100000000","hold_id":"h1"}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["approved"], true);
        assert_eq!(body["hold_id"], "h1");
        assert_eq!(body["hold_usdc"], "100000000");
    }

    #[tokio::test]
    async fn authorize_declines_over_equity_with_reason() {
        let (status, body) = post_authorize(test_store(), r#"{"user":"alice","amount_usdc":"2000000000","hold_id":"h1"}"#).await;
        assert_eq!(status, StatusCode::OK); // a decline is still a 200 — the body carries the outcome
        assert_eq!(body["approved"], false);
        assert_eq!(body["decline_reason"], "insufficient_equity");
    }

    #[tokio::test]
    async fn authorize_rejects_malformed_amount() {
        let (status, body) = post_authorize(test_store(), r#"{"user":"alice","amount_usdc":"not-a-number"}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_amount");
    }

    #[tokio::test]
    async fn get_hold_roundtrips_then_404() {
        let store = test_store();
        let _ = post_authorize(store.clone(), r#"{"user":"alice","amount_usdc":"100000000","hold_id":"hX"}"#).await;
        let ok = app(store.clone()).oneshot(Request::builder().uri("/holds/hX").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let miss = app(store).oneshot(Request::builder().uri("/holds/nope").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(miss.status(), StatusCode::NOT_FOUND);
    }
}
