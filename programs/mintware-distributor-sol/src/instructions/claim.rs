use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::errors::ErrorCode;
use crate::events::RewardClaimed;
use crate::state::{CampaignState, ClaimedState, GlobalState};
use crate::state::campaign_state::MAX_CAMPAIGN_ID_LEN;
use crate::instructions::utils::{build_oracle_message, compute_leaf, verify_merkle_proof};
use crate::{CAMPAIGN_STATE_SEED, CAMPAIGN_VAULT_SEED, CLAIMED_STATE_SEED, GLOBAL_STATE_SEED};

#[derive(Accounts)]
#[instruction(campaign_id: String, epoch_number: u64)]
pub struct Claim<'info> {
    /// Claimant — pays rent for the claimed_state PDA and receives tokens
    #[account(mut)]
    pub claimant: Signer<'info>,

    /// Program global state — checked for pause and oracle pubkey
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Per-campaign state — checked for closed status and mint
    #[account(
        mut,
        seeds = [CAMPAIGN_STATE_SEED, campaign_id.as_bytes()],
        bump = campaign_state.bump
    )]
    pub campaign_state: Account<'info, CampaignState>,

    /// Campaign vault — tokens are transferred out of here
    #[account(
        mut,
        seeds = [CAMPAIGN_VAULT_SEED, campaign_id.as_bytes()],
        bump = campaign_state.vault_bump
    )]
    pub campaign_vault: Account<'info, TokenAccount>,

    /// Claimed receipt PDA — created here; existence IS the double-claim guard.
    /// Seeds include epoch_number so each epoch's claim is tracked independently.
    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimedState::LEN,
        seeds = [
            CLAIMED_STATE_SEED,
            campaign_id.as_bytes(),
            &epoch_number.to_le_bytes(),
            claimant.key().as_ref()
        ],
        bump
    )]
    pub claimed_state: Account<'info, ClaimedState>,

    /// Claimant's destination token account — must match campaign mint
    #[account(
        mut,
        constraint = claimant_token_account.owner == claimant.key() @ ErrorCode::Unauthorized,
        constraint = claimant_token_account.mint == token_mint.key() @ ErrorCode::TokenMintMismatch
    )]
    pub claimant_token_account: Account<'info, TokenAccount>,

    /// SPL token mint — used for transfer_checked and mint verification
    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// Instructions sysvar — used to verify the prepended Ed25519SigVerify instruction
    /// CHECK: This is the instructions sysvar — validated via address constraint.
    #[account(address = ix_sysvar::id())]
    pub instructions: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<Claim>,
    campaign_id: String,
    epoch_number: u64,
    merkle_root: [u8; 32],
    deadline: i64,
    amount: u64,
    merkle_proof: Vec<[u8; 32]>,
    oracle_sig: [u8; 64],
) -> Result<()> {
    // -------------------------------------------------------------------
    // 1. Cheapest checks first
    // -------------------------------------------------------------------
    require!(!ctx.accounts.global_state.paused, ErrorCode::ProgramPaused);
    require!(!ctx.accounts.campaign_state.closed, ErrorCode::CampaignClosed);
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(merkle_proof.len() <= 20, ErrorCode::MerkleProofTooLong);

    // -------------------------------------------------------------------
    // 2. Campaign ID must match what is stored in campaign_state
    // -------------------------------------------------------------------
    let id_bytes = campaign_id.as_bytes();
    require!(id_bytes.len() <= MAX_CAMPAIGN_ID_LEN, ErrorCode::CampaignIdTooLong);

    let stored_len = ctx.accounts.campaign_state.campaign_id_len as usize;
    require!(
        stored_len == id_bytes.len()
            && ctx.accounts.campaign_state.campaign_id[..stored_len] == id_bytes[..],
        ErrorCode::CampaignIdTooLong // re-using as "campaign mismatch"
    );

    // -------------------------------------------------------------------
    // 3. Token mint must match campaign
    // -------------------------------------------------------------------
    require!(
        ctx.accounts.campaign_state.token_mint == ctx.accounts.token_mint.key(),
        ErrorCode::TokenMintMismatch
    );

    // -------------------------------------------------------------------
    // 4. Deadline must not have elapsed
    // -------------------------------------------------------------------
    let clock = Clock::get()?;
    require!(clock.unix_timestamp < deadline, ErrorCode::DeadlineExpired);

    // -------------------------------------------------------------------
    // 5. Vault must hold enough tokens
    // -------------------------------------------------------------------
    require!(
        ctx.accounts.campaign_vault.amount >= amount,
        ErrorCode::InsufficientVaultBalance
    );

    // -------------------------------------------------------------------
    // 6. Ed25519 sysvar verification
    //
    //    The caller MUST prepend an Ed25519SigVerify native-program instruction
    //    at index 0 of the transaction. We parse the sysvar to confirm:
    //      (a) instruction 0 is the Ed25519SigVerify program
    //      (b) the public key matches our oracle
    //      (c) the signature matches the oracle_sig argument
    //      (d) the message matches our expected payload
    // -------------------------------------------------------------------
    let ix_0 = ix_sysvar::load_instruction_at_checked(
        0,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // Verify it is the Ed25519SigVerify native program
    let ed25519_program_id = anchor_lang::solana_program::ed25519_program::id();
    require!(
        ix_0.program_id == ed25519_program_id,
        ErrorCode::MissingEd25519Instruction
    );

    // Parse the Ed25519SigVerify instruction data layout (from Solana SDK):
    // Offset  Size  Field
    //   0     1     num_signatures (u8) — must be 1
    //   1     1     padding (u8)        — always 0
    //   2     2     signature_offset (u16 LE)
    //   4     2     signature_instruction_index (u16 LE)  — 0xFFFF = current ix
    //   6     2     public_key_offset (u16 LE)
    //   8     2     public_key_instruction_index (u16 LE) — 0xFFFF = current ix
    //  10     2     message_data_offset (u16 LE)
    //  12     2     message_data_size (u16 LE)
    //  14     2     message_instruction_index (u16 LE)    — 0xFFFF = current ix
    //  16    64     signature bytes
    //  80    32     public key bytes
    // 112     N     message bytes
    let data: &[u8] = ix_0.data.as_ref();
    require!(data.len() >= 16, ErrorCode::OracleSignatureInvalid);

    let num_sigs = data[0];
    require!(num_sigs == 1, ErrorCode::OracleSignatureInvalid);

    // SignatureOffsets struct starts at byte 2
    let sig_offset = u16::from_le_bytes([data[2],  data[3]])  as usize;
    let pk_offset  = u16::from_le_bytes([data[6],  data[7]])  as usize;
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size   = u16::from_le_bytes([data[12], data[13]]) as usize;

    require!(data.len() >= pk_offset + 32,    ErrorCode::OracleSignatureInvalid);
    require!(data.len() >= sig_offset + 64,   ErrorCode::OracleSignatureInvalid);
    require!(data.len() >= msg_offset + msg_size, ErrorCode::OracleSignatureInvalid);

    let ix_pubkey = &data[pk_offset..pk_offset + 32];
    let ix_sig    = &data[sig_offset..sig_offset + 64];
    let ix_msg    = &data[msg_offset..msg_offset + msg_size];

    // Public key must match current oracle
    require!(
        ix_pubkey == ctx.accounts.global_state.oracle_pubkey.as_ref(),
        ErrorCode::OracleSignatureInvalid
    );

    // Signature in sysvar must match the oracle_sig argument
    require!(
        ix_sig == oracle_sig.as_ref(),
        ErrorCode::OracleSignatureInvalid
    );

    // Message must match the expected oracle payload
    let expected_msg = build_oracle_message(&campaign_id, epoch_number, &merkle_root, deadline);
    require!(ix_msg == expected_msg.as_slice(), ErrorCode::OracleSignatureInvalid);

    // -------------------------------------------------------------------
    // 7. Merkle proof verification
    // -------------------------------------------------------------------
    let leaf = compute_leaf(&ctx.accounts.claimant.key(), amount);
    require!(
        verify_merkle_proof(&merkle_proof, &merkle_root, leaf),
        ErrorCode::MerkleProofInvalid
    );

    // -------------------------------------------------------------------
    // 8. CEI — Effects before Interaction
    // -------------------------------------------------------------------

    // Effects: write claimed_state
    let claimed_state = &mut ctx.accounts.claimed_state;
    claimed_state.wallet = ctx.accounts.claimant.key();
    claimed_state.campaign_id_len = id_bytes.len() as u8;
    claimed_state.campaign_id[..id_bytes.len()].copy_from_slice(id_bytes);
    claimed_state.epoch_number = epoch_number;
    claimed_state.amount_claimed = amount;
    claimed_state.claimed_at = clock.unix_timestamp;
    claimed_state.claimed = true;
    claimed_state.bump = ctx.bumps.claimed_state;

    // Effects: update campaign totals
    ctx.accounts.campaign_state.total_claimed = ctx.accounts.campaign_state
        .total_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Interaction: CPI transfer from vault to claimant
    // The vault is a PDA token account owned by campaign_state PDA, so we
    // sign with the campaign_state seeds.
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
                to:        ctx.accounts.claimant_token_account.to_account_info(),
                authority: ctx.accounts.campaign_state.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    emit!(RewardClaimed {
        campaign_id,
        epoch_number,
        claimant: ctx.accounts.claimant.key(),
        amount,
        claimed_at: clock.unix_timestamp,
    });

    Ok(())
}
