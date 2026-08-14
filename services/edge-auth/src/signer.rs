//! EDGE_SIGNER (increment 5). Charges ≥ $250 need a short-lived edge authorization: the Gateway's
//! high-value branch recovers an EIP-712 `ShortLivedHoldAuth` signature and checks the recovered
//! address holds `EDGE_SIGNER_ROLE`. This module signs exactly that struct with the edge's secp256k1
//! key, over the SAME EIP-712 domain the Gateway uses (`"Mintware Payment Gateway"`, `"2.0"`).
//!
//! Fully verifiable offline: we sign a digest, then recover the address from the signature and assert
//! it equals the signer — so a signature that passes here is one the Gateway accepts on-chain.

use alloy_primitives::{keccak256, hex, Address, B256, U256};
use alloy_sol_types::{eip712_domain, sol, Eip712Domain, SolStruct};
use k256::ecdsa::SigningKey;

sol! {
    /// MUST match `MintwarePaymentGateway.ShortLivedHoldAuth` field-for-field, or the derived
    /// type hash (and thus the digest the Gateway recovers against) diverges.
    struct ShortLivedHoldAuth {
        bytes32 holdId;
        address user;
        uint256 amountUSDC;
        uint256 nonce;
        uint256 expiry;
    }
}

/// $250.00 (6dp) — the Gateway's `HIGH_VALUE_THRESHOLD`. At/above this, an edge sig is required.
pub const HIGH_VALUE_THRESHOLD: u128 = 250_000_000;
/// The Gateway's `MAX_SHORT_LIVED_WINDOW` (5 min). Our expiry must land within `[settle, settle+300s]`,
/// so we pick a default window comfortably under it and settle promptly.
pub const MAX_SHORT_LIVED_WINDOW_SECS: u64 = 300;
/// Default validity we stamp on an edge auth (leaves settle headroom under the 5-min cap).
pub const DEFAULT_EDGE_WINDOW_SECS: u64 = 240;

#[derive(Debug)]
pub enum SignerError {
    BadKey(String),
    Sign(String),
}
impl std::fmt::Display for SignerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SignerError::BadKey(e) => write!(f, "bad edge signer key: {e}"),
            SignerError::Sign(e) => write!(f, "edge sign failed: {e}"),
        }
    }
}
impl std::error::Error for SignerError {}

/// A signed edge authorization, ready for the relayer to thread into `settleSpend`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedEdgeAuth {
    pub hold_id: B256,
    pub user: Address,
    pub amount_usdc: U256,
    pub nonce: U256,
    pub expiry: U256,
    /// 65-byte `r‖s‖v` with `v ∈ {27,28}` (what OZ `ECDSA.recover` expects).
    pub signature: [u8; 65],
}

impl SignedEdgeAuth {
    pub fn signature_hex(&self) -> String {
        format!("0x{}", hex::encode(self.signature))
    }
}

/// Holds the edge key + the fixed EIP-712 domain (bound to the Gateway address + chain).
pub struct EdgeSigner {
    key: SigningKey,
    address: Address,
    domain: Eip712Domain,
}

impl EdgeSigner {
    /// Build from a 32-byte hex private key (`0x…` optional) and the Gateway coordinates.
    pub fn from_hex_key(key_hex: &str, gateway: Address, chain_id: u64) -> Result<Self, SignerError> {
        let bytes = hex::decode(key_hex.trim().trim_start_matches("0x")).map_err(|e| SignerError::BadKey(e.to_string()))?;
        let key = SigningKey::from_slice(&bytes).map_err(|e| SignerError::BadKey(e.to_string()))?;
        let address = address_from_key(&key);
        let domain = eip712_domain! {
            name: "Mintware Payment Gateway",
            version: "2.0",
            chain_id: chain_id,
            verifying_contract: gateway,
        };
        Ok(Self { key, address, domain })
    }

    /// The signer's address — must be granted `EDGE_SIGNER_ROLE` on the Gateway for its sigs to pass.
    pub fn address(&self) -> Address {
        self.address
    }

    /// The EIP-712 digest the Gateway will recover against (exposed for tests / cross-checks).
    pub fn digest(&self, auth: &ShortLivedHoldAuth) -> B256 {
        auth.eip712_signing_hash(&self.domain)
    }

