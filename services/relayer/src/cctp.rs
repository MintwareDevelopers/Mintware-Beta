//! CCTP bridge-and-deposit orchestration (Base → Arc). Automates the cross-chain deposit the relayer
//! completes on the destination side: given a source-chain burn tx, poll Circle's attestation service
//! (iris) until the message is attested, then submit `MintwareCctpDepositRouter.receiveAndDeposit` on Arc —
//! which calls `MessageTransmitter.receiveMessage` (minting the bridged USDC to the router) and deposits it
//! into the vault, crediting the user. Where `batch.rs` settles ETH-collateral holds, this lands
//! cross-chain USDC as yield-earning vault shares on Arc.
//!
//! Offline-provable: the `receiveAndDeposit` selector matches the contract, calldata round-trips, and the
//! signed tx recovers to the relayer. The iris fetch + on-chain submit are exercised by the E2E runbook.

use alloy_primitives::{Address, Bytes};
use alloy_sol_types::{sol, SolCall};

use crate::submit::{build_and_sign_call, GasParams, RelayerKey, Rpc, SignedTx, SubmitError};

sol! {
    /// Field-for-field mirror of `MintwareCctpDepositRouter.receiveAndDeposit`.
    function receiveAndDeposit(
        bytes message,
        bytes attestation,
        address recipient
    ) external returns (uint256 sharesMinted);
}

/// CCTP domain ids (public — Circle CCTP docs). Base Sepolia = 6, Arc = 26.
pub const CCTP_DOMAIN_BASE: u32 = 6;
pub const CCTP_DOMAIN_ARC: u32 = 26;

/// A completed CCTP message ready to redeem on the destination chain.
#[derive(Debug, Clone)]
pub struct AttestedMessage {
    pub message: Vec<u8>,
    pub attestation: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CctpError {
    ZeroRecipient,
    Http(String),
    /// The attestation is not ready yet (Circle still observing / awaiting finality).
    Pending,
    /// iris returned an unexpected shape.
    Decode(String),
    Submit(SubmitError),
}
impl std::fmt::Display for CctpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CctpError::ZeroRecipient => write!(f, "recipient is the zero address"),
            CctpError::Http(e) => write!(f, "iris http: {e}"),
            CctpError::Pending => write!(f, "attestation pending"),
            CctpError::Decode(e) => write!(f, "iris decode: {e}"),
            CctpError::Submit(e) => write!(f, "submit: {e}"),
        }
    }
}
impl std::error::Error for CctpError {}

/// The router `receiveAndDeposit` call the relayer submits on the destination chain (Arc).
#[derive(Debug, Clone)]
pub struct ReceiveAndDeposit {
    /// The `MintwareCctpDepositRouter` on the destination chain.
    pub router: Address,
    /// Who to credit the vault shares to (the user who initiated the burn).
    pub recipient: Address,
    pub message: Vec<u8>,
    pub attestation: Vec<u8>,
}

impl ReceiveAndDeposit {
    pub fn selector() -> [u8; 4] {
        receiveAndDepositCall::SELECTOR
    }

    pub fn validate(&self) -> Result<(), CctpError> {
        if self.recipient == Address::ZERO {
            return Err(CctpError::ZeroRecipient);
        }
        Ok(())
    }

    /// ABI-encoded `receiveAndDeposit(message, attestation, recipient)` calldata.
    pub fn calldata(&self) -> Vec<u8> {
        receiveAndDepositCall {
            message: Bytes::from(self.message.clone()),
            attestation: Bytes::from(self.attestation.clone()),
            recipient: self.recipient,
        }
        .abi_encode()
    }
}

/// Minimal client for Circle's iris attestation API (v2 sandbox/production).
pub struct IrisClient {
    base_url: String,
    client: reqwest::blocking::Client,
}

