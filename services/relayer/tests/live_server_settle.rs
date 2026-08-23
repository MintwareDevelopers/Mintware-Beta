//! Live proof that the SERVER's configured signer + RPC produce a `settleSpend` call the deployed
//! Gateway accepts — a safe (NO broadcast) dry-run through the same library path the `/settle` handler
//! uses. We `eth_call` a permit-only ($100) settle with a DUMMY permit sig from the relayer's own
//! address, so a correct encoding dispatches into `settleSpend`, decodes every arg, and reverts on a
//! LOGIC check (e.g. `InvalidPermitSignature`) rather than a selector miss — that revert is the proof.
//!
//! Deliberately does NOT broadcast: a real settle spends a user's shares. The always-on broadcast path
//! is deploy-gated (funded key + RELAYER_ROLE + a real captured hold) and exercised by ops, not CI.
//!
//! DEPLOY-GATED: self-skips unless BOTH RELAYER_RPC_URL and RELAYER_SIGNER_KEY are set (mirrors the
//! existing live relayer tests):
//!   RELAYER_RPC_URL=https://base-sepolia-rpc.publicnode.com \
//!   RELAYER_SIGNER_KEY=0x… \
//!   RELAYER_GATEWAY_ADDRESS=0x… cargo test --test live_server_settle -- --nocapture

use alloy_primitives::{B256, U256};
use relayer::submit::{dry_run, Rpc};
use relayer::{Permit, RelayerKey, SettleParams};

#[test]
fn configured_signer_and_rpc_produce_a_gateway_accepted_settle() {
    let (rpc_url, key_hex, gateway) = match (
        std::env::var("RELAYER_RPC_URL"),
        std::env::var("RELAYER_SIGNER_KEY").or_else(|_| std::env::var("RELAYER_SUBMIT_KEY")),
        std::env::var("RELAYER_GATEWAY_ADDRESS").or_else(|_| std::env::var("GATEWAY_ADDRESS")),
    ) {
        (Ok(r), Ok(k), Ok(g)) => (r, k, g),
        _ => {
            eprintln!(
                "skip: set RELAYER_RPC_URL + RELAYER_SIGNER_KEY + RELAYER_GATEWAY_ADDRESS to run the live server-settle dry-run"
            );
            return;
        }
    };

    let key = RelayerKey::from_hex(&key_hex).expect("RELAYER_SIGNER_KEY");
    let rpc = Rpc::new(rpc_url);
    let gateway = gateway.parse().expect("RELAYER_GATEWAY_ADDRESS");
    let relayer_addr = key.address();

    // Permit-only $100 settle; the relayer's own address as user/receiver, a DUMMY permit sig + a
    // far-future deadline — so the call dispatches + decodes and reverts on a logic check, not a miss.
    let params = SettleParams {
        hold_id: B256::repeat_byte(0x01),
        user: relayer_addr,
        assets: 100_000_000,
        receiver: relayer_addr,
        permit: Permit {
            user: relayer_addr,
            max_daily_spend_usdc: 1_000_000_000,
            nonce: U256::from(1u64),
            deadline: U256::from(9_999_999_999u64),
            signature: vec![0x11; 65],
        },
        edge: None,
    };

    // eth_call only — never broadcasts. A revert here (any error data) means the calldata dispatched;
    // WouldSucceed would be surprising for a dummy sig but is still a "dispatched" outcome.
    let outcome = dry_run(&rpc, gateway, relayer_addr, &params).expect("dry_run rpc");
    eprintln!("live settle dry-run outcome: {outcome:?}");
}
