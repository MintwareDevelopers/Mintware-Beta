use anchor_lang::prelude::*;

pub const MAX_CAMPAIGN_ID_LEN: usize = 64;

#[account]
pub struct CampaignState {
    /// Campaign ID stored as a fixed-length byte array
    pub campaign_id: [u8; MAX_CAMPAIGN_ID_LEN],
    /// Actual length of the campaign_id string (0..=MAX_CAMPAIGN_ID_LEN)
    pub campaign_id_len: u8,
    /// SPL token mint for rewards in this campaign
    pub token_mint: Pubkey,
    /// First depositor — the only address allowed to withdraw after close
    pub creator: Pubkey,
    /// Cumulative tokens deposited (balance-diff accounting)
    pub total_deposited: u64,
    /// Cumulative tokens claimed
    pub total_claimed: u64,
    /// Whether this campaign has been closed by the authority
    pub closed: bool,
    /// Unix timestamp when the campaign was closed (None if still open)
    pub closed_at: Option<i64>,
    /// PDA bump seed for campaign_state account
    pub bump: u8,
    /// PDA bump seed for campaign_vault token account
    pub vault_bump: u8,
}

impl CampaignState {
    // discriminator(8) + campaign_id(64) + campaign_id_len(1)
    // + token_mint(32) + creator(32) + total_deposited(8) + total_claimed(8)
    // + closed(1) + closed_at(1+8) + bump(1) + vault_bump(1)
    // = 8 + 64 + 1 + 32 + 32 + 8 + 8 + 1 + 9 + 1 + 1 = 165 — use 176 for padding
    pub const LEN: usize = 176;
}