    /// Sign a `ShortLivedHoldAuth`. `now_secs`/`window_secs` set the expiry; `nonce` need not be unique
    /// on-chain (replay is stopped by `holds[holdId].settled`) but we derive a fresh one per call.
    pub fn sign(
        &self,
        hold_id: B256,
        user: Address,
        amount_usdc: u128,
        now_secs: u64,
        window_secs: u64,
    ) -> Result<SignedEdgeAuth, SignerError> {
        let expiry = now_secs.saturating_add(window_secs.min(MAX_SHORT_LIVED_WINDOW_SECS));
        // nonce: deterministic-but-fresh from the hold + expiry (informational only to the Gateway —
        // replay is stopped on-chain by `holds[holdId].settled`, not by the nonce).
        let mut seed = hold_id.0.to_vec();
        seed.extend_from_slice(&expiry.to_be_bytes());
        let nonce = U256::from_be_bytes(keccak256(&seed).0);

        let auth = ShortLivedHoldAuth {
            holdId: hold_id,
            user,
            amountUSDC: U256::from(amount_usdc),
            nonce,
            expiry: U256::from(expiry),
        };
        let digest = auth.eip712_signing_hash(&self.domain);

        let (sig, recid) = self
            .key
            .sign_prehash_recoverable(digest.as_slice())
            .map_err(|e| SignerError::Sign(e.to_string()))?;

        let mut signature = [0u8; 65];
        signature[..64].copy_from_slice(&sig.to_bytes());
        signature[64] = 27 + recid.to_byte(); // Ethereum v = 27 + recovery id

        Ok(SignedEdgeAuth {
            hold_id,
            user,
            amount_usdc: auth.amountUSDC,
            nonce,
            expiry: auth.expiry,
            signature,
        })
    }
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
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    const GATEWAY: &str = "0x26ce3baff473b24e8afe932dfb6d68adca8048b0";
    // A throwaway test key (NOT a real key).
    const KEY: &str = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const CHAIN: u64 = 84532;

    fn signer() -> EdgeSigner {
        EdgeSigner::from_hex_key(KEY, GATEWAY.parse().unwrap(), CHAIN).unwrap()
    }

    #[test]
    fn type_hash_matches_the_contract() {
        // The Gateway's SHORT_LIVED_HOLD_AUTH_TYPEHASH string, hashed independently.
        let expected = keccak256("ShortLivedHoldAuth(bytes32 holdId,address user,uint256 amountUSDC,uint256 nonce,uint256 expiry)");
        assert_eq!(ShortLivedHoldAuth::eip712_type_hash(&sample()).as_slice(), expected.as_slice());
    }

    fn sample() -> ShortLivedHoldAuth {
        ShortLivedHoldAuth {
            holdId: B256::repeat_byte(0xab),
            user: "0x000000000000000000000000000000000000dEaD".parse().unwrap(),
            amountUSDC: U256::from(300_000_000u64),
            nonce: U256::from(1u64),
            expiry: U256::from(2u64),
        }
    }

    #[test]
    fn sign_then_recover_yields_the_signer_address() {
        let s = signer();
        let hold: B256 = keccak256("hold-xyz");
        let user: Address = "0x000000000000000000000000000000000000dEaD".parse().unwrap();
        let signed = s.sign(hold, user, 300_000_000, 1_000, DEFAULT_EDGE_WINDOW_SECS).unwrap();

        // Reconstruct the digest and recover — must equal the signer's address (i.e. the Gateway would
        // accept this signature and find EDGE_SIGNER_ROLE on `s.address()`).
        let auth = ShortLivedHoldAuth {
            holdId: signed.hold_id,
            user: signed.user,
            amountUSDC: signed.amount_usdc,
            nonce: signed.nonce,
            expiry: signed.expiry,
        };
        let digest = s.digest(&auth);
        let sig = Signature::from_slice(&signed.signature[..64]).unwrap();
        let recid = RecoveryId::from_byte(signed.signature[64] - 27).unwrap();
        let vk = VerifyingKey::recover_from_prehash(digest.as_slice(), &sig, recid).unwrap();
        let recovered = {
            let p = vk.to_encoded_point(false);
            let h = keccak256(&p.as_bytes()[1..]);
            Address::from_slice(&h[12..])
        };
        assert_eq!(recovered, s.address(), "recovered signer must match");
    }

    #[test]
    fn v_is_ethereum_style_and_fields_are_preserved() {
        let s = signer();
        let hold: B256 = keccak256("h1");
        let user: Address = "0x000000000000000000000000000000000000dEaD".parse().unwrap();
        let signed = s.sign(hold, user, HIGH_VALUE_THRESHOLD, 5_000, DEFAULT_EDGE_WINDOW_SECS).unwrap();
        assert!(signed.signature[64] == 27 || signed.signature[64] == 28, "v must be 27/28");
        assert_eq!(signed.hold_id, hold);
        assert_eq!(signed.user, user);
        assert_eq!(signed.amount_usdc, U256::from(HIGH_VALUE_THRESHOLD));
        // expiry within the contract's 5-min window from `now`.
        assert_eq!(signed.expiry, U256::from(5_000u64 + DEFAULT_EDGE_WINDOW_SECS));
    }

    const _: () = assert!(DEFAULT_EDGE_WINDOW_SECS <= MAX_SHORT_LIVED_WINDOW_SECS); // compile-time invariant

    #[test]
    fn window_is_capped_at_the_contract_max() {
        let s = signer();
        let signed = s.sign(keccak256("h"), "0x000000000000000000000000000000000000dEaD".parse().unwrap(), 300_000_000, 1_000, 99_999).unwrap();
        assert_eq!(signed.expiry, U256::from(1_000u64 + MAX_SHORT_LIVED_WINDOW_SECS)); // clamped
    }

    #[test]
    fn rejects_malformed_key() {
        assert!(EdgeSigner::from_hex_key("nothex", GATEWAY.parse().unwrap(), CHAIN).is_err());
        assert!(EdgeSigner::from_hex_key("0x1234", GATEWAY.parse().unwrap(), CHAIN).is_err()); // too short
    }
}
