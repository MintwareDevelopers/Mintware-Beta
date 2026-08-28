//! The `settleSpend` calldata core. Encodes the exact call `MintwarePaymentGateway.settleSpend`
//! expects — including its two nested structs — and validates the high-value invariants the Gateway
//! re-checks, so a malformed settlement is caught here, not by an on-chain revert.

use alloy_primitives::{Address, Bytes, B256, U256};
use alloy_sol_types::{sol, SolCall};

sol! {
    /// Field-for-field mirror of the Gateway structs (order + types matter for the ABI encoding).
    struct DelegatedSpendPermit {
        address user;
        uint256 maxDailySpendUSDC;
        uint256 nonce;
        uint256 deadline;
    }
    struct ShortLivedHoldAuth {
        bytes32 holdId;
        address user;
        uint256 amountUSDC;
        uint256 nonce;
        uint256 expiry;
    }
    function settleSpend(
        bytes32 holdId,
        address user,
        uint256 assets,
        address receiver,
        DelegatedSpendPermit permit,
        bytes permitSig,
        ShortLivedHoldAuth edgeAuth,
        bytes edgeSig
    ) external returns (uint256 sharesBurned);
}

/// The Gateway's `HIGH_VALUE_THRESHOLD` ($250.00, 6dp) — at/above this an edge auth is required.
pub const HIGH_VALUE_THRESHOLD: u128 = 250_000_000;

/// The user's long-lived delegated permit (from the permit store) + its EIP-712 signature.
#[derive(Debug, Clone)]
pub struct Permit {
    pub user: Address,
    pub max_daily_spend_usdc: u128,
    pub nonce: U256,
    pub deadline: U256,
    pub signature: Vec<u8>,
}

/// The edge's short-lived high-value authorization (from `/authorize`'s `edge_auth`).
#[derive(Debug, Clone)]
pub struct EdgeAuth {
    pub hold_id: B256,
    pub user: Address,
    pub amount_usdc: u128,
    pub nonce: U256,
    pub expiry: U256,
    pub signature: Vec<u8>,
}

/// Everything the relayer needs to settle one hold on-chain.
#[derive(Debug, Clone)]
pub struct SettleParams {
    pub hold_id: B256,
    pub user: Address,
    pub assets: u128,
    pub receiver: Address,
    pub permit: Permit,
    /// `Some` for charges >= `HIGH_VALUE_THRESHOLD`; `None` for the permit-only path.
    pub edge: Option<EdgeAuth>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettlementError {
    ZeroAmount,
    /// A high-value charge with no edge auth attached.
    EdgeRequired,
    /// The edge auth's (holdId, user, amount) don't match the settlement — the Gateway would revert.
    EdgeMismatch,
}

impl SettleParams {
    pub fn selector() -> [u8; 4] {
        settleSpendCall::SELECTOR
    }

    /// Mirror the Gateway's pre-flight checks so we never submit a call it will revert.
    pub fn validate(&self) -> Result<(), SettlementError> {
        if self.assets == 0 {
            return Err(SettlementError::ZeroAmount);
        }
        if self.assets >= HIGH_VALUE_THRESHOLD {
            let e = self.edge.as_ref().ok_or(SettlementError::EdgeRequired)?;
            // The Gateway checks edgeAuth.holdId==holdId && user==user && amountUSDC==assets.
            if e.hold_id != self.hold_id || e.user != self.user || e.amount_usdc != self.assets {
                return Err(SettlementError::EdgeMismatch);
            }
        }
        Ok(())
    }

