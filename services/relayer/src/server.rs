//! The axum HTTP surface over the settlement library. Turns the offline-provable signing/submission
//! core (`settle` / `batch` / `submit`) into an always-on service so x402 `/settle`, org vendor-pay, and
//! the >=$250 card leg have a live on-chain settle path. Thin glue: parse → build the library's
//! `SettleParams` / `BatchSettleParams` → `submit_settlement` / `submit_batch_settlement` → JSON.
//!
//! Posture mirrors `services/edge-auth`:
//! - **Bearer fail-closed** — `RELAYER_HTTP_SECRET` guards every settle endpoint; unset ⇒ 401 for all.
//! - **Funded-key fail-closed** — no signer key ⇒ 503 `signer_unavailable` (never run keyless).
//! - **RPC fail-closed** — no `RELAYER_RPC_URL` ⇒ 503 `rpc_unavailable`.
//! - **Idempotent** — a settle for the same hold/batch reference never double-submits (see `idem`).
//!
//! The library's RPC client is `reqwest::blocking`, so every on-chain call runs inside
//! `tokio::task::spawn_blocking` — the async runtime is never blocked by a synchronous JSON-RPC round-trip.

use std::sync::Arc;

use alloy_primitives::{hex, keccak256, Address, B256, U256};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::batch::{submit_batch_settlement, BatchSettleParams, Hold};
use crate::idem::{IdemStore, Reserved};
use crate::settle::{EdgeAuth, Permit, SettleParams};
use crate::submit::{submit_settlement, RelayerKey, Rpc};

/// Shared handler state. Every `Option` is a fail-closed gate: absent ⇒ the settle endpoints return
/// 401/503 rather than doing something unsafe.
#[derive(Clone)]
pub struct AppCtx {
    /// The funded relayer key (must hold `RELAYER_ROLE` on the Gateway / settlement contract).
    /// `None` ⇒ 503 `signer_unavailable`.
    pub key: Option<Arc<RelayerKey>>,
    /// JSON-RPC endpoint for the destination chain. `None` ⇒ 503 `rpc_unavailable`.
    pub rpc: Option<Arc<Rpc>>,
    /// Default `MintwarePaymentGateway` for `/settle` (per-request `gateway` overrides). Neither set ⇒ 400.
    pub gateway: Option<Address>,
    /// Default `MintwareEthSettlement` for `/settle-batch` (per-request `settlement` overrides).
    pub settlement: Option<Address>,
    /// Bearer secret guarding the settle endpoints. `None` ⇒ FAIL CLOSED (all requests 401): these
    /// endpoints move money, so they must never be open.
    pub api_secret: Option<Arc<Vec<u8>>>,
    /// Dedup guard so the same hold/batch reference can't be submitted twice.
    pub idem: Arc<IdemStore>,
}

/// Constant-time byte compare (avoids leaking the secret via early-exit timing). Same as edge-auth.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Require `Authorization: Bearer <secret>`. Fails closed when no secret is configured.
fn auth_ok(ctx: &AppCtx, headers: &HeaderMap) -> bool {
    let Some(secret) = ctx.api_secret.as_deref() else {
        return false; // no secret configured → reject everything
    };
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");
    ct_eq(provided.as_bytes(), secret)
}

pub fn app(ctx: AppCtx) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/settle", post(settle))
        .route("/settle-batch", post(settle_batch))
        .with_state(ctx)
}

async fn health() -> &'static str {
    "ok"
}

// ── wire types ────────────────────────────────────────────────────────────────────────────────────
// USDC amounts + big integers are decimal strings on the wire (`u128`/`U256` don't fit a JSON number
// safely); addresses / hashes / sigs are 0x-hex. Parsed to alloy types at the boundary (400 on bad input).

#[derive(Debug, Deserialize)]
struct PermitReq {
    user: String,
    max_daily_spend_usdc: String,
    nonce: String,
    deadline: String,
    /// 0x-hex EIP-712 signature.
    signature: String,
}

