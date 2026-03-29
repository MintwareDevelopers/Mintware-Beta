use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::events::ProgramInitialized;
use crate::state::GlobalState;
use crate::{GLOBAL_STATE_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// PDA that holds program-wide configuration (authority, oracle key, pause state)
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::LEN,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Payer and future program authority
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, oracle_pubkey: [u8; 32]) -> Result<()> {
    require!(oracle_pubkey != [0u8; 32], ErrorCode::InvalidOraclePubkey);

    let global_state = &mut ctx.accounts.global_state;
    let clock = Clock::get()?;

    global_state.authority = ctx.accounts.authority.key();
    global_state.oracle_pubkey = oracle_pubkey;
    global_state.pending_oracle_pubkey = None;
    global_state.oracle_rotation_proposed_at = None;
    global_state.paused = false;
    global_state.bump = ctx.bumps.global_state;

    emit!(ProgramInitialized {
        authority: ctx.accounts.authority.key(),
        oracle_pubkey,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
