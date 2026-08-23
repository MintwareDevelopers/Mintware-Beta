//! Minimal in-memory idempotency guard for the settle server. A settle for a given reference
//! (a bytes32 hold id, or a batch id) must never be broadcast twice — a double-submit would burn a
//! user's shares (or draw the junior buffer) a second time. This is the server-side dedup the library
//! itself doesn't do (the library is a pure signer/submitter).
//!
//! **Guarantee.** For one process lifetime, at most one on-chain broadcast happens per key:
//! - `Fresh`    — first caller for this key; the handler proceeds to submit.
//! - `InFlight` — another request for the same key is mid-submit; the caller gets 409 (no second send).
//! - `Done(tx)` — a prior settle for this key already broadcast; the caller gets that tx hash back
//!   (HTTP 200, `status:"duplicate"`) WITHOUT re-submitting.
//!
//! On a submit FAILURE the handler calls `release`, so the reservation clears and a later retry can
//! proceed — a failed broadcast is not a completed settle.
//!
//! Scope + limits (documented honestly): this is **per-process** memory, so it protects a single
//! instance against retries/replays; it does NOT dedup across multiple relayer replicas. The on-chain
//! nonce is the ultimate backstop there (two identical settles from one funded key share a nonce, so
//! the chain admits only one). A multi-replica deploy should move this map to Redis — the same
//! `reserve/complete/release` shape maps directly onto an atomic `SET NX` + status key, exactly like
//! `services/edge-auth`'s Redis hold store. Not wired here because the relayer runs single-instance
//! today (one funded key).

use std::collections::HashMap;
use std::sync::Mutex;

use alloy_primitives::B256;

/// The outcome of reserving a key for submission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reserved {
    /// First time this key is seen — proceed to submit.
    Fresh,
    /// A submit for this key is already in flight — do NOT submit again (caller returns 409).
    InFlight,
    /// This key already settled — return the cached tx hash (caller returns 200 `duplicate`).
    Done(B256),
}

#[derive(Debug, Clone)]
enum State {
    InFlight,
    Done(B256),
}

/// Process-local idempotency store. Cheap `Mutex<HashMap>` — the settle path is low-QPS (one funded
/// key, sequential nonces), so lock contention is a non-issue.
#[derive(Default)]
pub struct IdemStore {
    inner: Mutex<HashMap<String, State>>,
}

impl IdemStore {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// Atomically claim `key` for submission. Idempotent: a completed key returns its tx; an in-flight
    /// key returns `InFlight`; a fresh key is marked in-flight and returns `Fresh`.
    pub fn reserve(&self, key: &str) -> Reserved {
        let mut map = self.inner.lock().expect("idem lock");
        match map.get(key) {
            Some(State::Done(tx)) => Reserved::Done(*tx),
            Some(State::InFlight) => Reserved::InFlight,
            None => {
                map.insert(key.to_string(), State::InFlight);
                Reserved::Fresh
            }
        }
    }

    /// Mark a reserved key as completed with its broadcast tx hash.
    pub fn complete(&self, key: &str, tx: B256) {
        let mut map = self.inner.lock().expect("idem lock");
        map.insert(key.to_string(), State::Done(tx));
    }

    /// Clear a reservation after a FAILED submit so a later retry can proceed.
    pub fn release(&self, key: &str) {
        let mut map = self.inner.lock().expect("idem lock");
        // Only clear if still in-flight — never clobber a completed settle.
        if matches!(map.get(key), Some(State::InFlight)) {
            map.remove(key);
        }
    }

    /// Test/seed helper: force a key into the completed state (used by server tests to exercise the
    /// duplicate path without a live chain).
    #[cfg(test)]
    pub fn seed_done(&self, key: &str, tx: B256) {
        self.inner.lock().expect("idem lock").insert(key.to_string(), State::Done(tx));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_then_in_flight_then_done() {
        let s = IdemStore::new();
        assert_eq!(s.reserve("k"), Reserved::Fresh);
        // second concurrent caller sees in-flight
        assert_eq!(s.reserve("k"), Reserved::InFlight);
        let tx = B256::repeat_byte(0x9);
        s.complete("k", tx);
        // now every caller gets the cached tx
        assert_eq!(s.reserve("k"), Reserved::Done(tx));
        assert_eq!(s.reserve("k"), Reserved::Done(tx));
    }

    #[test]
    fn release_allows_retry_after_failure() {
        let s = IdemStore::new();
        assert_eq!(s.reserve("k"), Reserved::Fresh);
        s.release("k"); // submit failed
        // key is free again → a retry is Fresh, not stuck in-flight
        assert_eq!(s.reserve("k"), Reserved::Fresh);
    }

    #[test]
    fn release_never_clobbers_a_completed_settle() {
        let s = IdemStore::new();
        let tx = B256::repeat_byte(0x3);
        s.reserve("k");
        s.complete("k", tx);
        s.release("k"); // must be a no-op — the settle already happened
        assert_eq!(s.reserve("k"), Reserved::Done(tx));
    }

    #[test]
    fn distinct_keys_are_independent() {
        let s = IdemStore::new();
        assert_eq!(s.reserve("a"), Reserved::Fresh);
        assert_eq!(s.reserve("b"), Reserved::Fresh);
    }
}
