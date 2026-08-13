//! YPN edge-auth server binary. Serves `/authorize`, `/health`, `/holds/:id` over the in-memory hold
//! store. The store starts EMPTY (a fresh, zero-balance NAV) so every charge declines until the NAV
//! refresher (increment 4) and the shares indexer feed it — the service is up, just not yet fed.

use std::env;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_primitives::Address;
use edge_auth::chain::EthReader;
use edge_auth::nav::NavSnapshot;
use edge_auth::refresher::run_refresher;
use edge_auth::server::{app, AppCtx};
use edge_auth::signer::EdgeSigner;
use edge_auth::store::MemStore;

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Build the EDGE_SIGNER from env, if configured. Without it, charges >= $250 decline
/// (`edge_unavailable`) — the low-value permit-only path still works.
fn build_edge_signer() -> Option<Arc<EdgeSigner>> {
    let key = env::var("EDGE_SIGNER_KEY").ok()?;
    let gateway_str = match env::var("EDGE_GATEWAY_ADDRESS") {
        Ok(g) => g,
        Err(_) => {
            eprintln!("edge-auth: EDGE_SIGNER_KEY set but EDGE_GATEWAY_ADDRESS missing — high-value signing DISABLED");
            return None;
        }
    };
    let gateway: Address = gateway_str.parse().ok()?;
    let chain_id = env_u64("EDGE_CHAIN_ID", 84532);
    match EdgeSigner::from_hex_key(&key, gateway, chain_id) {
        Ok(s) => {
            eprintln!("edge-auth: EDGE_SIGNER {} (gateway {gateway}, chain {chain_id}) — must hold EDGE_SIGNER_ROLE", s.address());
            Some(Arc::new(s))
        }
        Err(e) => {
            eprintln!("edge-auth: bad EDGE_SIGNER_KEY ({e}) — high-value signing DISABLED");
            None
        }
    }
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
        collateral: edge_auth::nav::VaultCollateral::Usdc,
    };
    let store = Arc::new(MemStore::new(nav, max_nav_age, hold_ttl));

    // Increment 4: spawn the on-chain NAV/shares refresher when configured. Without it, the store
    // stays empty-but-fresh and every charge declines (insufficient equity) — the service is up, just
    // not fed. EDGE_USERS is a comma-separated allowlist of addresses to track shares for.
    match (env::var("EDGE_RPC_URL"), env::var("EDGE_VAULT_ADDRESS")) {
        (Ok(rpc), Ok(vault_str)) => match vault_str.parse::<Address>() {
            Ok(vault) => {
                let users: Vec<Address> = env::var("EDGE_USERS")
                    .unwrap_or_default()
                    .split(',')
                    .filter_map(|s| s.trim().parse().ok())
                    .collect();
                let interval = Duration::from_secs(env_u64("EDGE_NAV_REFRESH_SECS", 15));
                eprintln!("edge-auth: NAV refresher polling {vault} every {}s, tracking {} user(s)", interval.as_secs(), users.len());
                tokio::spawn(run_refresher(store.clone(), EthReader::new(rpc, vault), users, interval));
            }
            Err(_) => eprintln!("edge-auth: EDGE_VAULT_ADDRESS is not a valid address — refresher DISABLED"),
        },
        _ => eprintln!("edge-auth: NAV refresher DISABLED (set EDGE_RPC_URL + EDGE_VAULT_ADDRESS to enable)"),
    }

    let ctx = AppCtx { store: store.clone(), edge: build_edge_signer() };

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    eprintln!("edge-auth listening on {addr} (max_nav_age={max_nav_age}s, hold_ttl={hold_ttl}s)");

    axum::serve(listener, app(ctx))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("edge-auth shutting down");
}
