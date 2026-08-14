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

/// One refresh cycle: snapshot the NAV, then each tracked user's shares. Best-effort — a failed shares
/// read for one user is logged and skipped, and a failed NAV read leaves the previous (soon-stale)
/// snapshot in place so the guard trips. Returns whether the NAV was updated.
pub async fn refresh_once(store: &MemStore, reader: &EthReader, users: &[Address], now: u64) -> bool {
    match reader.fetch_nav(now).await {
        Ok(nav) => {
            store.set_nav(nav);
            for u in users {
                match reader.fetch_shares(*u).await {
                    Ok(s) => store.set_shares(&addr_key(u), s),
                    Err(e) => eprintln!("edge-auth: shares refresh failed for {u}: {e}"),
                }
            }
            true
        }
        Err(e) => {
            eprintln!("edge-auth: NAV refresh failed (cache goes stale, auths fail safe): {e}");
            false
        }
    }
}

/// Poll forever on `interval`. Spawn this on the tokio runtime.
pub async fn run_refresher(store: Arc<MemStore>, reader: EthReader, users: Vec<Address>, interval: Duration) {
    loop {
        refresh_once(&store, &reader, &users, now_secs()).await;
        tokio::time::sleep(interval).await;
    }
}
