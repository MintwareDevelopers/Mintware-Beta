// Prints a settleSpend calldata for an on-chain eth_call dry-run against the LIVE Gateway.
use alloy_primitives::{Address, B256, U256};
use relayer::{Permit, SettleParams};

fn main() {
    // Low-value ($100) permit-only settle. Deployer as user; a DUMMY permit sig + a FUTURE deadline,
    // so on-chain the call dispatches + decodes and reverts on a LOGIC check (InvalidPermitSignature),
    // proving the encoding is accepted by the contract — no funds, no real permit needed.
    let deployer: Address = "0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06".parse().unwrap();
    let p = SettleParams {
        hold_id: B256::repeat_byte(0x01),
        user: deployer,
        assets: 100_000_000,
        receiver: deployer,
        permit: Permit { user: deployer, max_daily_spend_usdc: 1_000_000_000, nonce: U256::from(1u64), deadline: U256::from(9_999_999_999u64), signature: vec![0x11; 65] },
        edge: None,
    };
    println!("0x{}", alloy_primitives::hex::encode(p.calldata()));
}
