use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::events::CampaignClosed;
use crate::state::{CampaignState, GlobalState};
use crate::{CAMPAIGN_STATE_SEED, GLOBAL_STATE_SEED};

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct CloseCampaign<'info> {
    /// Program authority — only they can close campaigns
    pub authority: Signer<'info>,

    /// Program global state — used to verify authority
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Campaign state — will be marked as closed
    #[account(
        mut,
        seeds = [CAMPAIGN_STATE_SEED, campaign_id.as_bytes()],
        bump = campaign_state.bump
    )]
    pub campaign_state: Account<'info, CampaignState>,
}

pub fn handler(ctx: Context<CloseCampaign>, _campaign_id: String) -> Result<()> {
    // Only program authority can close campaigns
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    // Campaign must have been funded (creator set on first deposit)
    require!(
        ctx.accounts.campaign_state.token_mint != Pubkey::default(),
        ErrorCode::CampaignNotFunded
    );

    // Idempotency guard — closing an already-closed campaign is an error
    require!(
        !ctx.accounts.campaign_state.closed,
        ErrorCode::CampaignClosed
    );

    let clock = Clock::get()?;
    let closed_at = clock.unix_timestamp;

    let campaign_state = &mut ctx.accounts.campaign_state;
    campaign_state.closed = true;
    campaign_state.closed_at = Some(closed_at);

    // Derive campaign_id string from stored bytes for the event
    let id_len = campaign_state.campaign_id_len as usize;
    let campaign_id_str = String::from_utf8(
        campaign_state.campaign_id[..id_len].to_vec()
    ).unwrap_or_default();

    emit!(CampaignClosed {
        campaign_id: campaign_id_str,
        closed_at,
    });

    Ok(())
}