#[derive(Debug, Deserialize)]
struct EdgeReq {
    hold_id: String,
    user: String,
    amount_usdc: String,
    nonce: String,
    expiry: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
struct SettleReq {
    /// bytes32 hold id the Gateway settles under (0x-hex, 32 bytes). Also the idempotency key.
    hold_id: String,
    user: String,
    /// Charge in USDC minor units (6dp), decimal string.
    assets: String,
    receiver: String,
    permit: PermitReq,
    /// Present for charges >= $250 (the high-value edge auth). Omit for the permit-only path.
    #[serde(default)]
    edge: Option<EdgeReq>,
    /// Optional Gateway override; falls back to the server's configured default.
    #[serde(default)]
    gateway: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HoldReq {
    hold_id: String,
    amount_usdc: String,
}

#[derive(Debug, Deserialize)]
struct BatchReq {
    holds: Vec<HoldReq>,
    /// The rail / Gateway the produced USDC is paid to.
    rail: String,
    settlement_slippage_bps: u16,
    /// Optional `MintwareEthSettlement` override; falls back to the server's configured default.
    #[serde(default)]
    settlement: Option<String>,
    /// Optional idempotency key. When omitted, a deterministic key is derived from the hold ids.
    #[serde(default)]
    batch_id: Option<String>,
}

// ── parse helpers ───────────────────────────────────────────────────────────────────────────────

fn parse_addr(s: &str) -> Result<Address, &'static str> {
    s.trim().parse::<Address>().map_err(|_| "invalid_address")
}
fn parse_b256(s: &str) -> Result<B256, &'static str> {
    s.trim().parse::<B256>().map_err(|_| "invalid_hash")
}
fn parse_u128(s: &str) -> Result<u128, &'static str> {
    s.trim().parse::<u128>().map_err(|_| "invalid_amount")
}
fn parse_u256(s: &str) -> Result<U256, &'static str> {
    U256::from_str_radix(s.trim(), 10).map_err(|_| "invalid_integer")
}
fn parse_sig(s: &str) -> Result<Vec<u8>, &'static str> {
    hex::decode(s.trim().trim_start_matches("0x")).map_err(|_| "invalid_signature")
}

fn bad_request(err: &str) -> axum::response::Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "success": false, "error": err, "status": "error" })))
        .into_response()
}
fn unavailable(err: &str) -> axum::response::Response {
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "success": false, "error": err, "status": "error" })))
        .into_response()
}
fn ok_tx(tx_hash: B256, status: &str) -> axum::response::Response {
    (
        StatusCode::OK,
        Json(json!({ "success": true, "tx_hash": format!("0x{}", hex::encode(tx_hash)), "status": status })),
    )
        .into_response()
}

/// Build the library `SettleParams` from the request (400 on any malformed field).
fn build_settle_params(req: &SettleReq) -> Result<SettleParams, &'static str> {
    let permit = Permit {
        user: parse_addr(&req.permit.user)?,
        max_daily_spend_usdc: parse_u128(&req.permit.max_daily_spend_usdc)?,
        nonce: parse_u256(&req.permit.nonce)?,
        deadline: parse_u256(&req.permit.deadline)?,
        signature: parse_sig(&req.permit.signature)?,
    };
    let edge = match &req.edge {
        Some(e) => Some(EdgeAuth {
            hold_id: parse_b256(&e.hold_id)?,
            user: parse_addr(&e.user)?,
            amount_usdc: parse_u128(&e.amount_usdc)?,
            nonce: parse_u256(&e.nonce)?,
            expiry: parse_u256(&e.expiry)?,
            signature: parse_sig(&e.signature)?,
        }),
        None => None,
    };
    Ok(SettleParams {
        hold_id: parse_b256(&req.hold_id)?,
        user: parse_addr(&req.user)?,
        assets: parse_u128(&req.assets)?,
        receiver: parse_addr(&req.receiver)?,
        permit,
        edge,
    })
}