    /// The ABI-encoded `settleSpend` calldata. Validate first — this always encodes *something*.
    pub fn calldata(&self) -> Vec<u8> {
        let permit = DelegatedSpendPermit {
            user: self.permit.user,
            maxDailySpendUSDC: U256::from(self.permit.max_daily_spend_usdc),
            nonce: self.permit.nonce,
            deadline: self.permit.deadline,
        };
        let (edge_auth, edge_sig) = match &self.edge {
            Some(e) => (
                ShortLivedHoldAuth {
                    holdId: e.hold_id,
                    user: e.user,
                    amountUSDC: U256::from(e.amount_usdc),
                    nonce: e.nonce,
                    expiry: e.expiry,
                },
                Bytes::from(e.signature.clone()),
            ),
            // permit-only path: the Gateway skips the edge branch, so a zero struct + empty sig.
            None => (
                ShortLivedHoldAuth {
                    holdId: B256::ZERO,
                    user: Address::ZERO,
                    amountUSDC: U256::ZERO,
                    nonce: U256::ZERO,
                    expiry: U256::ZERO,
                },
                Bytes::new(),
            ),
        };
        settleSpendCall {
            holdId: self.hold_id,
            user: self.user,
            assets: U256::from(self.assets),
            receiver: self.receiver,
            permit,
            permitSig: Bytes::from(self.permit.signature.clone()),
            edgeAuth: edge_auth,
            edgeSig: edge_sig,
        }
        .abi_encode()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::keccak256;

    fn addr(b: u8) -> Address {
        Address::repeat_byte(b)
    }
    fn base_permit() -> Permit {
        Permit { user: addr(0x11), max_daily_spend_usdc: 1_000_000_000, nonce: U256::from(7u64), deadline: U256::from(9_999u64), signature: vec![0xaa; 65] }
    }
    fn low_value() -> SettleParams {
        SettleParams { hold_id: B256::repeat_byte(0x01), user: addr(0x11), assets: 100_000_000, receiver: addr(0x22), permit: base_permit(), edge: None }
    }
    fn edge_for(p: &SettleParams) -> EdgeAuth {
        EdgeAuth { hold_id: p.hold_id, user: p.user, amount_usdc: p.assets, nonce: U256::from(1u64), expiry: U256::from(5_240u64), signature: vec![0xbb; 65] }
    }

    #[test]
    fn selector_matches_the_contract_signature() {
        let sig = "settleSpend(bytes32,address,uint256,address,(address,uint256,uint256,uint256),bytes,(bytes32,address,uint256,uint256,uint256),bytes)";
        assert_eq!(SettleParams::selector(), keccak256(sig)[..4]);
    }

    #[test]
    fn low_value_calldata_roundtrips_with_empty_edge() {
        let p = low_value();
        let data = p.calldata();
        assert_eq!(&data[..4], &SettleParams::selector());
        let decoded = settleSpendCall::abi_decode(&data).unwrap();
        assert_eq!(decoded.holdId, p.hold_id);
        assert_eq!(decoded.user, p.user);
        assert_eq!(decoded.assets, U256::from(p.assets));
        assert_eq!(decoded.receiver, p.receiver);
        assert_eq!(decoded.permit.maxDailySpendUSDC, U256::from(1_000_000_000u64));
        assert_eq!(decoded.permitSig.as_ref(), &[0xaa; 65]);
        // permit-only: empty edge sig + zeroed edge struct.
        assert!(decoded.edgeSig.is_empty());
        assert_eq!(decoded.edgeAuth.holdId, B256::ZERO);
    }

    #[test]
    fn high_value_calldata_carries_the_edge_auth() {
        let mut p = low_value();
        p.assets = 300_000_000; // >= $250
        p.edge = Some(edge_for(&p));
        let data = p.calldata();
        let decoded = settleSpendCall::abi_decode(&data).unwrap();
        assert_eq!(decoded.edgeAuth.holdId, p.hold_id);
        assert_eq!(decoded.edgeAuth.amountUSDC, U256::from(300_000_000u64));
        assert_eq!(decoded.edgeSig.as_ref(), &[0xbb; 65]);
    }

    #[test]
    fn validate_enforces_the_gateway_invariants() {
        // zero amount
        let mut z = low_value();
        z.assets = 0;
        assert_eq!(z.validate(), Err(SettlementError::ZeroAmount));

        // low-value permit-only is fine
        assert_eq!(low_value().validate(), Ok(()));

        // high-value with no edge → EdgeRequired
        let mut hv = low_value();
        hv.assets = 300_000_000;
        assert_eq!(hv.validate(), Err(SettlementError::EdgeRequired));

        // high-value with a mismatched edge amount → EdgeMismatch
        let mut bad = hv.clone();
        let mut e = edge_for(&bad);
        e.amount_usdc = 299_000_000;
        bad.edge = Some(e);
        assert_eq!(bad.validate(), Err(SettlementError::EdgeMismatch));

        // high-value with a matching edge → ok
        let mut good = hv.clone();
        good.edge = Some(edge_for(&good));
        assert_eq!(good.validate(), Ok(()));
    }
}
