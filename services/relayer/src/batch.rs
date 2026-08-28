//! Phase 2 of the ETH-settlement path (`docs/developers/eth-settlement-swap-spec.md`): the relayer's
//! **batch ETH→USDC settle** call. Groups the settling holds for ONE ETH-collateral vault, sums them into
//! `totalUsdc`, derives a conservative `minUsdcOut` swap floor, and encodes the
//! `MintwareEthSettlement.batchSettleEth(totalUsdc, minUsdcOut, rail)` call — the on-chain half built +
//! Forge-proven as `contracts-v4/src/payments/MintwareEthSettlement.sol`.
//!
//! Where `settle.rs` settles ONE hold against the USDC Gateway (`settleSpend`), this settles a BATCH of
//! holds backed by ETH collateral: the on-chain contract swaps WETH→USDC (oracle-bounded) to produce
//! `totalUsdc` and pays the rail, with the junior first-loss buffer covering any bounded-swap shortfall.
//!
//! COHERENCE WITH THE HAIRCUT (do NOT lose this): the `minUsdcOut` floor is `totalUsdc` less the SAME
//! `settlement_slippage_bps` the off-chain VaR haircut `γ` reserved (`services/edge-auth/src/haircut.rs`).
//! So the swap floor the relayer submits is exactly the slippage the edge already priced into the user's
//! spendable limit — a swap under it is a move beyond γ (the junior first-loss event), which the contract
//! declines to burn junior on (reverts, retry next window). The auth-time γ covers multi-day drawdown; this
//! settlement-time floor is only the immediate conversion slippage, so it is tight (tens–hundreds of bps),
//! not the full multi-day haircut.
//!
//! Offline-provable: selectors match the contract, the min-out math is pure + tested, and the signed batch
//! tx recovers to the relayer. A funded broadcast / live dry-run is deploy-gated on the settlement contract
//! going on-chain (the ETH-collateral VAULT is live on Base Sepolia; the settlement contract is not yet).

use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{sol, SolCall};

use crate::submit::{
    build_and_sign_call, dry_run_call, DryRun, GasParams, RelayerKey, Rpc, SignedTx, SubmitError,
};

sol! {
    /// Field-for-field mirror of `MintwareEthSettlement.batchSettleEth` (types + order matter for the ABI).
    function batchSettleEth(
        uint256 totalUsdc,
        uint256 minUsdcOut,
        address rail
    ) external returns (uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn);
}

/// One settling hold in the batch. `amount_usdc` (6dp) is what the user spent under this hold; `hold_id`
/// is carried for traceability/logging (the on-chain batch call takes only the summed total, not the ids).
#[derive(Debug, Clone)]
pub struct Hold {
    pub hold_id: B256,
    pub amount_usdc: u128,
}

/// Everything the relayer needs to settle a batch of ETH-collateral holds on-chain.
#[derive(Debug, Clone)]
pub struct BatchSettleParams {
    /// The `MintwareEthSettlement` contract for this ETH vault (the tx `to`).
    pub settlement: Address,
    /// The rail / Gateway settlement address the produced USDC is paid to.
    pub rail: Address,
    /// The settling holds (summed into `totalUsdc`).
    pub holds: Vec<Hold>,
    /// The settlement-time swap-slippage floor, in bps, subtracted from `totalUsdc` to get `minUsdcOut`.
    /// SAME term as the haircut's `settlement_slippage_bps`. A swap below the resulting floor reverts on
    /// the contract BEFORE any junior draw. Must be ≤ 10_000.
    pub settlement_slippage_bps: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchError {
    /// No holds to settle.
    Empty,
    /// The holds summed to zero (or overflowed) USDC.
    ZeroTotal,
    /// A single hold carried zero USDC — a malformed batch (would inflate count without value).
    ZeroHold,
    /// `rail` is the zero address.
    ZeroRail,
    /// `settlement_slippage_bps > 10_000` (would make `minUsdcOut` underflow / be meaningless).
    BadSlippage,
    /// Signing / transport failure from the submit layer.
    Submit(SubmitError),
}

impl std::fmt::Display for BatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BatchError::Empty => write!(f, "batch has no holds"),
            BatchError::ZeroTotal => write!(f, "batch total USDC is zero"),
            BatchError::ZeroHold => write!(f, "a hold in the batch has zero USDC"),
            BatchError::ZeroRail => write!(f, "rail is the zero address"),
            BatchError::BadSlippage => write!(f, "settlement_slippage_bps > 10000"),
            BatchError::Submit(e) => write!(f, "submit: {e}"),
        }
    }
}
impl std::error::Error for BatchError {}