/// POST /settle — settle ONE hold against `MintwarePaymentGateway.settleSpend`.
/// Body: `SettleReq`. Response: `{ success, tx_hash, status }` or a structured error.
async fn settle(State(ctx): State<AppCtx>, headers: HeaderMap, body: axum::body::Bytes) -> impl IntoResponse {
    if !auth_ok(&ctx, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "success": false, "error": "unauthorized" })))
            .into_response();
    }
    let req: SettleReq = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return bad_request("invalid_json"),
    };

    // Fail-closed config gates (503) BEFORE we touch the request money math.
    let Some(key) = ctx.key.clone() else { return unavailable("signer_unavailable") };
    let Some(rpc) = ctx.rpc.clone() else { return unavailable("rpc_unavailable") };
    let gateway = match req.gateway.as_deref() {
        Some(g) => match parse_addr(g) {
            Ok(a) => a,
            Err(e) => return bad_request(e),
        },
        None => match ctx.gateway {
            Some(a) => a,
            None => return bad_request("gateway_unconfigured"),
        },
    };

    let params = match build_settle_params(&req) {
        Ok(p) => p,
        Err(e) => return bad_request(e),
    };
    // Mirror the Gateway's pre-flight so a bad request is a 400 here, not an on-chain revert.
    if let Err(e) = params.validate() {
        return bad_request(settlement_error_code(&e));
    }

    // Idempotency: the bytes32 hold id is the natural key. A completed settle returns the cached tx;
    // an in-flight one is a 409 (never a second broadcast).
    let idem_key = format!("settle:0x{}", hex::encode(params.hold_id));
    match ctx.idem.reserve(&idem_key) {
        Reserved::Fresh => {}
        Reserved::Done(tx) => return ok_tx(tx, "duplicate"),
        Reserved::InFlight => {
            return (StatusCode::CONFLICT, Json(json!({ "success": false, "error": "already_in_flight", "status": "in_flight" })))
                .into_response()
        }
    }

    // Offload the blocking JSON-RPC (nonce/fees → sign → broadcast) off the async runtime.
    let res = tokio::task::spawn_blocking(move || submit_settlement(&rpc, &key, gateway, &params)).await;
    match res {
        Ok(Ok(tx)) => {
            ctx.idem.complete(&idem_key, tx);
            ok_tx(tx, "submitted")
        }
        Ok(Err(e)) => {
            ctx.idem.release(&idem_key); // a failed submit isn't a completed settle — allow retry
            (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e.to_string(), "status": "error" })))
                .into_response()
        }
        Err(_join) => {
            ctx.idem.release(&idem_key);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": "worker_panicked", "status": "error" })))
                .into_response()
        }
    }
}

/// POST /settle-batch — batch ETH→USDC settle via `MintwareEthSettlement.batchSettleEth`.
async fn settle_batch(State(ctx): State<AppCtx>, headers: HeaderMap, body: axum::body::Bytes) -> impl IntoResponse {
    if !auth_ok(&ctx, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "success": false, "error": "unauthorized" })))
            .into_response();
    }
    let req: BatchReq = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return bad_request("invalid_json"),
    };

    let Some(key) = ctx.key.clone() else { return unavailable("signer_unavailable") };
    let Some(rpc) = ctx.rpc.clone() else { return unavailable("rpc_unavailable") };
    let settlement = match req.settlement.as_deref() {
        Some(s) => match parse_addr(s) {
            Ok(a) => a,
            Err(e) => return bad_request(e),
        },
        None => match ctx.settlement {
            Some(a) => a,
            None => return bad_request("settlement_unconfigured"),
        },
    };
    let rail = match parse_addr(&req.rail) {
        Ok(a) => a,
        Err(e) => return bad_request(e),
    };
    let mut holds = Vec::with_capacity(req.holds.len());
    for h in &req.holds {
        let hold_id = match parse_b256(&h.hold_id) {
            Ok(v) => v,
            Err(e) => return bad_request(e),
        };
        let amount_usdc = match parse_u128(&h.amount_usdc) {
            Ok(v) => v,
            Err(e) => return bad_request(e),
        };
        holds.push(Hold { hold_id, amount_usdc });
    }

    // Idempotency key: caller-supplied batch id, else a deterministic hash of the (ordered) hold ids.
    let idem_key = match &req.batch_id {
        Some(b) => format!("batch:{b}"),
        None => {
            let mut buf = Vec::with_capacity(holds.len() * 32);
            for h in &holds {
                buf.extend_from_slice(h.hold_id.as_slice());
            }
            format!("batch:0x{}", hex::encode(keccak256(&buf)))
        }
    };

    let params = BatchSettleParams { settlement, rail, holds, settlement_slippage_bps: req.settlement_slippage_bps };
    if let Err(e) = params.validate() {
        return bad_request(batch_error_code(&e));
    }

    match ctx.idem.reserve(&idem_key) {
        Reserved::Fresh => {}
        Reserved::Done(tx) => return ok_tx(tx, "duplicate"),
        Reserved::InFlight => {
            return (StatusCode::CONFLICT, Json(json!({ "success": false, "error": "already_in_flight", "status": "in_flight" })))
                .into_response()
        }
    }

    let res = tokio::task::spawn_blocking(move || submit_batch_settlement(&rpc, &key, &params)).await;
    match res {
        Ok(Ok(tx)) => {
            ctx.idem.complete(&idem_key, tx);
            ok_tx(tx, "submitted")
        }
        Ok(Err(e)) => {
            ctx.idem.release(&idem_key);
            (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e.to_string(), "status": "error" })))
                .into_response()
        }
        Err(_join) => {
            ctx.idem.release(&idem_key);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": "worker_panicked", "status": "error" })))
                .into_response()
        }
    }
}

