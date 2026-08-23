//! Increment 6b — settlement tx **submission**. Takes the `settleSpend` calldata from `settle` and
//! turns it into a broadcastable transaction: build the EIP-1559 tx to the Gateway, sign it with the
//! RELAYER key, and send it via `eth_sendRawTransaction`. A `dry_run` (`eth_call`) proves the calldata
//! dispatches on the live Gateway without a funded wallet.
//!
//! The EIP-1559 encoding is delegated to `alloy-consensus` (canonical RLP + EIP-2718 typed envelope) —
//! signing a money-moving tx by hand is exactly where a silent byte-off bug would live. We only add the
//! secp256k1 signature (same k256 path as the edge signer) and the JSON-RPC transport.
//!
//! Provable without secrets: signing is verified offline by recovering the sender from the signed raw
//! tx and asserting it equals the key's address, plus a canonical key→address vector. The broadcast
//! path is exercised only by a gated test (real `RELAYER_SUBMIT_KEY` + `RELAYER_RPC_URL`), else skipped.

use alloy_consensus::{SignableTransaction, TxEip1559};
use alloy_eips::eip2718::Encodable2718;
use alloy_primitives::{hex, keccak256, Address, Bytes, PrimitiveSignature, TxKind, B256, U256};
use k256::ecdsa::SigningKey;

use crate::settle::{SettleParams, SettlementError};

/// A default gas limit for a settlement when `eth_estimateGas` can't be used (e.g. estimating against
/// a not-yet-valid signature reverts). `settleSpend` burns shares + does two ECDSA recoveries + a
/// transfer — comfortably under this.
pub const DEFAULT_SETTLE_GAS_LIMIT: u64 = 350_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitError {
    BadKey(String),
    Settlement(SettlementError),
    Rpc(String),
    /// The node returned a JSON-RPC `error` object (e.g. nonce too low, insufficient funds).
    Node(String),
    Decode(String),
}
impl std::fmt::Display for SubmitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SubmitError::BadKey(e) => write!(f, "bad relayer key: {e}"),
            SubmitError::Settlement(e) => write!(f, "settlement invalid: {e:?}"),
            SubmitError::Rpc(e) => write!(f, "rpc transport: {e}"),
            SubmitError::Node(e) => write!(f, "node error: {e}"),
            SubmitError::Decode(e) => write!(f, "decode: {e}"),
        }
    }
}
impl std::error::Error for SubmitError {}

/// The relayer's secp256k1 key + its derived address (must hold `RELAYER_ROLE` on the Gateway).
pub struct RelayerKey {
    key: SigningKey,
    address: Address,
}

impl RelayerKey {
    /// Build from a 32-byte hex private key (`0x…` optional).
    pub fn from_hex(key_hex: &str) -> Result<Self, SubmitError> {
        let bytes = hex::decode(key_hex.trim().trim_start_matches("0x"))
            .map_err(|e| SubmitError::BadKey(e.to_string()))?;
        let key = SigningKey::from_slice(&bytes).map_err(|e| SubmitError::BadKey(e.to_string()))?;
        let address = address_from_key(&key);
        Ok(Self { key, address })
    }

    pub fn address(&self) -> Address {
        self.address
    }

    /// Recoverable ECDSA over a 32-byte digest → an alloy `PrimitiveSignature` (y-parity, not 27/28:
    /// EIP-1559 txs carry the boolean parity, unlike the legacy `v` the Gateway's EIP-712 path wants).
    fn sign_hash(&self, digest: B256) -> Result<PrimitiveSignature, SubmitError> {
        let (sig, recid) = self
            .key
            .sign_prehash_recoverable(digest.as_slice())
            .map_err(|e| SubmitError::BadKey(e.to_string()))?;
        let b = sig.to_bytes();
        let r = U256::from_be_slice(&b[..32]);
        let s = U256::from_be_slice(&b[32..]);
        Ok(PrimitiveSignature::new(r, s, recid.is_y_odd()))
    }
}

/// Chain + fee context for one transaction (fetched from the node, or supplied by a caller/test).
#[derive(Debug, Clone, Copy)]
pub struct GasParams {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_fee_per_gas: u128,
    pub max_priority_fee_per_gas: u128,
    pub gas_limit: u64,
}

/// A signed, ready-to-broadcast settlement transaction.
#[derive(Debug, Clone)]
pub struct SignedTx {
    /// EIP-2718 typed-envelope bytes for `eth_sendRawTransaction`.
    pub raw: Vec<u8>,
    /// The transaction hash the node will report.
    pub hash: B256,
    /// Recovered sender (equals the relayer address — asserted in tests).
    pub from: Address,
}

