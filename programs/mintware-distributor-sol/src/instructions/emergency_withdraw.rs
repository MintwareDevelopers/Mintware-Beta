use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::errors::ErrorCode;
use crate::events::EmergencyWithdrawEvent;
use crate::state::{CampaignState, GlobalState};
use crate::{CAMPAIGN_STATE_SEED, CAMPAIGN_VAULT_SEED, GLOBAL_STATE_SEED};

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct EmergencyWithdraw<'info> {
    /// Program authority — must be the payer and recipient of emergency funds
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Global state — checked for paused flag and authority
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Campaign state — used to derive vault signer seeds
    #[account(
        mut,
        seeds = [CAMPAIGN_STATE_SEED, campaign_id.as_bytes()],
        bump = campaign_state.bump
    )]
    pub campaign_state: Account<'info, CampaignState>,

    /// Campaign vault — all tokens are drained to authority
    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign_id.as_bytes()],
        bump = campaign_state.vault_bump
    )]
    pub campaign_vault: Account<'info, TokenAccount>,

    /// Authority's destination token account
    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key() @ ErrorCode::Unauthorized,
        constraint = authority_token_account.mint == token_mint.key() @ ErrorCode::TokenMintMismatch
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    /// SPL token mint — needed for transfer_checked
    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<EmergencyWithdraw>, campaign_id: String) -> Result<()> {
    // Program must be paused for an emergency withdrawal
    require!(ctx.accounts.global_state.paused, ErrorCode::NotPaused);

    // Only authority can perform emergency withdrawal
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    // Vault must have a non-zero balance
    require!(ctx.accounts.campaign_vault.amount > 0, ErrorCode::VaultEmpty);

    let withdraw_amount = ctx.accounts.campaign_vault.amount;

    // CPI transfer: vault → authority
    let campaign_id_bytes = campaign_id.as_bytes().to_vec();
    let bump = ctx.accounts.campaign_state.bump;
    let seeds: &[&[u8]] = &[CAMPAIGN_STATE_SEED, campaign_id_bytes.as_slice(), &[bump]];
    let signer_seeds = &[seeds];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from:      ctx.accounts.campaign_vault.to_account_info(),
                mint:      ctx.accounts.token_mint.to_account_info(),
                to:        ctx.accounts.authority_token_account.to_account_info(),
                authority: ctx.accounts.campaign_state.to_account_info(),
            },
            signer_seeds,
        ),
        withdraw_amount,
        ctx.accounts.token_mint.decimals,
    )?;

    let clock = Clock::get()?;
    emit!(EmergencyWithdrawEvent {
        campaign_id,
        amount: withdraw_amount,
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
