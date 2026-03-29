use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::errors::ErrorCode;
use crate::events::CampaignWithdrawn;
use crate::state::CampaignState;
use crate::{CAMPAIGN_STATE_SEED, CAMPAIGN_VAULT_SEED, WITHDRAWAL_COOLDOWN};

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct WithdrawCampaign<'info> {
    /// Campaign creator — the only address allowed to withdraw
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Campaign state — must be closed and past cooldown
    #[account(
        mut,
        seeds = [CAMPAIGN_STATE_SEED, campaign_id.as_bytes()],
        bump = campaign_state.bump
    )]
    pub campaign_state: Account<'info, CampaignState>,

    /// Campaign vault — source of the withdrawal
    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign_id.as_bytes()],
        bump = campaign_state.vault_bump
    )]
    pub campaign_vault: Account<'info, TokenAccount>,

    /// Creator's destination token account
    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key() @ ErrorCode::NotCampaignCreator,
        constraint = creator_token_account.mint == token_mint.key() @ ErrorCode::TokenMintMismatch
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// SPL token mint — needed for transfer_checked
    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawCampaign>, campaign_id: String) -> Result<()> {
    // Must be the campaign creator
    require_keys_eq!(
        ctx.accounts.creator.key(),
        ctx.accounts.campaign_state.creator,
        ErrorCode::NotCampaignCreator
    );

    // Campaign must have been closed first
    require!(ctx.accounts.campaign_state.closed, ErrorCode::CampaignClosed);

    // 7-day withdrawal cooldown must have elapsed after close
    let closed_at = ctx.accounts.campaign_state.closed_at.unwrap_or(0);
    require!(
        Clock::get()?.unix_timestamp >= closed_at + WITHDRAWAL_COOLDOWN,
        ErrorCode::WithdrawalCooldownActive
    );

    // Vault must still have a non-zero balance
    require!(ctx.accounts.campaign_vault.amount > 0, ErrorCode::VaultEmpty);

    let withdraw_amount = ctx.accounts.campaign_vault.amount;

    // CPI transfer: vault → creator
    // Vault is owned by campaign_state PDA — sign with its seeds
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
                to:        ctx.accounts.creator_token_account.to_account_info(),
                authority: ctx.accounts.campaign_state.to_account_info(),
            },
            signer_seeds,
        ),
        withdraw_amount,
        ctx.accounts.token_mint.decimals,
    )?;

    let clock = Clock::get()?;
    emit!(CampaignWithdrawn {
        campaign_id,
        creator: ctx.accounts.creator.key(),
        amount_withdrawn: withdraw_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