/// Basis-points denominator.
const BPS: u128 = 10_000;

impl BatchSettleParams {
    pub fn selector() -> [u8; 4] {
        batchSettleEthCall::SELECTOR
    }

    /// Σ of the holds' USDC (6dp). Saturating — a real batch is far below `u128::MAX`, and saturating is
    /// safer than wrapping if a caller ever passes garbage (validate() catches the degenerate cases).
    pub fn total_usdc(&self) -> u128 {
        self.holds.iter().fold(0u128, |acc, h| acc.saturating_add(h.amount_usdc))
    }

    /// The swap floor: `totalUsdc − totalUsdc·slippage_bps/10_000`, rounded DOWN (a lower floor is the
    /// conservative direction — it only makes the contract's catastrophe check LESS likely to reject a
    /// merely-unlucky swap, and the junior top-up + per-call cap remain the real shortfall guard). The
    /// junior buffer covers the gap between this floor and `totalUsdc`.
    pub fn min_usdc_out(&self) -> u128 {
        let total = self.total_usdc();
        let cut = total.saturating_mul(self.settlement_slippage_bps as u128) / BPS;
        total.saturating_sub(cut)
    }

    /// Mirror the on-chain guards so we never submit a batch the contract will revert on for a structural
    /// reason (`ZeroAmount`/`ZeroAddress`). The economic guards (slippage/junior) are the contract's.
    pub fn validate(&self) -> Result<(), BatchError> {
        if self.holds.is_empty() {
            return Err(BatchError::Empty);
        }
        if self.holds.iter().any(|h| h.amount_usdc == 0) {
            return Err(BatchError::ZeroHold);
        }
        if self.settlement_slippage_bps as u128 > BPS {
            return Err(BatchError::BadSlippage);
        }
        if self.total_usdc() == 0 {
            return Err(BatchError::ZeroTotal);
        }
        if self.rail == Address::ZERO {
            return Err(BatchError::ZeroRail);
        }
        Ok(())
    }

    /// ABI-encoded `batchSettleEth(totalUsdc, minUsdcOut, rail)` calldata. Validate first.
    pub fn calldata(&self) -> Vec<u8> {
        batchSettleEthCall {
            totalUsdc: U256::from(self.total_usdc()),
            minUsdcOut: U256::from(self.min_usdc_out()),
            rail: self.rail,
        }
        .abi_encode()
    }
}

/// Build + sign the batch-settle tx (validates the batch first). The tx `to` is the settlement contract.
pub fn build_and_sign_batch(
    key: &RelayerKey,
    params: &BatchSettleParams,
    gas: &GasParams,
) -> Result<SignedTx, BatchError> {
    params.validate()?;
    build_and_sign_call(key, params.settlement, params.calldata(), gas).map_err(BatchError::Submit)
}

/// `eth_call` the batch calldata against the settlement contract from `from` — proves dispatch without a
/// funded relayer. A known settlement error selector (e.g. `OnlyRelayer`, `SettlementSlippageExceeded`)
/// means the calldata reached + decoded on the contract.
pub fn dry_run_batch(
    rpc: &Rpc,
    from: Address,
    params: &BatchSettleParams,
) -> Result<DryRun, BatchError> {
    params.validate()?;
    dry_run_call(rpc, params.settlement, from, params.calldata()).map_err(BatchError::Submit)
}

