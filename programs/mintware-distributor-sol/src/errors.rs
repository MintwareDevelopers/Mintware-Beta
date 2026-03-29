use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Program is currently paused")]
    ProgramPaused,
    #[msg("Campaign is closed")]
    CampaignClosed,
    #[msg("Campaign ID exceeds maximum length of 64 bytes")]
    CampaignIdTooLong,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Claim deadline has passed")]
    DeadlineExpired,
    #[msg("Insufficient vault balance for this claim")]
    InsufficientVaultBalance,
    #[msg("Oracle signature verification failed")]
    OracleSignatureInvalid,
    #[msg("Merkle proof verification failed")]
    MerkleProofInvalid,
    #[msg("Reward has already been claimed")]
    AlreadyClaimed,
    #[msg("Merkle proof exceeds maximum length of 20 nodes")]
    MerkleProofTooLong,
    #[msg("Oracle rotation is already in progress")]
    OracleRotationInProgress,
    #[msg("Oracle rotation timelock has not elapsed (48 hours required)")]
    OracleRotationTimelockActive,
    #[msg("No oracle rotation is currently in progress")]
    NoOracleRotationInProgress,
    #[msg("Withdrawal cooldown has not elapsed (7 days required)")]
    WithdrawalCooldownActive,
    #[msg("Only the campaign creator can withdraw")]
    NotCampaignCreator,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Token mint mismatch between claim and campaign")]
    TokenMintMismatch,
    #[msg("Ed25519 instruction not found at index 0 of this transaction")]
    MissingEd25519Instruction,
    #[msg("Caller is not the program authority")]
    Unauthorized,
    #[msg("Program must be paused for emergency withdrawal")]
    NotPaused,
    #[msg("Cannot use a zero public key as oracle")]
    InvalidOraclePubkey,
    #[msg("Campaign not yet funded")]
    CampaignNotFunded,
    #[msg("Campaign vault balance is zero")]
    VaultEmpty,
}
