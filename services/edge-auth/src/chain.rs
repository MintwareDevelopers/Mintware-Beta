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
    // v1 — MintwareYieldVault (single-asset USDC over Aave).
    function totalAssets() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function shares(address account) external view returns (uint256);
    // v2 — MintwareTreasuryVault. The SENIOR tranche is the card-spendable side; its NAV is what the
    // edge values a charge against (the junior/team leg never backs a senior spend).
    function totalSeniorAssets() external view returns (uint256);
    function totalSeniorShares() external view returns (uint256);
    function seniorShares(address account) external view returns (uint256);
    // shared (IYieldVault) — same selector on both vaults.
    function idleBuffer() external view returns (uint256);
    // Chainlink AggregatorV3 — the ETH/USD push price for volatile-collateral vaults.
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// The `VIRTUAL` inflation offset — a public constant `1e3` on BOTH vaults (v1 `MintwareYieldVault` and
/// v2 `MintwareTreasuryVault` lift the senior share math verbatim), so we never spend an RPC call on it.
const VAULT_VIRTUAL_OFFSET: u128 = 1_000;

/// Which vault ABI the reader speaks. v1 exposes `totalAssets`/`totalShares`/`shares`; v2's payment side
/// is the senior tranche (`totalSeniorAssets`/`totalSeniorShares`/`seniorShares`). `idleBuffer` is common.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKind {
    V1,
    V2,
}

impl VaultKind {
    /// Parse `EDGE_VAULT_KIND` — `v2`/`treasury` → V2, anything else (incl. unset) → V1 (back-compat).
    pub fn from_env_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "v2" | "treasury" => VaultKind::V2,
            _ => VaultKind::V1,
        }
    }
}

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

/// What backs a vault's shares, and (for ETH) where to read the push price + the VaR haircut inputs.
/// Defaults to `Usdc` (the price-free identity); `Eth` flips the multi-collateral seam LIVE for a vault.
#[derive(Debug, Clone)]
pub enum CollateralConfig {
    Usdc,
    Eth {
        /// Chainlink AggregatorV3 feed for the collateral/USD price (e.g. ETH/USD on Base).
        price_feed: Address,
        /// The feed's own decimals (Chainlink ETH/USD = 8) — used to scale the answer to USD 6dp.
        feed_decimals: u8,
        /// VaR haircut inputs (config-tunable; see `crate::haircut`).
        haircut: crate::haircut::HaircutParams,
    },
}

impl CollateralConfig {
    /// Parse from a key→value lookup (env in prod, a map in tests). `EDGE_COLLATERAL`: absent/`usdc` →
    /// `Usdc` (price-free); `eth` REQUIRES a valid `EDGE_PRICE_FEED` (Chainlink) and reads optional
    /// `EDGE_FEED_DECIMALS` (default 8) + the four haircut knobs (`EDGE_COLLATERAL_{VOL_BPS,
    /// MAX_HOLD_SECS,Z_MILLI,SLIP_BPS}`, falling back to `HaircutParams::ETH_DEFAULT`). **Fails CLOSED:**
    /// an `eth` arm with a missing/invalid feed → `Err` — a vault holding ETH must NEVER be valued as
    /// USDC (that would 1:1 over-credit ~3000×). The caller must disable the refresher on `Err`.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<CollateralConfig, String> {
        let kind = get("EDGE_COLLATERAL").map(|s| s.trim().to_ascii_lowercase());
        match kind.as_deref() {
            None | Some("") | Some("usdc") => Ok(CollateralConfig::Usdc),
            Some("eth") => {
                let feed_str = get("EDGE_PRICE_FEED")
                    .ok_or_else(|| "EDGE_COLLATERAL=eth requires EDGE_PRICE_FEED".to_string())?;
                let price_feed = feed_str
                    .trim()
                    .parse::<Address>()
                    .map_err(|_| format!("EDGE_PRICE_FEED is not a valid address: {feed_str}"))?;
                let feed_decimals =
                    get("EDGE_FEED_DECIMALS").and_then(|s| s.trim().parse().ok()).unwrap_or(8u8);
                let d = crate::haircut::HaircutParams::ETH_DEFAULT;
                let haircut = crate::haircut::HaircutParams {
                    vol_annual_bps: get("EDGE_COLLATERAL_VOL_BPS").and_then(|s| s.trim().parse().ok()).unwrap_or(d.vol_annual_bps),
                    max_hold_secs: get("EDGE_COLLATERAL_MAX_HOLD_SECS").and_then(|s| s.trim().parse().ok()).unwrap_or(d.max_hold_secs),
                    z_score_milli: get("EDGE_COLLATERAL_Z_MILLI").and_then(|s| s.trim().parse().ok()).unwrap_or(d.z_score_milli),
                    settlement_slippage_bps: get("EDGE_COLLATERAL_SLIP_BPS").and_then(|s| s.trim().parse().ok()).unwrap_or(d.settlement_slippage_bps),
                };
                Ok(CollateralConfig::Eth { price_feed, feed_decimals, haircut })
            }
            Some(other) => Err(format!("EDGE_COLLATERAL must be 'usdc' or 'eth', got '{other}'")),
        }
    }
}

