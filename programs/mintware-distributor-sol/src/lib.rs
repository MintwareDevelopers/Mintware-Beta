use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod state;
pub mod instructions;

use instructions::*;

declare_id!("MW7D1sTribUTorS0LaNaPr0gram111111111111111");

// Program-wide constants
pub const ORACLE_ROTATION_DELAY: i64 = 172_800; // 48 hours in seconds
pub const WITHDRAWAL_COOLDOWN: i64 = 604_800;   // 7 days in seconds
pub const MAX_CAMPAIGN_ID_LEN: usize = 64;
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const CAMPAIGN_STATE_SEED: &[u8] = b"campaign_state";
pub const CAMPAIGN_VAULT_SEED: &[u8] = b"campaign_vault";
pub const CLAIMED_STATE_SEED: &[u8] = b"claimed_state";

#[program]
pub mod mintware_distributor_sol {
    use super::*;

    /// Initialize the program with an authority and oracle public key.
    pub fn initialize(ctx: Context<Initialize>, oracle_pubkey: [u8; 32]) -> Result<()> {
        instructions::initialize::handler(ctx, oracle_pubkey)
    }

    /// Deposit tokens into a campaign vault. Creates campaign if first deposit.
    pub fn deposit_campaign(ctx: Context<DepositCampaign>, campaign_id: String, amount: u64) -> Result<()> {
        instructions::deposit_campaign::handler(ctx, campaign_id, amount)
    }

    /// Claim a reward from a campaign epoch using a Merkle proof and oracle signature.
    pub fn claim(
        ctx: Context<Claim>,
        campaign_id: String,
        epoch_number: u64,
        merkle_root: [u8; 32],
        deadline: i64,
        amount: u64,
        merkle_proof: Vec<[u8; 32]>,
        oracle_sig: [u8; 64],
    ) -> Result<()> {
        instructions::claim::handler(ctx, campaign_id, epoch_number, merkle_root, deadline, amount, merkle_proof, oracle_sig)
    }

    /// Close a campaign. Only program authority can call this.
    pub fn close_campaign(ctx: Context<CloseCampaign>, campaign_id: String) -> Result<()> {
        instructions::close_campaign::handler(ctx, campaign_id)
    }

    /// Withdraw remaining campaign balance after cooldown. Only campaign creator can call.
    pub fn withdraw_campaign(ctx: Context<WithdrawCampaign>, campaign_id: String) -> Result<()> {
        instructions::withdraw_campaign::handler(ctx, campaign_id)
    }

    /// Propose a new oracle signer. Starts the 48-hour timelock.
    pub fn propose_oracle(ctx: Context<ProposeOracle>, new_oracle_pubkey: [u8; 32]) -> Result<()> {
        instructions::oracle_rotation::propose_handler(ctx, new_oracle_pubkey)
    }

    /// Confirm oracle rotation after the 48-hour timelock has elapsed.
    pub fn confirm_oracle(ctx: Context<ConfirmOracle>) -> Result<()> {
        instructions::oracle_rotation::confirm_handler(ctx)
    }

    /// Cancel a pending oracle rotation.
    pub fn cancel_oracle_rotation(ctx: Context<CancelOracleRotation>) -> Result<()> {
        instructions::oracle_rotation::cancel_handler(ctx)
    }

    /// Emergency withdraw all tokens from a campaign vault. Program must be paused.
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, campaign_id: String) -> Result<()> {
        instructions::emergency_withdraw::handler(ctx, campaign_id)
    }

    /// Pause or unpause the program.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handler(ctx, paused)
    }
}