impl SignedTx {
    pub fn raw_hex(&self) -> String {
        format!("0x{}", hex::encode(&self.raw))
    }
}

/// Build + sign an EIP-1559 call to `to` with pre-encoded `input` — the low-level tx assembler both the
/// `settleSpend` and `batchSettleEth` paths share. Value is always zero (both calls are non-payable).
/// Callers validate their own calldata BEFORE signing (never sign a call the contract reverts on).
pub fn build_and_sign_call(
    key: &RelayerKey,
    to: Address,
    input: Vec<u8>,
    gas: &GasParams,
) -> Result<SignedTx, SubmitError> {
    let tx = TxEip1559 {
        chain_id: gas.chain_id,
        nonce: gas.nonce,
        gas_limit: gas.gas_limit,
        max_fee_per_gas: gas.max_fee_per_gas,
        max_priority_fee_per_gas: gas.max_priority_fee_per_gas,
        to: TxKind::Call(to),
        value: U256::ZERO,
        input: Bytes::from(input),
        access_list: Default::default(),
    };
    let sig = key.sign_hash(tx.signature_hash())?;
    let env = alloy_consensus::TxEnvelope::from(tx.into_signed(sig));
    let hash = *env.tx_hash();
    let raw = env.encoded_2718();
    Ok(SignedTx { raw, hash, from: key.address() })
}

/// Build + sign the settlement tx. Validates the Gateway invariants first (never sign a call the
/// contract will revert on structurally), then encodes the canonical EIP-1559 envelope.
pub fn build_and_sign(
    key: &RelayerKey,
    gateway: Address,
    params: &SettleParams,
    gas: &GasParams,
) -> Result<SignedTx, SubmitError> {
    params.validate().map_err(SubmitError::Settlement)?;
    build_and_sign_call(key, gateway, params.calldata(), gas)
}

/// Minimal blocking JSON-RPC client — just the calls the relayer needs (read nonce/fees, dry-run,
/// broadcast). Deliberately not a full provider: the relayer's hot path is thin.
pub struct Rpc {
    url: String,
    /// Built lazily on first use. The blocking client internally owns a runtime, and constructing (or
    /// dropping) that inside an async runtime panics — so `Rpc::new` must be safe to call from anywhere
    /// (e.g. when the server assembles its context in a tokio task). In production the first RPC call
    /// happens inside `tokio::task::spawn_blocking`, where building the blocking client is fine.
    client: std::sync::OnceLock<reqwest::blocking::Client>,
}