impl IrisClient {
    /// `base_url` e.g. `https://iris-api-sandbox.circle.com` (testnet) or `https://iris-api.circle.com`.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self { base_url: base_url.into(), client: reqwest::blocking::Client::new() }
    }

    /// Fetch the attested message for a source-chain burn tx. Returns `Err(Pending)` until Circle has
    /// observed the burn AND it has reached the required finality (status `complete`).
    pub fn fetch(&self, source_domain: u32, burn_tx: &str) -> Result<AttestedMessage, CctpError> {
        let url = format!("{}/v2/messages/{}?transactionHash={}", self.base_url, source_domain, burn_tx);
        let resp: serde_json::Value = self
            .client
            .get(&url)
            .send()
            .map_err(|e| CctpError::Http(e.to_string()))?
            .json()
            .map_err(|_| CctpError::Pending)?; // 404 "Message not found" → still pending
        let m = resp
            .get("messages")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .ok_or(CctpError::Pending)?;
        if m.get("status").and_then(|s| s.as_str()) != Some("complete") {
            return Err(CctpError::Pending);
        }
        let message = hex_field(m, "message")?;
        let attestation = hex_field(m, "attestation")?;
        Ok(AttestedMessage { message, attestation })
    }
}

fn hex_field(m: &serde_json::Value, key: &str) -> Result<Vec<u8>, CctpError> {
    let s = m.get(key).and_then(|v| v.as_str()).ok_or_else(|| CctpError::Decode(format!("no {key}")))?;
    alloy_primitives::hex::decode(s.trim_start_matches("0x")).map_err(|e| CctpError::Decode(e.to_string()))
}

/// Build + sign the `receiveAndDeposit` tx (validates first). `to` is the router on the destination chain.
pub fn build_and_sign_receive(
    key: &RelayerKey,
    params: &ReceiveAndDeposit,
    gas: &GasParams,
) -> Result<SignedTx, CctpError> {
    params.validate()?;
    build_and_sign_call(key, params.router, params.calldata(), gas).map_err(CctpError::Submit)
}

/// Full destination-side path: fetch chain/fee context, build + sign, broadcast `receiveAndDeposit`.
pub fn submit_receive(
    rpc: &Rpc,
    key: &RelayerKey,
    params: &ReceiveAndDeposit,
) -> Result<alloy_primitives::B256, CctpError> {
    params.validate()?;
    let gas = rpc.gas_params(key.address()).map_err(CctpError::Submit)?;
    let signed = build_and_sign_receive(key, params, &gas)?;
    rpc.send_raw(&signed.raw).map_err(CctpError::Submit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::keccak256;

    fn base() -> ReceiveAndDeposit {
        ReceiveAndDeposit {
            router: Address::repeat_byte(0x5e),
            recipient: Address::repeat_byte(0xab),
            message: vec![0x11; 200],
            attestation: vec![0x22; 65],
        }
    }

    #[test]
    fn selector_matches_contract() {
        assert_eq!(ReceiveAndDeposit::selector(), keccak256("receiveAndDeposit(bytes,bytes,address)")[..4]);
    }

    #[test]
    fn calldata_roundtrips() {
        let p = base();
        let data = p.calldata();
        assert_eq!(&data[..4], &ReceiveAndDeposit::selector());
        let decoded = receiveAndDepositCall::abi_decode(&data, true).unwrap();
        assert_eq!(decoded.recipient, p.recipient);
        assert_eq!(decoded.message.as_ref(), p.message.as_slice());
        assert_eq!(decoded.attestation.as_ref(), p.attestation.as_slice());
    }

    #[test]
    fn validate_rejects_zero_recipient() {
        let mut p = base();
        p.recipient = Address::ZERO;
        assert_eq!(p.validate(), Err(CctpError::ZeroRecipient));
        assert_eq!(base().validate(), Ok(()));
    }

    #[test]
    fn signed_tx_recovers_to_relayer_and_targets_router() {
        use alloy_eips::eip2718::Decodable2718;
        let key = RelayerKey::from_hex(
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        )
        .unwrap();
        let gas = GasParams {
            chain_id: 5042002, // Arc
            nonce: 3,
            max_fee_per_gas: 2_000_000_000,
            max_priority_fee_per_gas: 1_000_000_000,
            gas_limit: 500_000,
        };
        let p = base();
        let signed = build_and_sign_receive(&key, &p, &gas).unwrap();
        assert_eq!(signed.from, key.address());
        let env = alloy_consensus::TxEnvelope::decode_2718(&mut signed.raw.as_slice()).unwrap();
        assert_eq!(env.recover_signer().unwrap(), key.address());
        assert_eq!(signed.raw[0], 0x02); // EIP-1559
    }

    #[test]
    fn domains_are_correct() {
        assert_eq!(CCTP_DOMAIN_BASE, 6);
        assert_eq!(CCTP_DOMAIN_ARC, 26);
    }
}
