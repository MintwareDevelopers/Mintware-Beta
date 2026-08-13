//! YPN edge-auth server binary. Serves `/authorize`, `/health`, `/holds/:id` over the in-memory hold
//! store. The store starts EMPTY (a fresh, zero-balance NAV) so every charge declines until the NAV
//! refresher (increment 4) and the shares indexer feed it — the service is up, just not yet fed.

use std::env;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use edge_auth::nav::NavSnapshot;
use edge_auth::server::app;
use edge_auth::store::MemStore;

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[tokio::main]
async fn main() {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);

    // Defaults mirror the Gateway hold window (10 min) and a conservative NAV freshness bound (30s).
    let max_nav_age = env_u64("EDGE_MAX_NAV_AGE_SECS", 30);
    let hold_ttl = env_u64("EDGE_HOLD_TTL_SECS", 600);
    let port = env_u64("PORT", 8080);

    // Empty-but-fresh NAV: the service answers (declining) until the refresher/indexer populate it.
    let nav = NavSnapshot {
        total_assets: 0,
        total_shares: 0,
        virtual_offset: 1_000,
        idle_buffer: 0,
        observed_at_secs: now,
    };
    let store = Arc::new(MemStore::new(nav, max_nav_age, hold_ttl));

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    eprintln!("edge-auth listening on {addr} (max_nav_age={max_nav_age}s, hold_ttl={hold_ttl}s)");

    axum::serve(listener, app(store))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("edge-auth shutting down");
}