/// Stable snake_case codes for the settle validation errors (client-fixable ⇒ 400).
fn settlement_error_code(e: &crate::settle::SettlementError) -> &'static str {
    use crate::settle::SettlementError::*;
    match e {
        ZeroAmount => "zero_amount",
        EdgeRequired => "edge_required",
        EdgeMismatch => "edge_mismatch",
    }
}

fn batch_error_code(e: &crate::batch::BatchError) -> &'static str {
    use crate::batch::BatchError::*;
    match e {
        Empty => "empty_batch",
        ZeroTotal => "zero_total",
        ZeroHold => "zero_hold",
        ZeroRail => "zero_rail",
        BadSlippage => "bad_slippage",
        Submit(_) => "submit_error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt; // oneshot

    const API_SECRET: &str = "test-http-secret";
    // canonical privkey 0x…01 → a well-known address; used only so the ctx has a signer present.
    const KEY_ONE: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const GATEWAY: &str = "0x26ce3baff473b24e8afe932dfb6d68adca8048b0";
    // A dummy RPC URL that is never contacted in these tests (every test stops before broadcast).
    const DUMMY_RPC: &str = "http://127.0.0.1:1"; // unroutable; a call here would fail, not hang the test

    fn full_ctx() -> AppCtx {
        AppCtx {
            key: Some(Arc::new(RelayerKey::from_hex(KEY_ONE).unwrap())),
            rpc: Some(Arc::new(Rpc::new(DUMMY_RPC))),
            gateway: Some(GATEWAY.parse().unwrap()),
            settlement: Some(Address::repeat_byte(0x5e)),
            api_secret: Some(Arc::new(API_SECRET.as_bytes().to_vec())),
            idem: Arc::new(IdemStore::new()),
        }
    }

    fn no_signer_ctx() -> AppCtx {
        AppCtx { key: None, ..full_ctx() }
    }
    fn no_rpc_ctx() -> AppCtx {
        AppCtx { rpc: None, ..full_ctx() }
    }
    fn no_secret_ctx() -> AppCtx {
        AppCtx { api_secret: None, ..full_ctx() }
    }

    fn low_value_body() -> String {
        // permit-only ($100) settle; dummy sigs — never broadcast in unit tests.
        format!(
            r#"{{"hold_id":"0x{h}","user":"0x{u}","assets":"100000000","receiver":"0x{u}",
                 "permit":{{"user":"0x{u}","max_daily_spend_usdc":"1000000000","nonce":"1","deadline":"9999999999","signature":"0xaa"}}}}"#,
            h = "01".repeat(32),
            u = "11".repeat(20),
        )
    }

    async fn post(ctx: AppCtx, uri: &str, bearer: Option<&str>, body: &str) -> (StatusCode, Value) {
        let mut b = Request::builder().method("POST").uri(uri).header("content-type", "application/json");
        if let Some(tok) = bearer {
            b = b.header("authorization", format!("Bearer {tok}"));
        }
        let resp = app(ctx).oneshot(b.body(Body::from(body.to_string())).unwrap()).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, v)
    }

    #[tokio::test]
    async fn health_ok() {
        let resp = app(full_ctx())
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn settle_rejects_without_bearer() {
        let (status, _b) = post(full_ctx(), "/settle", None, &low_value_body()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn settle_rejects_wrong_bearer() {
        let (status, _b) = post(full_ctx(), "/settle", Some("nope"), &low_value_body()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn settle_fails_closed_when_no_secret_configured() {
        // Even a well-formed Bearer is rejected when the server has no secret set.
        let (status, _b) = post(no_secret_ctx(), "/settle", Some(API_SECRET), &low_value_body()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn settle_503_when_signer_unset() {
        let (status, body) = post(no_signer_ctx(), "/settle", Some(API_SECRET), &low_value_body()).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"], "signer_unavailable");
    }

    #[tokio::test]
    async fn settle_503_when_rpc_unset() {
        let (status, body) = post(no_rpc_ctx(), "/settle", Some(API_SECRET), &low_value_body()).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"], "rpc_unavailable");
    }

    #[tokio::test]
    async fn settle_400_on_invalid_json() {
        let (status, body) = post(full_ctx(), "/settle", Some(API_SECRET), "not json").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_json");
    }

    #[tokio::test]
    async fn settle_400_on_bad_amount() {
        let bad = low_value_body().replace(r#""assets":"100000000""#, r#""assets":"not-a-number""#);
        let (status, body) = post(full_ctx(), "/settle", Some(API_SECRET), &bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_amount");
    }

    #[tokio::test]
    async fn settle_400_on_high_value_without_edge() {
        // >= $250 with no edge auth → the library's validate() rejects (EdgeRequired) BEFORE any submit.
        let hv = low_value_body().replace(r#""assets":"100000000""#, r#""assets":"300000000""#);
        let (status, body) = post(full_ctx(), "/settle", Some(API_SECRET), &hv).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "edge_required");
    }

    #[tokio::test]
    async fn settle_idempotent_replay_returns_cached_tx_without_submitting() {
        // Pre-seed the idem store with a completed settle for this hold id, then POST it: the handler
        // returns the cached tx as a "duplicate" WITHOUT contacting the (unroutable) RPC.
        let ctx = full_ctx();
        let tx = B256::repeat_byte(0x7a);
        let key = format!("settle:0x{}", "01".repeat(32));
        ctx.idem.seed_done(&key, tx);
        let (status, body) = post(ctx, "/settle", Some(API_SECRET), &low_value_body()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["success"], true);
        assert_eq!(body["status"], "duplicate");
        assert_eq!(body["tx_hash"], format!("0x{}", hex::encode(tx)));
    }

    fn batch_body() -> String {
        format!(
            r#"{{"holds":[{{"hold_id":"0x{a}","amount_usdc":"40000000"}},{{"hold_id":"0x{b}","amount_usdc":"60000000"}}],
                 "rail":"0x{r}","settlement_slippage_bps":100,"batch_id":"epoch-1"}}"#,
            a = "01".repeat(32),
            b = "02".repeat(32),
            r = "2a".repeat(20),
        )
    }

    #[tokio::test]
    async fn batch_rejects_without_bearer() {
        let (status, _b) = post(full_ctx(), "/settle-batch", None, &batch_body()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn batch_503_when_signer_unset() {
        let (status, body) = post(no_signer_ctx(), "/settle-batch", Some(API_SECRET), &batch_body()).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"], "signer_unavailable");
    }

    #[tokio::test]
    async fn batch_400_on_empty_holds() {
        let empty = r#"{"holds":[],"rail":"0x2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a","settlement_slippage_bps":100}"#;
        let (status, body) = post(full_ctx(), "/settle-batch", Some(API_SECRET), empty).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "empty_batch");
    }

    #[tokio::test]
    async fn batch_idempotent_replay_returns_cached_tx() {
        let ctx = full_ctx();
        let tx = B256::repeat_byte(0x5b);
        ctx.idem.seed_done("batch:epoch-1", tx);
        let (status, body) = post(ctx, "/settle-batch", Some(API_SECRET), &batch_body()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "duplicate");
        assert_eq!(body["tx_hash"], format!("0x{}", hex::encode(tx)));
    }
}
