use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::errors::ErrorCode;
use crate::events::CampaignDeposited;
use crate::state::{CampaignState, GlobalState};
use crate::state::campaign_state::MAX_CAMPAIGN_ID_LEN;
use crate::{CAMPAIGN_STATE_SEED, CAMPAIGN_VAULT_SEED, GLOBAL_STATE_SEED};

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct DepositCampaign<'info> {
    /// The depositor — pays rent for new PDAs and provides tokens
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// Program global state — read-only for pause/status checks
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Per-campaign PDA — created on first deposit, reused thereafter
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + CampaignState::LEN,
        seeds = [CAMPAIGN_STATE_SEED, campaign_id.as_bytes()],
        bump
    )]
    pub campaign_state: Account<'info, CampaignState>,

    /// Token vault PDA — holds the campaign reward pool
    #[account(
        init_if_needed,
        payer = depositor,
        seeds = [CAMPAIGN_VAULT_SEED, campaign_id.as_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = campaign_state
    )]
    pub campaign_vault: Account<'info, TokenAccount>,

    /// Depositor's source token account
    #[account(
        mut,
        constraint = depositor_token_account.owner == depositor.key(),
        constraint = depositor_token_account.mint == token_mint.key()
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    /// SPL token mint for this campaign
    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<DepositCampaign>, campaign_id: String, amount: u64) -> Result<()> {
    // 1. Cheapest checks first
    require!(!ctx.accounts.global_state.paused, ErrorCode::ProgramPaused);
    require!(campaign_id.len() <= MAX_CAMPAIGN_ID_LEN, ErrorCode::CampaignIdTooLong);
    require!(!ctx.accounts.campaign_state.closed, ErrorCode::CampaignClosed);
    require!(amount > 0, ErrorCode::InvalidAmount);

    let campaign_state = &mut ctx.accounts.campaign_state;
    let token_mint_key = ctx.accounts.token_mint.key();

    // 2. First-deposit initialisation vs mint-consistency check
    if campaign_state.creator == Pubkey::default() {
        // First deposit — initialise campaign metadata
        campaign_state.creator = ctx.accounts.depositor.key();
        campaign_state.token_mint = token_mint_key;

        let id_bytes = campaign_id.as_bytes();
        campaign_state.campaign_id_len = id_bytes.len() as u8;
        campaign_state.campaign_id[..id_bytes.len()].copy_from_slice(id_bytes);

        campaign_state.total_deposited = 0;
        campaign_state.total_claimed = 0;
        campaign_state.closed = false;
        campaign_state.closed_at = None;
        campaign_state.bump = ctx.bumps.campaign_state;
        campaign_state.vault_bump = ctx.bumps.campaign_vault;
    } else {
        // Subsequent deposit — verify mint consistency
        require!(
            campaign_state.token_mint == token_mint_key,
            ErrorCode::TokenMintMismatch
        );
    }

    // 3. Balance-diff accounting — immune to fee-on-transfer tokens
    let vault_balance_before = ctx.accounts.campaign_vault.amount;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.campaign_vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // Reload vault to get post-transfer balance
    ctx.accounts.campaign_vault.reload()?;
    let vault_balance_after = ctx.accounts.campaign_vault.amount;

    let actual_received = vault_balance_after
        .checked_sub(vault_balance_before)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let campaign_state = &mut ctx.accounts.campaign_state;
    campaign_state.total_deposited = campaign_state
        .total_deposited
        .checked_add(actual_received)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    emit!(CampaignDeposited {
        campaign_id,
        depositor: ctx.accounts.depositor.key(),
        token_mint: token_mint_key,
        amount_received: actual_received,
        total_deposited: campaign_state.total_deposited,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
