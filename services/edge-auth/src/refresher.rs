//! Background NAV/shares refresher (increment 4). Polls the vault on an interval and writes the fresh
//! snapshot + per-user share balances into the store, so the hot path never touches the chain. The
//! store's staleness guard means that if this loop stalls, authorizations fail safe (decline) rather
//! than run against a stale NAV.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_primitives::Address;

use crate::chain::{addr_key, EthReader};
use crate::store::MemStore;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Refresh ONE vault into the store: the PRIMARY (settlement) vault (`vault_id = None` → `set_nav`/
/// `set_shares`) or an EXTRA collateral leg (`Some(id)` → `set_nav_for`/`set_shares_for`). Best-effort —
/// a failed shares read for one user is logged and skipped, and a failed NAV read leaves the previous
/// (soon-stale) snapshot in place so the guard trips. Returns whether the NAV was updated.
async fn refresh_vault(
    store: &MemStore,
    reader: &EthReader,
    users: &[Address],
    now: u64,
    vault_id: Option<&str>,
) -> bool {
    let label = vault_id.unwrap_or("primary");
    match reader.fetch_nav(now).await {
        Ok(nav) => {
            match vault_id {
                None => store.set_nav(nav),
                Some(id) => store.set_nav_for(id, nav),
            }
            for u in users {
                match reader.fetch_shares(*u).await {
                    Ok(s) => match vault_id {
                        None => store.set_shares(&addr_key(u), s),
                        Some(id) => store.set_shares_for(&addr_key(u), id, s),
                    },
                    Err(e) => eprintln!("edge-auth: shares refresh failed for {u} (vault {label}): {e}"),
                }
            }
            true
        }
        Err(e) => {
            eprintln!("edge-auth: NAV refresh failed for vault {label} (cache goes stale, auths fail safe): {e}");
            false
        }
    }
}

/// One refresh cycle for the PRIMARY vault (back-compat).
pub async fn refresh_once(store: &MemStore, reader: &EthReader, users: &[Address], now: u64) -> bool {
    refresh_vault(store, reader, users, now, None).await
}

/// One refresh cycle for an EXTRA collateral leg (multi-collateral portfolios).
pub async fn refresh_extra_once(
    store: &MemStore,
    vault_id: &str,
    reader: &EthReader,
    users: &[Address],
    now: u64,
) -> bool {
    refresh_vault(store, reader, users, now, Some(vault_id)).await
}

/// Poll forever on `interval`, refreshing the PRIMARY vault plus every EXTRA collateral leg each cycle.
/// All legs share one `now` per cycle so a portfolio never mixes snapshots from different instants.
pub async fn run_refresher_multi(
    store: Arc<MemStore>,
    primary: EthReader,
    extras: Vec<(String, EthReader)>,
    users: Vec<Address>,
    interval: Duration,
) {
    loop {
        let now = now_secs();
        refresh_once(&store, &primary, &users, now).await;
        for (vault_id, reader) in &extras {
            refresh_extra_once(&store, vault_id, reader, &users, now).await;
        }
        tokio::time::sleep(interval).await;
    }
}

/// Poll forever on `interval` (PRIMARY vault only). Back-compat wrapper over `run_refresher_multi`.
pub async fn run_refresher(store: Arc<MemStore>, reader: EthReader, users: Vec<Address>, interval: Duration) {
    run_refresher_multi(store, reader, Vec::new(), users, interval).await;
}