/// Decode + VALIDATE a Chainlink `latestRoundData` return (5 × 32-byte words:
/// `[roundId, answer, startedAt, updatedAt, answeredInRound]`) → `(answer_positive, updatedAt_secs)`.
/// The standard Chainlink safety checks: a positive answer, a non-zero `updatedAt`, and a COMPLETE round
/// (`answeredInRound >= roundId`, guarding a carried-over stale answer). Any failure (or short data) →
/// `(0, 0)` → the caller yields 0 spendable + a stale-price decline (fail safe), never a bad auth. Pure.
pub fn decode_chainlink_round(bytes: &[u8]) -> (u128, u64) {
    if bytes.len() < 5 * 32 {
        return (0, 0);
    }
    let round_id = U256::from_be_slice(&bytes[0..32]);
    let answer = u128::try_from(U256::from_be_slice(&bytes[32..64])).unwrap_or(0); // non-positive int256 → huge U256 → 0
    let updated_at = u64::try_from(U256::from_be_slice(&bytes[96..128])).unwrap_or(0);
    let answered_in_round = U256::from_be_slice(&bytes[128..160]);
    if answer == 0 || updated_at == 0 || answered_in_round < round_id {
        return (0, 0);
    }
    (answer, updated_at)
}

/// Scale a Chainlink `answer` (feed-native decimals) to USD 6dp. Chainlink ETH/USD is 8dp → ÷100.
/// A non-positive answer arrives as `0` (the caller already floored negatives) → 0 spendable (fail safe).
/// Pure.
pub fn chainlink_answer_to_usd_6dp(answer_positive: u128, feed_decimals: u8) -> u128 {
    if feed_decimals >= 6 {
        answer_positive / 10u128.pow((feed_decimals - 6) as u32)
    } else {
        answer_positive.saturating_mul(10u128.pow((6 - feed_decimals) as u32))
    }
}

/// Reads a single vault over JSON-RPC.
pub struct EthReader {
    http: reqwest::Client,
    rpc_url: String,
    vault: Address,
    kind: VaultKind,
    collateral: CollateralConfig,
}

impl EthReader {
    /// v1 reader (back-compat default). Use `with_kind` for the v2 treasury vault.
    pub fn new(rpc_url: impl Into<String>, vault: Address) -> Self {
        Self::with_kind(rpc_url, vault, VaultKind::V1)
    }