impl Rpc {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into(), client: std::sync::OnceLock::new() }
    }

    /// The lazily-initialized blocking HTTP client (see the field note).
    pub(crate) fn client(&self) -> &reqwest::blocking::Client {
        self.client.get_or_init(reqwest::blocking::Client::new)
    }

    fn call(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, SubmitError> {
        let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let resp: serde_json::Value = self
            .client()
            .post(&self.url)
            .json(&body)
            .send()
            .map_err(|e| SubmitError::Rpc(e.to_string()))?
            .json()
            .map_err(|e| SubmitError::Rpc(e.to_string()))?;
        if let Some(err) = resp.get("error") {
            return Err(SubmitError::Node(err.to_string()));
        }
        resp.get("result").cloned().ok_or_else(|| SubmitError::Rpc("no result".into()))
    }

    fn hex_u64(v: &serde_json::Value) -> Result<u64, SubmitError> {
        let s = v.as_str().ok_or_else(|| SubmitError::Decode("expected hex string".into()))?;
        u64::from_str_radix(s.trim_start_matches("0x"), 16).map_err(|e| SubmitError::Decode(e.to_string()))
    }
    fn hex_u128(v: &serde_json::Value) -> Result<u128, SubmitError> {
        let s = v.as_str().ok_or_else(|| SubmitError::Decode("expected hex string".into()))?;
        u128::from_str_radix(s.trim_start_matches("0x"), 16).map_err(|e| SubmitError::Decode(e.to_string()))
    }

    pub fn chain_id(&self) -> Result<u64, SubmitError> {
        Self::hex_u64(&self.call("eth_chainId", serde_json::json!([]))?)
    }

    /// Pending nonce for `addr` — `eth_getTransactionCount(addr, "pending")`.
    pub fn pending_nonce(&self, addr: Address) -> Result<u64, SubmitError> {
        Self::hex_u64(&self.call(
            "eth_getTransactionCount",
            serde_json::json!([format!("{addr:?}"), "pending"]),
        )?)
    }

    pub fn max_priority_fee(&self) -> Result<u128, SubmitError> {
        Self::hex_u128(&self.call("eth_maxPriorityFeePerGas", serde_json::json!([]))?)
    }

    /// Current base fee from the latest block header.
    pub fn base_fee(&self) -> Result<u128, SubmitError> {
        let block = self.call("eth_getBlockByNumber", serde_json::json!(["latest", false]))?;
        let bf = block.get("baseFeePerGas").ok_or_else(|| SubmitError::Decode("no baseFeePerGas".into()))?;
        Self::hex_u128(bf)
    }

    /// Assemble fee params: `maxFee = 2*baseFee + priorityFee` (standard headroom), default gas limit.
    pub fn gas_params(&self, from: Address) -> Result<GasParams, SubmitError> {
        let chain_id = self.chain_id()?;
        let nonce = self.pending_nonce(from)?;
        let priority = self.max_priority_fee()?;
        let base = self.base_fee()?;
        Ok(GasParams {
            chain_id,
            nonce,
            max_fee_per_gas: base.saturating_mul(2).saturating_add(priority),
            max_priority_fee_per_gas: priority,
            gas_limit: DEFAULT_SETTLE_GAS_LIMIT,
        })
    }

    /// Broadcast a signed tx → returns its hash.
    pub fn send_raw(&self, raw: &[u8]) -> Result<B256, SubmitError> {
        let data = format!("0x{}", hex::encode(raw));
        let res = self.call("eth_sendRawTransaction", serde_json::json!([data]))?;
        let s = res.as_str().ok_or_else(|| SubmitError::Decode("expected tx hash".into()))?;
        let bytes = hex::decode(s.trim_start_matches("0x")).map_err(|e| SubmitError::Decode(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(SubmitError::Decode("tx hash not 32 bytes".into()));
        }
        Ok(B256::from_slice(&bytes))
    }
}

/// The outcome of dry-running the calldata against the live Gateway via `eth_call`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DryRun {
    /// `eth_call` returned success (no revert) — the settlement would go through.
    WouldSucceed,
    /// Reverted with this 4-byte selector (hex, `0x…`). A KNOWN Gateway error selector here means the
    /// calldata dispatched + decoded on-chain (e.g. `ECDSAInvalidSignature` on a dummy sig).
    Reverted(String),
}

/// `eth_call` the settlement calldata against the Gateway from `from`, classifying the result. Proves
/// dispatch WITHOUT broadcasting — the calldata reaching the function body and reverting on a business
/// check (not a selector miss) is the encoding proof.
pub fn dry_run(
    rpc: &Rpc,
    gateway: Address,
    from: Address,
    params: &SettleParams,
) -> Result<DryRun, SubmitError> {
    params.validate().map_err(SubmitError::Settlement)?;
    dry_run_call(rpc, gateway, from, params.calldata())
}

/// `eth_call` pre-encoded `input` against `to` from `from`, classifying revert-vs-success. The
/// call-agnostic core of `dry_run` — the `batchSettleEth` path reuses it to prove dispatch on the
/// settlement contract. A KNOWN error selector means the calldata dispatched + decoded on-chain.
pub fn dry_run_call(
    rpc: &Rpc,
    to: Address,
    from: Address,
    input: Vec<u8>,
) -> Result<DryRun, SubmitError> {
    let data = format!("0x{}", hex::encode(input));
    let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{ "from": format!("{from:?}"), "to": format!("{to:?}"), "data": data }, "latest"] });
    let resp: serde_json::Value = rpc
        .client()
        .post(&rpc.url)
        .json(&body)
        .send()
        .map_err(|e| SubmitError::Rpc(e.to_string()))?
        .json()
        .map_err(|e| SubmitError::Rpc(e.to_string()))?;
    match resp.get("error") {
        Some(err) => {
            let sel = err
                .get("data")
                .and_then(|d| d.as_str())
                .map(|s| s.chars().take(10).collect::<String>()) // 0x + 8 hex
                .unwrap_or_default();
            Ok(DryRun::Reverted(sel))
        }
        None => Ok(DryRun::WouldSucceed),
    }
}

