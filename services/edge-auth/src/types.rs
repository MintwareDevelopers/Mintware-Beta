//! Wire types for the edge-auth HTTP surface. USDC amounts are integer 6-dp strings on the wire
//! (`u128` doesn't fit a JSON number safely), parsed to `Usdc` at the boundary.

use serde::{Deserialize, Serialize};

use crate::ledger::{Decision, Decline};

/// `POST /authorize` request — what Rain hands the edge on a swipe.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthorizeRequest {
    /// The cardholder's vault user (EVM address, lowercase hex).
    pub user: String,
    /// Charge amount in USDC minor units (6dp), as a decimal string.
    pub amount_usdc: String,
    /// Idempotency key for the hold (the same id the Gateway settles under). Optional — the caller
    /// may let the edge mint one, but Rain normally supplies its auth id.
    #[serde(default)]
    pub hold_id: Option<String>,
}

/// The signed high-value edge authorization the relayer threads into `settleSpend` (present only for
/// approved charges >= $250). All integers are decimal strings; `hold_id`/`signature` are 0x-hex.
#[derive(Debug, Clone, Serialize)]
pub struct EdgeAuthView {
    /// bytes32 the Gateway settles under (= keccak256 of the store hold id).
    pub hold_id: String,
    pub user: String,
    pub amount_usdc: String,
    pub nonce: String,
    pub expiry: String,
    /// 65-byte r‖s‖v signature, 0x-hex.
    pub signature: String,
}

/// `POST /authorize` response.
#[derive(Debug, Clone, Serialize)]
pub struct AuthorizeResponse {
    pub approved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hold_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hold_usdc: Option<String>,
    /// Machine-readable decline reason (snake_case), present iff `!approved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decline_reason: Option<&'static str>,
    /// Signed edge authorization — present only for approved charges >= the high-value threshold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge_auth: Option<EdgeAuthView>,
}

impl AuthorizeResponse {
    pub fn from_decision(decision: Decision, hold_id: Option<String>) -> Self {
        match decision {
            Decision::Approve { hold_usdc } => AuthorizeResponse {
                approved: true,
                hold_id,
                hold_usdc: Some(hold_usdc.to_string()),
                decline_reason: None,
                edge_auth: None, // set by the handler for high-value charges
            },
            Decision::Decline(reason) => AuthorizeResponse {
                approved: false,
                hold_id: None,
                hold_usdc: None,
                decline_reason: Some(decline_code(reason)),
                edge_auth: None,
            },
        }
    }
}

/// Stable snake_case codes for the card network / logs.
pub fn decline_code(reason: Decline) -> &'static str {
    match reason {
        Decline::StaleNav => "stale_nav",
        Decline::StalePrice => "stale_price",
        Decline::ZeroAmount => "zero_amount",
        Decline::InsufficientEquity => "insufficient_equity",
        Decline::DailyCapExceeded => "daily_cap_exceeded",
        Decline::InsufficientLiquidity => "insufficient_liquidity",
        Decline::ReserveFloorBreached => "reserve_floor_breached",
        Decline::CircuitBreakerOpen => "circuit_breaker_open",
    }
}

/// `GET /holds/:id` response.
#[derive(Debug, Clone, Serialize)]
pub struct HoldView {
    pub hold_id: String,
    pub user: String,
    pub amount_usdc: String,
    pub status: &'static str,
    pub created_secs: u64,
    pub expiry_secs: u64,
}