    pub fn with_kind(rpc_url: impl Into<String>, vault: Address, kind: VaultKind) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self { http, rpc_url: rpc_url.into(), vault, kind, collateral: CollateralConfig::Usdc }
    }

    /// Configure this vault as volatile (ETH/LST) collateral — flips the multi-collateral seam live.
    /// The reader will read the Chainlink price + emit a VaR-haircut, staleness-guarded `Eth` snapshot.
    pub fn with_collateral(mut self, collateral: CollateralConfig) -> Self {
        self.collateral = collateral;
        self
    }

    /// `eth_call` the vault with ABI-encoded `data`, returning the raw 32-byte-aligned result.
    async fn eth_call(&self, data: Vec<u8>) -> Result<Vec<u8>, ChainError> {
        self.eth_call_to(self.vault, data).await
    }

    /// `eth_call` against an ARBITRARY address (the vault, or a Chainlink feed for the ETH price).
    async fn eth_call_to(&self, to: Address, data: Vec<u8>) -> Result<Vec<u8>, ChainError> {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{
                "to": format!("0x{}", hex::encode(to.as_slice())),
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
        let (assets_call, shares_call) = match self.kind {
            VaultKind::V1 => (totalAssetsCall {}.abi_encode(), totalSharesCall {}.abi_encode()),
            VaultKind::V2 => (totalSeniorAssetsCall {}.abi_encode(), totalSeniorSharesCall {}.abi_encode()),
        };
        let total_assets = self.read_u256(assets_call).await?;
        let total_shares = self.read_u256(shares_call).await?;
        let idle_buffer = self.read_u256(idleBufferCall {}.abi_encode()).await?;

        // Single-asset USDC → price-free identity. An ETH-collateral vault additionally reads its push
        // price + emits a VaR-haircut, staleness-guarded snapshot (the multi-collateral seam, now wireable).
        let collateral = match &self.collateral {
            CollateralConfig::Usdc => VaultCollateral::Usdc,
            CollateralConfig::Eth { price_feed, feed_decimals, haircut } => {
                let (price_6dp, updated_at) = self.fetch_eth_price(*price_feed, *feed_decimals).await?;
                VaultCollateral::eth_from_model(price_6dp, updated_at, *haircut)
            }
        };

        Ok(NavSnapshot {
            total_assets,
            total_shares,
            virtual_offset: VAULT_VIRTUAL_OFFSET,
            idle_buffer,
            observed_at_secs,
            collateral,
        })
    }

    /// Read the Chainlink push price for an ETH-collateral vault → `(USD 6dp, updatedAt secs)`. The raw
    /// return is 5 words `[roundId, answer, startedAt, updatedAt, answeredInRound]`; a non-positive or
    /// oversize `answer` decodes to 0 → 0 spendable (fail safe), and the price's OWN staleness is enforced
    /// in `ledger::authorize` via `NavSnapshot::price_is_fresh` (`updatedAt` becomes `price_observed_at_secs`).
    async fn fetch_eth_price(&self, feed: Address, feed_decimals: u8) -> Result<(u128, u64), ChainError> {
        let bytes = self.eth_call_to(feed, latestRoundDataCall {}.abi_encode()).await?;
        // Validate the round (positive answer, fresh updatedAt, complete round) — invalid → (0,0) fail safe.
        let (answer, updated_at) = decode_chainlink_round(&bytes);
        Ok((chainlink_answer_to_usd_6dp(answer, feed_decimals), updated_at))
    }

    /// A user's current senior share balance (the card-spendable claim).
    pub async fn fetch_shares(&self, user: Address) -> Result<u128, ChainError> {
        let call = match self.kind {
            VaultKind::V1 => sharesCall { account: user }.abi_encode(),
            VaultKind::V2 => seniorSharesCall { account: user }.abi_encode(),
        };
        self.read_u256(call).await
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
    fn chainlink_price_scales_to_usd_6dp() {
        // ETH/USD Chainlink is 8dp: $2,000 = 2_000e8 → $2,000 in 6dp = 2_000e6.
        assert_eq!(chainlink_answer_to_usd_6dp(200_000_000_000, 8), 2_000_000_000);
        // exact 6dp feed → identity; 18dp → ÷1e12; sub-6dp (2dp) → ×1e4.
        assert_eq!(chainlink_answer_to_usd_6dp(2_000_000_000, 6), 2_000_000_000);
        assert_eq!(chainlink_answer_to_usd_6dp(2_000_000_000_000_000_000_000, 18), 2_000_000_000);
        assert_eq!(chainlink_answer_to_usd_6dp(200_000, 2), 2_000_000_000);
        // fail-safe: a zeroed (non-positive/oversize) answer → 0.
        assert_eq!(chainlink_answer_to_usd_6dp(0, 8), 0);
    }

    fn round_bytes(round_id: u128, answer: u128, updated_at: u64, answered_in_round: u128) -> Vec<u8> {
        let mut b = vec![0u8; 5 * 32];
        b[16..32].copy_from_slice(&round_id.to_be_bytes()); // word 0 roundId (low 16 bytes)
        b[48..64].copy_from_slice(&answer.to_be_bytes()); // word 1 answer
        b[112..128].copy_from_slice(&(updated_at as u128).to_be_bytes()); // word 3 updatedAt
        b[144..160].copy_from_slice(&answered_in_round.to_be_bytes()); // word 4 answeredInRound
        b
    }

    #[test]
    fn chainlink_round_validation_fails_safe() {
        // complete round, positive answer, fresh → passes through.
        assert_eq!(decode_chainlink_round(&round_bytes(10, 200_000_000_000, 1_000, 10)), (200_000_000_000, 1_000));
        // carried-over stale round (answeredInRound < roundId) → (0,0).
        assert_eq!(decode_chainlink_round(&round_bytes(10, 200_000_000_000, 1_000, 9)), (0, 0));
        // zero answer / zero updatedAt (incomplete round) / short data → (0,0).
        assert_eq!(decode_chainlink_round(&round_bytes(10, 0, 1_000, 10)), (0, 0));
        assert_eq!(decode_chainlink_round(&round_bytes(10, 200_000_000_000, 0, 10)), (0, 0));
        assert_eq!(decode_chainlink_round(&[0u8; 100]), (0, 0));
    }

    #[test]
    fn collateral_config_from_lookup_fails_closed() {
        use std::collections::HashMap;
        let map = |pairs: &[(&str, &str)]| {
            let m: HashMap<String, String> =
                pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            move |k: &str| m.get(k).cloned()
        };
        let feed = "0x0000000000000000000000000000000000000abc";

        // default / explicit usdc → Usdc.
        assert!(matches!(CollateralConfig::from_lookup(map(&[])).unwrap(), CollateralConfig::Usdc));
        assert!(matches!(CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "usdc")])).unwrap(), CollateralConfig::Usdc));

        // eth + valid feed → Eth with default 8dp + ETH_DEFAULT haircut.
        match CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "eth"), ("EDGE_PRICE_FEED", feed)])).unwrap() {
            CollateralConfig::Eth { feed_decimals, haircut, .. } => {
                assert_eq!(feed_decimals, 8);
                assert_eq!(haircut, crate::haircut::HaircutParams::ETH_DEFAULT);
            }
            _ => panic!("expected Eth"),
        }

        // eth WITHOUT a feed, or with a bad feed, or an unknown kind → Err (fail closed, never Usdc).
        assert!(CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "eth")])).is_err());
        assert!(CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "eth"), ("EDGE_PRICE_FEED", "nope")])).is_err());
        assert!(CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "btc")])).is_err());

        // a haircut knob override reaches the params.
        match CollateralConfig::from_lookup(map(&[("EDGE_COLLATERAL", "eth"), ("EDGE_PRICE_FEED", feed), ("EDGE_COLLATERAL_MAX_HOLD_SECS", "2592000")])).unwrap() {
            CollateralConfig::Eth { haircut, .. } => assert_eq!(haircut.max_hold_secs, 2_592_000),
            _ => panic!("expected Eth"),
        }
    }

    #[test]
    fn call_encoding_has_the_right_selectors() {
        // keccak256(sig)[..4] — proves the ABI wiring (and each signature string) without a node.
        // v1
        assert_eq!(hex::encode(&totalAssetsCall {}.abi_encode()[..4]), "01e1d114");
        assert_eq!(hex::encode(&totalSharesCall {}.abi_encode()[..4]), "3a98ef39");
        // v2 (MintwareTreasuryVault senior tranche)
        assert_eq!(hex::encode(&totalSeniorAssetsCall {}.abi_encode()[..4]), "df43a90f");
        assert_eq!(hex::encode(&totalSeniorSharesCall {}.abi_encode()[..4]), "5499afe2");
        // shared
        assert_eq!(hex::encode(&idleBufferCall {}.abi_encode()[..4]), "671d3e00");
        // per-user share getters encode selector + 32-byte-padded address.
        let a: Address = "0x000000000000000000000000000000000000dEaD".parse().unwrap();
        let enc = sharesCall { account: a }.abi_encode();
        assert_eq!(enc.len(), 4 + 32);
        assert!(hex::encode(&enc).ends_with("000000000000000000000000000000000000dead"));
        let enc2 = seniorSharesCall { account: a }.abi_encode();
        assert_eq!(hex::encode(&enc2[..4]), "6e4a7e08"); // seniorShares(address)
        assert!(hex::encode(&enc2).ends_with("000000000000000000000000000000000000dead"));
    }

    #[test]
    fn vault_kind_parses_from_env() {
        assert_eq!(VaultKind::from_env_str("v2"), VaultKind::V2);
        assert_eq!(VaultKind::from_env_str("TREASURY"), VaultKind::V2);
        assert_eq!(VaultKind::from_env_str("v1"), VaultKind::V1);
        assert_eq!(VaultKind::from_env_str(""), VaultKind::V1); // unset → v1 back-compat
        assert_eq!(VaultKind::from_env_str("garbage"), VaultKind::V1);
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
        // Defaults to the live v1 vault; override with EDGE_VAULT_ADDRESS + EDGE_VAULT_KIND=v2 to
        // validate against a deployed v2 treasury vault.
        let vault: Address = std::env::var("EDGE_VAULT_ADDRESS")
            .unwrap_or_else(|_| "0x7d92083dc80627d89a2ced1d911ac2bc1eb2b4df".into())
            .parse()
            .expect("EDGE_VAULT_ADDRESS");
        let kind = VaultKind::from_env_str(&std::env::var("EDGE_VAULT_KIND").unwrap_or_default());
        let reader = EthReader::with_kind(rpc, vault, kind);
        let nav = reader.fetch_nav(1_234_567).await.expect("fetch_nav");
        assert_eq!(nav.virtual_offset, 1_000);
        assert_eq!(nav.observed_at_secs, 1_234_567);
        // Solvency-by-construction: totalShares <= totalAssets (+ the virtual offset). Holds even empty.
        assert!(nav.total_shares <= nav.total_assets.saturating_add(1_000));
        eprintln!("live NAV: assets={} shares={} idle={}", nav.total_assets, nav.total_shares, nav.idle_buffer);
    }
}