/// Full path: fetch chain/fee context, build + sign, broadcast. Used by the relayer worker once a hold
/// is captured and its permit/edge sigs are real.
pub fn submit_settlement(
    rpc: &Rpc,
    key: &RelayerKey,
    gateway: Address,
    params: &SettleParams,
) -> Result<B256, SubmitError> {
    let gas = rpc.gas_params(key.address())?;
    let signed = build_and_sign(key, gateway, params, &gas)?;
    rpc.send_raw(&signed.raw)
}

/// Derive the Ethereum address from a secp256k1 signing key (keccak of the uncompressed pubkey X‖Y).
fn address_from_key(key: &SigningKey) -> Address {
    let vk = key.verifying_key();
    let point = vk.to_encoded_point(false); // 0x04 ‖ X(32) ‖ Y(32)
    let hash = keccak256(&point.as_bytes()[1..]);
    Address::from_slice(&hash[12..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settle::Permit;
    use alloy_eips::eip2718::Decodable2718;

    // Canonical secp256k1 test vector: privkey 0x…01 → this well-known address.
    const KEY_ONE: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const ADDR_ONE: &str = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
    const GATEWAY: &str = "0x26ce3baff473b24e8afe932dfb6d68adca8048b0";

    fn params(relayer: Address) -> SettleParams {
        SettleParams {
            hold_id: B256::repeat_byte(0x01),
            user: relayer,
            assets: 100_000_000,
            receiver: relayer,
            permit: Permit {
                user: relayer,
                max_daily_spend_usdc: 1_000_000_000,
                nonce: U256::from(1u64),
                deadline: U256::from(9_999_999_999u64),
                signature: vec![0x11; 65],
            },
            edge: None,
        }
    }

    fn gas() -> GasParams {
        GasParams {
            chain_id: 84532,
            nonce: 3,
            max_fee_per_gas: 2_000_000_000,
            max_priority_fee_per_gas: 1_000_000_000,
            gas_limit: DEFAULT_SETTLE_GAS_LIMIT,
        }
    }

    #[test]
    fn key_derives_the_canonical_address() {
        let k = RelayerKey::from_hex(KEY_ONE).unwrap();
        assert_eq!(k.address(), ADDR_ONE.parse::<Address>().unwrap());
    }

    #[test]
    fn signed_tx_recovers_to_the_relayer() {
        let k = RelayerKey::from_hex(KEY_ONE).unwrap();
        let gateway: Address = GATEWAY.parse().unwrap();
        let signed = build_and_sign(&k, gateway, &params(k.address()), &gas()).unwrap();
        assert_eq!(signed.from, k.address());
        // The proof: decode the broadcast bytes back into a typed envelope and recover the sender.
        let env = alloy_consensus::TxEnvelope::decode_2718(&mut signed.raw.as_slice()).unwrap();
        assert_eq!(env.recover_signer().unwrap(), k.address());
        // It IS an EIP-1559 (type-2) envelope, to the Gateway.
        assert_eq!(signed.raw[0], 0x02);
    }

    #[test]
    fn signing_is_deterministic() {
        // secp256k1 with RFC-6979 → the same tx signs identically (stable hash for idempotent resend).
        let k = RelayerKey::from_hex(KEY_ONE).unwrap();
        let gateway: Address = GATEWAY.parse().unwrap();
        let a = build_and_sign(&k, gateway, &params(k.address()), &gas()).unwrap();
        let b = build_and_sign(&k, gateway, &params(k.address()), &gas()).unwrap();
        assert_eq!(a.hash, b.hash);
        assert_eq!(a.raw, b.raw);
    }

    #[test]
    fn bumping_the_nonce_changes_the_tx() {
        let k = RelayerKey::from_hex(KEY_ONE).unwrap();
        let gateway: Address = GATEWAY.parse().unwrap();
        let a = build_and_sign(&k, gateway, &params(k.address()), &gas()).unwrap();
        let mut g2 = gas();
        g2.nonce = 4;
        let b = build_and_sign(&k, gateway, &params(k.address()), &g2).unwrap();
        assert_ne!(a.hash, b.hash);
    }

    #[test]
    fn refuses_to_sign_a_structurally_invalid_settlement() {
        let k = RelayerKey::from_hex(KEY_ONE).unwrap();
        let gateway: Address = GATEWAY.parse().unwrap();
        let mut p = params(k.address());
        p.assets = 300_000_000; // high-value, but no edge auth attached
        p.edge = None;
        let err = build_and_sign(&k, gateway, &p, &gas()).unwrap_err();
        assert!(matches!(err, SubmitError::Settlement(SettlementError::EdgeRequired)));
    }
}
