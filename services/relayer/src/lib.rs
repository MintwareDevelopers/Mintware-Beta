//! YPN settlement relayer — turns an edge-approved (and captured) hold into the on-chain
//! `MintwarePaymentGateway.settleSpend` call that burns the user's shares and pays the rail.
//!
//! Increment 6a (this): the **settlement calldata core** — encode the exact `settleSpend` call the
//! Gateway accepts, including its two nested EIP-712 structs, and prove the encoding offline (the
//! selector matches the contract and every argument round-trips). Getting this byte-exact is what
//! keeps the first real on-chain settlement from reverting on a malformed call.
//!
//! Increment 6b (this, `submit`): build + sign the EIP-1559 `settleSpend` tx (canonical alloy-consensus
//! encoding, k256 signature) and broadcast via `eth_sendRawTransaction`, with a `dry_run` (`eth_call`)
//! that proves dispatch on the live Gateway. Signing is proven offline (recover-sender round-trip +
//! canonical key→address vector); the funded broadcast + Rain capture/reversal webhooks stay
//! deploy-gated (need the real relayer key with RELAYER_ROLE + an on-chain hold).

pub mod batch;
pub mod cctp;
pub mod idem;
pub mod server;
pub mod settle;
pub mod submit;

pub use batch::{
    build_and_sign_batch, dry_run_batch, submit_batch_settlement, BatchError, BatchSettleParams, Hold,
};
pub use cctp::{
    build_and_sign_receive, submit_receive, AttestedMessage, CctpError, IrisClient, ReceiveAndDeposit,
    CCTP_DOMAIN_ARC, CCTP_DOMAIN_BASE,
};
pub use idem::{IdemStore, Reserved};
pub use server::{app, AppCtx};
pub use settle::{EdgeAuth, Permit, SettleParams, SettlementError, HIGH_VALUE_THRESHOLD};
pub use submit::{
    build_and_sign, build_and_sign_call, dry_run, dry_run_call, submit_settlement, DryRun, GasParams,
    RelayerKey, Rpc, SignedTx, SubmitError, DEFAULT_SETTLE_GAS_LIMIT,
};
