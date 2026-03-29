use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::events::{OracleRotationCancelled, OracleRotationConfirmed, OracleRotationProposed};
use crate::state::GlobalState;
use crate::{GLOBAL_STATE_SEED, ORACLE_ROTATION_DELAY};

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ProposeOracle<'info> {
    /// Program authority — only they can initiate oracle rotation
    pub authority: Signer<'info>,

    /// Global state — will store the pending oracle and proposed_at timestamp
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
}

pub fn propose_handler(ctx: Context<ProposeOracle>, new_oracle_pubkey: [u8; 32]) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    require!(new_oracle_pubkey != [0u8; 32], ErrorCode::InvalidOraclePubkey);

    // Cannot start a new rotation if one is already pending
    require!(
        ctx.accounts.global_state.pending_oracle_pubkey.is_none(),
        ErrorCode::OracleRotationInProgress
    );

    let clock = Clock::get()?;
    let proposed_at = clock.unix_timestamp;
    let activates_at = proposed_at + ORACLE_ROTATION_DELAY;

    let global_state = &mut ctx.accounts.global_state;
    global_state.pending_oracle_pubkey = Some(new_oracle_pubkey);
    global_state.oracle_rotation_proposed_at = Some(proposed_at);

    emit!(OracleRotationProposed {
        new_pubkey: new_oracle_pubkey,
        proposed_at,
        activates_at,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ConfirmOracle<'info> {
    /// Program authority — only they can confirm the rotation
    pub authority: Signer<'info>,

    /// Global state — will have its oracle_pubkey swapped
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
}

pub fn confirm_handler(ctx: Context<ConfirmOracle>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    // A rotation must be in progress
    let pending_key = ctx.accounts.global_state
        .pending_oracle_pubkey
        .ok_or(ErrorCode::NoOracleRotationInProgress)?;

    // Timelock must have elapsed
    let proposed_at = ctx.accounts.global_state
        .oracle_rotation_proposed_at
        .unwrap_or(0);
    require!(
        Clock::get()?.unix_timestamp >= proposed_at + ORACLE_ROTATION_DELAY,
        ErrorCode::OracleRotationTimelockActive
    );

    // Activate new oracle — clear pending state
    let global_state = &mut ctx.accounts.global_state;
    global_state.oracle_pubkey = pending_key;
    global_state.pending_oracle_pubkey = None;
    global_state.oracle_rotation_proposed_at = None;

    let confirmed_at = Clock::get()?.unix_timestamp;
    emit!(OracleRotationConfirmed {
        new_pubkey: pending_key,
        confirmed_at,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelOracleRotation<'info> {
    /// Program authority — only they can cancel the rotation
    pub authority: Signer<'info>,

    /// Global state — pending rotation will be cleared
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
}

pub fn cancel_handler(ctx: Context<CancelOracleRotation>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.global_state.authority,
        ErrorCode::Unauthorized
    );

    // A rotation must be in progress to cancel
    require!(
        ctx.accounts.global_state.pending_oracle_pubkey.is_some(),
        ErrorCode::NoOracleRotationInProgress
    );

    let global_state = &mut ctx.accounts.global_state;
    global_state.pending_oracle_pubkey = None;
    global_state.oracle_rotation_proposed_at = None;

    let cancelled_at = Clock::get()?.unix_timestamp;
    emit!(OracleRotationCancelled { cancelled_at });

    Ok(())
}
