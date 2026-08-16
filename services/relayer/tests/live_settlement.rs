//! On-chain proof that our `batchSettleEth` calldata is accepted by a LIVE deployed `MintwareEthSettlement`.
//!
//! We `eth_call` a batch from a NON-relayer `from`, so a CORRECT encoding dispatches to `batchSettleEth`,
//! decodes all 3 args, runs the `onlyRelayer` modifier, and reverts with `OnlyRelayer()` (`0x4578ddb8`).
//! That revert IS the proof the encoding is byte-exact against the contract (a malformed call would miss
//! the selector or fail ABI decoding instead).
//!
//! DEPLOY-GATED: the ETH-collateral VAULT is live on Base Sepolia, but the settlement contract is not yet
//! broadcast. Self-skips unless BOTH RELAYER_RPC_URL and SETTLEMENT_ADDRESS are set:
//!   RELAYER_RPC_URL=https://base-sepolia-rpc.publicnode.com \
//!   SETTLEMENT_ADDRESS=0x… cargo test --test live_settlement
//!
//! (Ready to run the moment `MintwareEthSettlement` is deployed — nothing here changes.)

use alloy_primitives::{hex, Address, B256};
use relayer::{BatchSettleParams, Hold};

const ONLY_RELAYER: &str = "0x4578ddb8"; // keccak256("OnlyRelayer()")[..4]
// A non-relayer caller so the onlyRelayer modifier is what reverts (proving dispatch).
const NON_RELAYER: &str = "0x000000000000000000000000000000000000dEaD";

#[test]
fn batch_calldata_is_accepted_by_the_live_settlement_contract() {
    let (rpc, settlement) = match (std::env::var("RELAYER_RPC_URL"), std::env::var("SETTLEMENT_ADDRESS")) {
        (Ok(u), Ok(s)) => (u, s),
        _ => {
            eprintln!("skip: set RELAYER_RPC_URL + SETTLEMENT_ADDRESS to run the live-settlement dry-run");
            return;
        }
    };

    let params = BatchSettleParams {
        settlement: settlement.parse().expect("SETTLEMENT_ADDRESS"),
        rail: Address::repeat_byte(0x2a),
        holds: vec![
            Hold { hold_id: B256::repeat_byte(0x01), amount_usdc: 40_000_000 },
            Hold { hold_id: B256::repeat_byte(0x02), amount_usdc: 60_000_000 },
        ],
        settlement_slippage_bps: 100, // 1%
    };
    let data = format!("0x{}", hex::encode(params.calldata()));

    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{ "from": NON_RELAYER, "to": settlement, "data": data }, "latest"],
    });
    let resp: serde_json::Value = reqwest::blocking::Client::new()
        .post(&rpc)
        .json(&body)
        .send()
        .expect("rpc send")
        .json()
        .expect("rpc json");

    let err_data = resp
        .get("error")
        .and_then(|e| e.get("data"))
        .and_then(|d| d.as_str())
        .unwrap_or("");
    assert!(
        err_data.starts_with(ONLY_RELAYER),
        "expected OnlyRelayer ({ONLY_RELAYER}) — meaning batchSettleEth dispatched + decoded on-chain — \
         but got revert data {err_data:?}. A different/empty error would mean the calldata was malformed."
    );
}