/// Full path: fetch chain/fee context, build + sign, broadcast. Used by the relayer worker once a batch of
/// ETH-collateral holds is captured and ready to settle.
pub fn submit_batch_settlement(
    rpc: &Rpc,
    key: &RelayerKey,
    params: &BatchSettleParams,
) -> Result<B256, BatchError> {
    params.validate()?;
    let gas = rpc.gas_params(key.address()).map_err(BatchError::Submit)?;
    let signed = build_and_sign_batch(key, params, &gas)?;
    rpc.send_raw(&signed.raw).map_err(BatchError::Submit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_consensus::transaction::SignerRecoverable; // alloy 1.x: recover_signer moved to this trait
    use alloy_primitives::keccak256;

    fn hold(id: u8, amt: u128) -> Hold {
        Hold { hold_id: B256::repeat_byte(id), amount_usdc: amt }
    }

    fn base() -> BatchSettleParams {
        BatchSettleParams {
            settlement: Address::repeat_byte(0x5e),
            rail: Address::repeat_byte(0x2a),
            holds: vec![hold(0x01, 40_000_000), hold(0x02, 60_000_000)], // $40 + $60
            settlement_slippage_bps: 100, // 1%
        }
    }

    #[test]
    fn selector_matches_the_contract_signature() {
        assert_eq!(BatchSettleParams::selector(), keccak256("batchSettleEth(uint256,uint256,address)")[..4]);
    }

    #[test]
    fn total_sums_the_holds() {
        assert_eq!(base().total_usdc(), 100_000_000); // $100.00
    }

    #[test]
    fn min_out_applies_the_slippage_floor() {
        // $100 at 1% → floor $99.00
        assert_eq!(base().min_usdc_out(), 99_000_000);
        // 0 bps → floor == total (no slippage tolerated; junior covers nothing).
        let mut z = base();
        z.settlement_slippage_bps = 0;
        assert_eq!(z.min_usdc_out(), z.total_usdc());
        // 10_000 bps (100%) → floor 0 (swap may produce anything; junior covers the rest up to its cap).
        let mut full = base();
        full.settlement_slippage_bps = 10_000;
        assert_eq!(full.min_usdc_out(), 0);
    }

    #[test]
    fn calldata_roundtrips() {
        let p = base();
        let data = p.calldata();
        assert_eq!(&data[..4], &BatchSettleParams::selector());
        let decoded = batchSettleEthCall::abi_decode(&data).unwrap();
        assert_eq!(decoded.totalUsdc, U256::from(100_000_000u64));
        assert_eq!(decoded.minUsdcOut, U256::from(99_000_000u64));
        assert_eq!(decoded.rail, p.rail);
    }

    #[test]
    fn validate_catches_structural_garbage() {
        // empty
        let mut e = base();
        e.holds.clear();
        assert_eq!(e.validate(), Err(BatchError::Empty));

        // a zero-value hold
        let mut zh = base();
        zh.holds.push(hold(0x03, 0));
        assert_eq!(zh.validate(), Err(BatchError::ZeroHold));

        // bad slippage
        let mut bs = base();
        bs.settlement_slippage_bps = 10_001;
        assert_eq!(bs.validate(), Err(BatchError::BadSlippage));

        // zero rail
        let mut zr = base();
        zr.rail = Address::ZERO;
        assert_eq!(zr.validate(), Err(BatchError::ZeroRail));

        // the happy batch is valid
        assert_eq!(base().validate(), Ok(()));
    }

    #[test]
    fn signed_batch_tx_recovers_to_the_relayer_and_targets_the_settlement_contract() {
        use alloy_eips::eip2718::Decodable2718;
        // canonical privkey 0x…01
        let key = RelayerKey::from_hex(
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        )
        .unwrap();
        let gas = GasParams {
            chain_id: 84532,
            nonce: 5,
            max_fee_per_gas: 2_000_000_000,
            max_priority_fee_per_gas: 1_000_000_000,
            gas_limit: 400_000,
        };
        let p = base();
        let signed = build_and_sign_batch(&key, &p, &gas).unwrap();
        assert_eq!(signed.from, key.address());
        let env = alloy_consensus::TxEnvelope::decode_2718(&mut signed.raw.as_slice()).unwrap();
        assert_eq!(env.recover_signer().unwrap(), key.address());
        assert_eq!(signed.raw[0], 0x02); // EIP-1559 typed envelope
        // and it dispatches the batch selector to the settlement contract.
        assert_eq!(&p.calldata()[..4], &BatchSettleParams::selector());
    }

    #[test]
    fn refuses_to_sign_an_invalid_batch() {
        let key = RelayerKey::from_hex(
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        )
        .unwrap();
        let gas = GasParams {
            chain_id: 84532,
            nonce: 0,
            max_fee_per_gas: 1,
            max_priority_fee_per_gas: 1,
            gas_limit: 400_000,
        };
        let mut p = base();
        p.holds.clear();
        assert_eq!(build_and_sign_batch(&key, &p, &gas).unwrap_err(), BatchError::Empty);
    }
}
