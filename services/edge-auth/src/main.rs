//! YPN edge-auth server binary. Serves `/authorize`, `/health`, `/holds/:id` over the in-memory hold
//! store. The store starts EMPTY (a fresh, zero-balance NAV) so every charge declines until the NAV
//! refresher (increment 4) and the shares indexer feed it — the service is up, just not yet fed.

use std::env;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_primitives::Address;
use edge_auth::chain::EthReader;
use edge_auth::nav::NavSnapshot;
use edge_auth::refresher::run_refresher_multi;
use edge_auth::server::{app, AppCtx};
use edge_auth::signer::EdgeSigner;
use edge_auth::store::MemStore;

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Build the EXTRA collateral vaults (multi-collateral portfolios) from env. Currently supports ONE
/// extra leg: `EDGE_EXTRA_VAULT_ADDRESS` (+ `EDGE_EXTRA_VAULT_ID` label, `EDGE_EXTRA_VAULT_KIND`, and the
/// collateral knobs `EDGE_EXTRA_COLLATERAL`/`EDGE_EXTRA_PRICE_FEED`/… — the primary's keys, `EDGE_EXTRA_`
/// prefixed, reusing `CollateralConfig::from_lookup`). Unset → no extras (primary-only). A bad address or
/// collateral config SKIPS the extra (fail closed) rather than mis-value it.
fn build_extra_vaults(rpc: &str) -> Vec<(String, EthReader)> {
    use edge_auth::chain::{CollateralConfig, VaultKind};
    let addr_str = match env::var("EDGE_EXTRA_VAULT_ADDRESS") {
        Ok(a) => a,
        Err(_) => return Vec::new(),
    };
    let addr = match addr_str.parse::<Address>() {
        Ok(a) => a,
        Err(_) => {
            eprintln!("edge-auth: EDGE_EXTRA_VAULT_ADDRESS is not a valid address — extra vault SKIPPED");
            return Vec::new();
        }
    };
    let id = env::var("EDGE_EXTRA_VAULT_ID").unwrap_or_else(|_| addr_str.clone());
    let kind = VaultKind::from_env_str(&env::var("EDGE_EXTRA_VAULT_KIND").unwrap_or_default());
    // Remap EDGE_* → EDGE_EXTRA_* so the extra leg has its OWN collateral config (feed, haircut, …).
    let collateral = match CollateralConfig::from_lookup(|k| env::var(k.replacen("EDGE_", "EDGE_EXTRA_", 1)).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("edge-auth: bad EDGE_EXTRA_ collateral config ({e}) — extra vault SKIPPED (fail closed)");
            return Vec::new();
        }
    };
    vec![(id, EthReader::with_kind(rpc.to_string(), addr, kind).with_collateral(collateral))]
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
                // EDGE_VAULT_KIND=v2 reads the treasury vault's senior tranche; default (unset) = v1.
                let kind = edge_auth::chain::VaultKind::from_env_str(&env::var("EDGE_VAULT_KIND").unwrap_or_default());
                // EDGE_COLLATERAL=eth (+ EDGE_PRICE_FEED) turns on the multi-collateral arm. Parse FAILS
                // CLOSED — a misconfigured ETH arm disables the refresher rather than value ETH as USDC.
                match edge_auth::chain::CollateralConfig::from_lookup(|k| env::var(k).ok()) {
                    Ok(collateral) => {
                        let reader = EthReader::with_kind(rpc.clone(), vault, kind).with_collateral(collateral.clone());
                        // Multi-collateral: additional legs a user's card limit sums over (EDGE_EXTRA_*).
                        let extras = build_extra_vaults(&rpc);
                        eprintln!("edge-auth: NAV refresher polling {vault} ({kind:?}, {collateral:?}) + {} extra leg(s) every {}s, tracking {} user(s)", extras.len(), interval.as_secs(), users.len());
                        tokio::spawn(run_refresher_multi(store.clone(), reader, extras, users, interval));
                    }
                    Err(e) => eprintln!("edge-auth: bad EDGE_COLLATERAL config ({e}) — NAV refresher DISABLED (fail closed)"),
                }
            }
            Err(_) => eprintln!("edge-auth: EDGE_VAULT_ADDRESS is not a valid address — refresher DISABLED"),
        },
        _ => eprintln!("edge-auth: NAV refresher DISABLED (set EDGE_RPC_URL + EDGE_VAULT_ADDRESS to enable)"),
    }

    let rain_secret = env::var("EDGE_RAIN_WEBHOOK_SECRET").ok().map(|s| Arc::new(s.into_bytes()));
    if rain_secret.is_none() {
        eprintln!("edge-auth: Rain webhooks DISABLED (set EDGE_RAIN_WEBHOOK_SECRET to enable /webhooks/rain)");
    }
    // AUDIT C1: bearer secret for /authorize + /holds. FAIL CLOSED — if unset, those endpoints reject
    // every request (they mint EDGE_SIGNER signatures and reserve user equity; they must never be open).
    // Accept EDGE_AUTH_SECRET as a fallback name (the TS caller in lib/x402/config.ts sends that var);
    // both names must hold the SAME value. EDGE_API_SECRET wins when both are set (the live Railway var).
    let api_secret = env::var("EDGE_API_SECRET")
        .or_else(|_| env::var("EDGE_AUTH_SECRET"))
        .ok()
        .map(|s| Arc::new(s.into_bytes()));
    if api_secret.is_none() {
        eprintln!("edge-auth: ⚠ EDGE_API_SECRET / EDGE_AUTH_SECRET UNSET — /authorize and /holds will reject ALL requests (fail-closed). Set one to enable the service.");
    }
    let ctx = AppCtx { store: store.clone(), edge: build_edge_signer(), rain_secret, api_secret };

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
