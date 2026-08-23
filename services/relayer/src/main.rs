//! YPN relayer server binary. Serves `/health`, `/settle`, and `/settle-batch` over the settlement
//! library — the always-on on-chain settle path for x402 `/settle`, org vendor-pay, and the >=$250 card
//! leg. Mirrors `services/edge-auth`: fail-closed bearer, fail-closed funded key, fail-closed RPC, and a
//! `TcpListener::bind` + `axum::serve` with graceful shutdown.
//!
//! Every money-moving gate is OFF until its env var is set — the service comes up and answers `/health`,
//! but `/settle*` returns 401 (no `RELAYER_HTTP_SECRET`) / 503 (no signer key or RPC) until the operator
//! provides the funded key + RPC. It never runs keyless.

use std::env;
use std::sync::Arc;

use alloy_primitives::Address;
use relayer::idem::IdemStore;
use relayer::server::{app, AppCtx};
use relayer::submit::{RelayerKey, Rpc};

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// First non-empty of the given env var names.
fn env_first(names: &[&str]) -> Option<String> {
    names.iter().find_map(|k| env::var(k).ok().filter(|v| !v.trim().is_empty()))
}

/// Build the funded relayer key from env. `None` (fail closed) ⇒ every settle endpoint returns 503.
/// Accepts `RELAYER_SIGNER_KEY` (canonical) or `RELAYER_SUBMIT_KEY` (the name in `.env.arc.example`).
fn build_key() -> Option<Arc<RelayerKey>> {
    let key = env_first(&["RELAYER_SIGNER_KEY", "RELAYER_SUBMIT_KEY"])?;
    match RelayerKey::from_hex(&key) {
        Ok(k) => {
            // Log the ADDRESS only (never the key) — it must hold RELAYER_ROLE on the Gateway.
            eprintln!("relayer: signer {} — must hold RELAYER_ROLE on the Gateway / settlement contract", k.address());
            Some(Arc::new(k))
        }
        Err(e) => {
            eprintln!("relayer: ⚠ bad RELAYER_SIGNER_KEY ({e}) — settle DISABLED (503 signer_unavailable)");
            None
        }
    }
}

fn parse_addr_env(names: &[&str], label: &str) -> Option<Address> {
    let raw = env_first(names)?;
    match raw.parse::<Address>() {
        Ok(a) => Some(a),
        Err(_) => {
            eprintln!("relayer: ⚠ {label} is not a valid address — default unset (per-request override still works)");
            None
        }
    }
}

#[tokio::main]
async fn main() {
    let port = env_u64("PORT", 8080);

    let key = build_key();

    // RPC — fail closed. Without it, settle returns 503 rpc_unavailable.
    let rpc = match env_first(&["RELAYER_RPC_URL"]) {
        Some(url) => {
            eprintln!("relayer: RPC {url}");
            Some(Arc::new(Rpc::new(url)))
        }
        None => {
            eprintln!("relayer: ⚠ RELAYER_RPC_URL UNSET — settle DISABLED (503 rpc_unavailable)");
            None
        }
    };

    // Default contracts (per-request `gateway`/`settlement` still override these).
    let gateway = parse_addr_env(&["RELAYER_GATEWAY_ADDRESS", "GATEWAY_ADDRESS"], "RELAYER_GATEWAY_ADDRESS");
    if gateway.is_none() {
        eprintln!("relayer: no default Gateway (set RELAYER_GATEWAY_ADDRESS, or pass `gateway` per /settle request)");
    }
    let settlement = parse_addr_env(&["RELAYER_SETTLEMENT_ADDRESS", "SETTLEMENT_ADDRESS"], "RELAYER_SETTLEMENT_ADDRESS");
    if settlement.is_none() {
        eprintln!("relayer: no default settlement contract (set RELAYER_SETTLEMENT_ADDRESS, or pass `settlement` per /settle-batch request)");
    }

    // Bearer secret guarding /settle + /settle-batch. FAIL CLOSED — unset ⇒ all settle requests 401.
    let api_secret = env_first(&["RELAYER_HTTP_SECRET"]).map(|s| Arc::new(s.into_bytes()));
    if api_secret.is_none() {
        eprintln!("relayer: ⚠ RELAYER_HTTP_SECRET UNSET — /settle and /settle-batch will reject ALL requests (fail-closed). Set it to enable the service.");
    }

    let ctx = AppCtx {
        key,
        rpc,
        gateway,
        settlement,
        api_secret,
        idem: Arc::new(IdemStore::new()),
    };

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    eprintln!("relayer-server listening on {addr}");

    axum::serve(listener, app(ctx))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("relayer-server shutting down");
}
