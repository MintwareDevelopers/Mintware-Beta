use anchor_lang::prelude::*;

#[event]
pub struct ProgramInitialized {
    pub authority: Pubkey,
    pub oracle_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct CampaignDeposited {
    pub campaign_id: String,
    pub depositor: Pubkey,
    pub token_mint: Pubkey,
    pub amount_received: u64,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct RewardClaimed {
    pub campaign_id: String,
    pub epoch_number: u64,
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
}

#[event]
pub struct CampaignClosed {
    pub campaign_id: String,
    pub closed_at: i64,
}

#[event]
pub struct CampaignWithdrawn {
    pub campaign_id: String,
    pub creator: Pubkey,
    pub amount_withdrawn: u64,
    pub timestamp: i64,
}

#[event]
pub struct OracleRotationProposed {
    pub new_pubkey: [u8; 32],
    pub proposed_at: i64,
    pub activates_at: i64,
}

#[event]
pub struct OracleRotationConfirmed {
    pub new_pubkey: [u8; 32],
    pub confirmed_at: i64,
}

#[event]
pub struct OracleRotationCancelled {
    pub cancelled_at: i64,
}

#[event]
pub struct EmergencyWithdrawEvent {
    pub campaign_id: String,
    pub amount: u64,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PauseStateChanged {
    pub paused: bool,
    pub timestamp: i64,
}
