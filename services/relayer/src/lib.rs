//! YPN settlement relayer — turns an edge-approved (and captured) hold into the on-chain
//! `MintwarePaymentGateway.settleSpend` call that burns the user's shares and pays the rail.
//!
//! Increment 6a (this): the **settlement calldata core** — encode the exact `settleSpend` call the
//! Gateway accepts, including its two nested EIP-712 structs, and prove the encoding offline (the
//! selector matches the contract and every argument round-trips). Getting this byte-exact is what
//! keeps the first real on-chain settlement from reverting on a malformed call.
//!
//! Increment 6b (deploy-gated follow-up): tx build/sign/send against the live Gateway (needs a funded
//! relayer wallet with RELAYER_ROLE + an on-chain deposit/hold), plus Rain capture/reversal webhooks.

pub mod settle;

pub use settle::{EdgeAuth, Permit, SettleParams, SettlementError, HIGH_VALUE_THRESHOLD};
