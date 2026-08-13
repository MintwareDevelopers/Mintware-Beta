//! On-chain proof that our `settleSpend` calldata is accepted by the LIVE deployed Gateway.
//!
//! We `eth_call` a low-value permit-only settlement (dummy permit sig, far-future deadline) against the
//! Base Sepolia Gateway, from the relayer address (which holds RELAYER_ROLE). A CORRECT encoding
//! dispatches to `settleSpend`, decodes all 8 args (incl. both nested structs), passes the deadline +
//! user checks, and reverts only at ECDSA recovery on the dummy signature — i.e. `ECDSAInvalidSignature()`
//! (`0xf645eedf`). A malformed call would instead miss the selector or fail ABI decoding. So this
//! revert *is* the proof the encoding is byte-exact against the contract.
//!
//! Self-skips unless RELAYER_RPC_URL is set:
//!   RELAYER_RPC_URL=https://base-sepolia-rpc.publicnode.com cargo test --test live_gateway

use alloy_primitives::{hex, Address, B256, U256};
use relayer::{Permit, SettleParams};

const GATEWAY: &str = "0x26ce3baff473b24e8afe932dfb6d68adca8048b0";
const RELAYER: &str = "0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06"; // holds RELAYER_ROLE
const ECDSA_INVALID_SIGNATURE: &str = "0xf645eedf"; // keccak256("ECDSAInvalidSignature()")[..4]

#[test]
fn calldata_is_accepted_by_the_live_gateway() {
    let rpc = match std::env::var("RELAYER_RPC_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skip: set RELAYER_RPC_URL to run the live-Gateway dry-run");
            return;
        }
    };

    let relayer: Address = RELAYER.parse().unwrap();
    let params = SettleParams {
        hold_id: B256::repeat_byte(0x01),
        user: relayer,
        assets: 100_000_000, // $100, permit-only (< $250)
        receiver: relayer,
        permit: Permit {
            user: relayer,
            max_daily_spend_usdc: 1_000_000_000,
            nonce: U256::from(1u64),
            deadline: U256::from(9_999_999_999u64), // far future → passes the deadline check
            signature: vec![0x11; 65],              // dummy → reverts at ECDSA recovery
        },
        edge: None,
    };
    let data = format!("0x{}", hex::encode(params.calldata()));

    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{ "from": RELAYER, "to": GATEWAY, "data": data }, "latest"],
    });
    let resp: serde_json::Value = reqwest::blocking::Client::new()
        .post(&rpc)
        .json(&body)
        .send()
        .expect("rpc send")
        .json()
        .expect("rpc json");

    // A well-formed call reaches the function body and reverts on the dummy sig.
    let err_data = resp
        .get("error")
        .and_then(|e| e.get("data"))
        .and_then(|d| d.as_str())
        .unwrap_or("");
    assert!(
        err_data.starts_with(ECDSA_INVALID_SIGNATURE),
        "expected ECDSAInvalidSignature ({ECDSA_INVALID_SIGNATURE}) — meaning the encoding dispatched + \
         decoded on-chain — but got revert data {err_data:?}. A different/empty error would mean the \
         calldata was malformed."
    );
}
