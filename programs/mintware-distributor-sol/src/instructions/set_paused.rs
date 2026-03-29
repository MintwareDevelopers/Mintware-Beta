use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::events::PauseStateChanged;
use crate::state::GlobalState;
use crate::GLOBAL_STATE_SEED;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    /// Program authority — only they can pause/unpause
    pub authority: Signer<'info>,

    /// Global state — paused flag will be updated
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    ctx.accounts.global_state.paused = paused;

    let clock = Clock::get()?;
    emit!(PauseStateChanged {
        paused,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
