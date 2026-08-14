//! On-chain reader (increment 4) — pulls the vault's NAV + a user's shares over plain JSON-RPC
//! (`eth_call`), so the refresher can keep the hot-path cache fresh. Light path: `alloy-sol-types`
//! encodes/decodes the calls, `reqwest` does the HTTP — no full provider stack.

use std::fmt;
use std::time::Duration;

use alloy_primitives::{hex, Address, U256};
use alloy_sol_types::{sol, SolCall};
use serde_json::json;

use crate::nav::{NavSnapshot, VaultCollateral};

sol! {
    function totalAssets() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function idleBuffer() external view returns (uint256);
    function shares(address account) external view returns (uint256);
}

/// `MintwareYieldVault.VIRTUAL` — a public constant (1e3), so we don't spend an RPC call reading it.
const VAULT_VIRTUAL_OFFSET: u128 = 1_000;

#[derive(Debug)]
pub enum ChainError {
    Http(String),
    Rpc(String),
    Decode(String),
    Overflow,
}

impl fmt::Display for ChainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChainError::Http(e) => write!(f, "http error: {e}"),
            ChainError::Rpc(e) => write!(f, "rpc error: {e}"),
            ChainError::Decode(e) => write!(f, "decode error: {e}"),
            ChainError::Overflow => write!(f, "u256 value does not fit u128"),
        }
    }
}
impl std::error::Error for ChainError {}

/// Reads a single vault over JSON-RPC.
pub struct EthReader {
    http: reqwest::Client,
    rpc_url: String,
    vault: Address,
}

impl EthReader {
    pub fn new(rpc_url: impl Into<String>, vault: Address) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self { http, rpc_url: rpc_url.into(), vault }
    }

    /// `eth_call` the vault with ABI-encoded `data`, returning the raw 32-byte-aligned result.
    async fn eth_call(&self, data: Vec<u8>) -> Result<Vec<u8>, ChainError> {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{
                "to": format!("0x{}", hex::encode(self.vault.as_slice())),
                "data": format!("0x{}", hex::encode(&data)),
            }, "latest"],
        });
        let resp: serde_json::Value = self
            .http
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ChainError::Http(e.to_string()))?
            .json()
            .await
            .map_err(|e| ChainError::Http(e.to_string()))?;

        if let Some(err) = resp.get("error") {
            return Err(ChainError::Rpc(err.to_string()));
        }
        let result = resp
            .get("result")
            .and_then(|r| r.as_str())
            .ok_or_else(|| ChainError::Decode("missing result".into()))?;
        hex::decode(result.trim_start_matches("0x")).map_err(|e| ChainError::Decode(e.to_string()))
    }

    /// Decode a single `uint256` view result to `u128` (realistic vault magnitudes fit).
    async fn read_u256(&self, data: Vec<u8>) -> Result<u128, ChainError> {
        let bytes = self.eth_call(data).await?;
        if bytes.len() < 32 {
            return Err(ChainError::Decode(format!("short result: {} bytes", bytes.len())));
        }
        let v = U256::from_be_slice(&bytes[..32]);
        u128::try_from(v).map_err(|_| ChainError::Overflow)
    }

    /// Snapshot the vault's NAV. `observed_at_secs` is stamped by the caller (wall clock at fetch), so
    /// the store's freshness guard measures "time since we refreshed", not block time.
    pub async fn fetch_nav(&self, observed_at_secs: u64) -> Result<NavSnapshot, ChainError> {
        let total_assets = self.read_u256(totalAssetsCall {}.abi_encode()).await?;
        let total_shares = self.read_u256(totalSharesCall {}.abi_encode()).await?;
        let idle_buffer = self.read_u256(idleBufferCall {}.abi_encode()).await?;
        Ok(NavSnapshot {
            total_assets,
            total_shares,
            virtual_offset: VAULT_VIRTUAL_OFFSET,
            idle_buffer,
            observed_at_secs,
            // The v1 vault is single-asset USDC → price-free. Multi-collateral is a dark seam.
            collateral: VaultCollateral::Usdc,
        })
    }

    /// A user's current vault share balance.
    pub async fn fetch_shares(&self, user: Address) -> Result<u128, ChainError> {
        self.read_u256(sharesCall { account: user }.abi_encode()).await
    }

    pub fn vault(&self) -> Address {
        self.vault
    }
}

/// Lowercase 0x-hex of an address — the canonical store key (matches what `/authorize` sends).
pub fn addr_key(a: &Address) -> String {
    format!("0x{}", hex::encode(a.as_slice()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_encoding_has_the_right_selectors() {
        // keccak256("totalAssets()")[..4] = 0x01e1d114, etc. — proves the ABI wiring without a node.
        assert_eq!(hex::encode(&totalAssetsCall {}.abi_encode()[..4]), "01e1d114");
        assert_eq!(hex::encode(&totalSharesCall {}.abi_encode()[..4]), "3a98ef39");
        // shares(address) encodes selector + 32-byte-padded address.
        let a: Address = "0x000000000000000000000000000000000000dEaD".parse().unwrap();
        let enc = sharesCall { account: a }.abi_encode();
        assert_eq!(enc.len(), 4 + 32);
        assert!(hex::encode(&enc).ends_with("000000000000000000000000000000000000dead"));
    }

    #[test]
    fn addr_key_is_lowercase_hex() {
        let a: Address = "0x7d92083DC80627D89a2CeD1D911AC2BC1EB2B4dF".parse().unwrap();
        assert_eq!(addr_key(&a), "0x7d92083dc80627d89a2ced1d911ac2bc1eb2b4df");
    }

    // Live read against the deployed Base Sepolia vault. Self-skips unless EDGE_RPC_URL is set.
    #[tokio::test]
    async fn fetch_nav_from_live_vault() {
        let rpc = match std::env::var("EDGE_RPC_URL") {
            Ok(u) => u,
            Err(_) => {
                eprintln!("skip fetch_nav_from_live_vault: set EDGE_RPC_URL to run");
                return;
            }
        };
        let vault: Address = "0x7d92083dc80627d89a2ced1d911ac2bc1eb2b4df".parse().unwrap();
        let reader = EthReader::new(rpc, vault);
        let nav = reader.fetch_nav(1_234_567).await.expect("fetch_nav");
        assert_eq!(nav.virtual_offset, 1_000);
        assert_eq!(nav.observed_at_secs, 1_234_567);
        // Solvency-by-construction: totalShares <= totalAssets (+ the virtual offset). Holds even empty.
        assert!(nav.total_shares <= nav.total_assets.saturating_add(1_000));
        eprintln!("live NAV: assets={} shares={} idle={}", nav.total_assets, nav.total_shares, nav.idle_buffer);
    }
}
