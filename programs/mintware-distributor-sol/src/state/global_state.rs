use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct GlobalState {
    /// Program authority — can close campaigns, rotate oracle, pause/unpause
    pub authority: Pubkey,
    /// Current oracle signing public key (raw 32-byte Ed25519)
    pub oracle_pubkey: [u8; 32],
    /// Pending oracle public key during rotation (None if no rotation in progress)
    pub pending_oracle_pubkey: Option<[u8; 32]>,
    /// Unix timestamp when rotation was proposed (None if no rotation in progress)
    pub oracle_rotation_proposed_at: Option<i64>,
    /// Whether the program is paused — blocks deposits and claims
    pub paused: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl GlobalState {
    // discriminator(8) + authority(32) + oracle_pubkey(32)
    // + pending_oracle_pubkey(1+32) + oracle_rotation_proposed_at(1+8)
    // + paused(1) + bump(1)
    // = 8 + 32 + 32 + 33 + 9 + 1 + 1 = 116 — use 128 for alignment padding
    pub const LEN: usize = 128;
}
