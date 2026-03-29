use anchor_lang::prelude::*;
use crate::state::campaign_state::MAX_CAMPAIGN_ID_LEN;

#[account]
pub struct ClaimedState {
    /// Wallet address that made the claim
    pub wallet: Pubkey,
    /// Campaign ID stored as a fixed-length byte array
    pub campaign_id: [u8; MAX_CAMPAIGN_ID_LEN],
    /// Actual length of the campaign_id string
    pub campaign_id_len: u8,
    /// Epoch number for this claim
    pub epoch_number: u64,
    /// Amount of tokens claimed
    pub amount_claimed: u64,
    /// Unix timestamp when the claim was made
    pub claimed_at: i64,
    /// Always true — existence of this account IS the double-claim guard
    pub claimed: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl ClaimedState {
    // discriminator(8) + wallet(32) + campaign_id(64) + campaign_id_len(1)
    // + epoch_number(8) + amount_claimed(8) + claimed_at(8) + claimed(1) + bump(1)
    // = 8 + 32 + 64 + 1 + 8 + 8 + 8 + 1 + 1 = 131 — use 136 for alignment
    pub const LEN: usize = 136;
}
