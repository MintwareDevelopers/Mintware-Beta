# Phase 7 — Solana-Native Token Claim Distribution Program
## Technical Specification v1.0

**Status:** Draft for Engineering Review
**Date:** 2026-03-29
**Branch target:** `feature/phase-7-solana`
**Depends on:** Phase 1 EVM distributor (complete), campaign engine schema (complete)

---

## Table of Contents

1. Architecture Overview
2. Oracle Design Deep-Dive
3. Anchor Program Specification
4. Leaf Encoding Specification
5. Off-Chain TypeScript Specification
6. Security Model
7. Deployment and Operations
8. Implementation Tickets

---

## 1. Architecture Overview

### 1.1 Design Rationale

Phase 7 ports the Mintware reward distribution system to Solana. The EVM implementation makes a key architectural bet: the oracle signs Merkle roots off-chain at zero gas cost, and users pay all on-chain costs when claiming. This "zero oracle gas" pattern is retained verbatim on Solana — the oracle never submits a transaction; every claim transaction is user-funded.

Three candidate architectures were considered:

| Approach | Description | Rejected because |
|---|---|---|
| **Trustless on-chain Merkle only** | Store Merkle root in account, user submits proof, no oracle sig | Allows early root submission — attacker could front-run with manipulated root before Mintware epoch processing completes |
| **On-chain Ed25519 program verify** | Call `Ed25519Program::verify` as a CPI from within the instruction | Not supported — `Ed25519Program` is a native program that cannot be invoked via CPI; it only reads from the `Instructions` sysvar |
| **Ed25519 instruction sysvar (chosen)** | User includes an `Ed25519SigVerify` instruction in the same transaction; Anchor program reads the `Instructions` sysvar to confirm it was already verified | No CPI needed, verifier logic is one sysvar read + slice comparison, works with standard Solana tooling |

The instruction sysvar approach is the canonical Solana pattern used by programs requiring Ed25519 signature verification without a dedicated verifier program (Wormhole, marginfi, and others use this pattern). The cost is one additional instruction in the user's claim transaction; the benefit is that signature verification is guaranteed by the Solana runtime before the program ever executes.

### 1.2 Full Claim Flow

```
ORACLE (Mintware backend — no gas)
─────────────────────────────────
 1. Epoch closes
 2. epochProcessor builds Merkle tree from participant activity
 3. solanaPublisher.ts signs:
      { campaign_id, epoch_number, merkle_root[32], deadline_i64 }
    using Ed25519 keypair (SOL_ORACLE_PRIVATE_KEY)
 4. Stores { merkle_root, oracle_sig_base64, deadline } in sol_distributions
    Supabase table

USER (pays compute units)
─────────────────────────────────
 5. ClaimCard.tsx detects wallet is Solana → renders Solana claim path
 6. Calls GET /api/(rewards)/claim/sol?campaign=&epoch=&wallet=
    Server responds with:
      { merkle_root, oracle_sig_base64, deadline, amount, merkle_proof[] }
 7. Client constructs transaction:
      Instruction 0: Ed25519SigVerify(
          pubkey   = oracle_pubkey,
          message  = serialize({ campaign_id, epoch_number, merkle_root, deadline }),
          sig      = oracle_sig_bytes
      )
      Instruction 1: mintware_distributor::claim(
          campaign_id, epoch_number, merkle_root,
          deadline, amount, merkle_proof,
          oracle_sig_bytes          ← for sysvar cross-reference
      )
 8. Transaction submitted; Solana runtime executes Ed25519SigVerify first
 9. Anchor program executes claim:
      a. Loads GlobalState PDA → not paused, oracle_pubkey matches
      b. Loads CampaignState PDA → funded, not closed
      c. Checks deadline > Clock::unix_timestamp
      d. Checks ClaimedState PDA does not exist (init_if_needed guard)
      e. Reads Instructions sysvar → verifies Ed25519SigVerify was in ix[0]
         and matches exact (pubkey, message, sig) triple
      f. Verifies Merkle proof: leaf = keccak(keccak(pubkey||amount_le))
      g. CEI: marks ClaimedState PDA as claimed (state change before transfer)
      h. SPL transfer_checked from campaign vault → user token account
10. ClaimCard updates to "Claimed" state
```

### 1.3 Component Map

```
programs/mintware-distributor-sol/
  src/
    lib.rs                  ← program entry, declare_id!, mod declarations
    instructions/
      initialize.rs
      deposit_campaign.rs
      claim.rs              ← most complex; Ed25519 sysvar read here
      close_campaign.rs
      withdraw_campaign.rs
      propose_oracle.rs
      confirm_oracle.rs
      cancel_oracle_rotation.rs
      emergency_withdraw.rs
    state/
      global_state.rs
      campaign_state.rs
      claimed_state.rs
    errors.rs
    events.rs
  Cargo.toml

lib/web3/solanaPublisher.ts       ← mirrors onchainPublisher.ts for Solana
app/api/(rewards)/claim/sol/
  route.ts                        ← GET endpoint, proof + sig response
supabase/migrations/
  20260329000001_sol_distributions.sql

components/rewards/campaigns/
  ClaimCard.tsx                   ← add Solana dispatch branch
```

---

## 2. Oracle Design Deep-Dive

### 2.1 Why Ed25519 Instruction Sysvar

Solana has two native signature verification programs:

| Program | Key type | Invocable via CPI | Used for |
|---|---|---|---|
| `Ed25519Program` (`Ed25519SigVerify111...`) | Ed25519 | No — native only | Ed25519 off-chain signatures |
| `Secp256k1Program` (`KeccakSecp256k11...`) | secp256k1 (Ethereum-compatible) | No — native only | Ethereum-compatible sigs |

Neither program can be called via CPI. Both programs write verification results into the transaction's `Instructions` sysvar that other programs can read. The sysvar-reading approach is not a workaround — it is the intended design.

**Why Ed25519 over secp256k1 on Solana:**

The secp256k1 option would allow key reuse between the EVM oracle (`DISTRIBUTOR_PRIVATE_KEY`) and the Solana oracle — the same private key could sign both chains. However this is rejected for three reasons:

1. Key reuse across chains means a single key compromise breaks two independent distribution systems simultaneously.
2. secp256k1 on Solana requires the message to be hashed using Ethereum's `\x19Ethereum Signed Message` prefix convention — adding a chain-specific encoding dependency that contaminates the message format.
3. Ed25519 is the native Solana key type. Keypair management, backup, and HSM support are better established for Ed25519 in the Solana ecosystem.

The oracle therefore uses a **separate Ed25519 keypair** (`SOL_ORACLE_PRIVATE_KEY`). The EVM oracle (`DISTRIBUTOR_PRIVATE_KEY`, secp256k1) is entirely unrelated.

### 2.2 Oracle Message Format

The oracle signs a fixed-layout message. The message is serialized deterministically with no framing overhead:

```
Offset  Size  Type      Field
──────────────────────────────────────────────────
0       32    [u8;32]   merkle_root
32      8     i64 LE    deadline        (Unix timestamp, little-endian)
40      8     u64 LE    epoch_number    (little-endian)
48      N     [u8;N]    campaign_id     (UTF-8 bytes, no length prefix)
```

Where N = `campaign_id.len()`. The `campaign_id` is the Mintware campaign identifier string (e.g. `"mw_campaign_0042"`).

This layout is reproduced identically in:
- `solanaPublisher.ts` — when signing
- `claim.rs` — when reconstructing the message for sysvar cross-reference
- The claim API route — when including in the response

**Rationale for field ordering:** Fixed-width fields come first so the Anchor program can read `merkle_root` (bytes 0–31) and `deadline` (bytes 32–39) without knowing `campaign_id` length. The variable-length `campaign_id` comes last and its length is derived from `total_message_len - 48`.

### 2.3 Ed25519SigVerify Instruction Layout

The Solana `Ed25519Program` expects a specific byte layout in its instruction data. The Anchor program must read from the `Instructions` sysvar and verify this layout matches expectations.

The `Ed25519SigVerify` instruction data format is documented in [solana-sdk]:

```
Offset  Size  Description
0       2     num_signatures (u16 LE) — must be 1 for our use
2       1     padding
3       2     signature_offset (u16 LE)
5       2     signature_instruction_index (u16 LE) — 0xFFFF = current ix
7       2     public_key_offset (u16 LE)
9       2     public_key_instruction_index (u16 LE) — 0xFFFF = current ix
11      2     message_data_offset (u16 LE)
13      2     message_data_size (u16 LE)
15      2     message_instruction_index (u16 LE) — 0xFFFF = current ix
17      64    signature bytes (ed25519, 64 bytes)
81      32    public_key bytes (ed25519 pubkey, 32 bytes)
113     N     message bytes
```

The Anchor program's verification logic in `claim.rs`:

1. Load the `Instructions` sysvar using `load_current_index_checked` and `load_instruction_at_checked`.
2. Assert instruction at index 0 has program_id == `Ed25519Program::ID`.
3. Parse the instruction data: read `num_signatures` (must be 1), read `public_key_offset` and `signature_offset`, extract the 32-byte pubkey and 64-byte sig.
4. Compare extracted pubkey against `global_state.oracle_pubkey`.
5. Compare extracted signature against the `oracle_sig` argument passed to `claim`.
6. Compare the message bytes at `message_data_offset` + `message_data_size` against the locally reconstructed message (from `merkle_root`, `deadline`, `epoch_number`, `campaign_id`).

All six comparisons must pass. A failure on any one returns `ErrorCode::OracleSignatureInvalid`.

### 2.4 Oracle Rotation on Solana

The EVM oracle rotation uses a 48-hour timelock. The same pattern is implemented on Solana using `Clock::unix_timestamp`.

```
GlobalState.oracle_pubkey              ← active oracle key (Ed25519 [u8;32])
GlobalState.pending_oracle_pubkey      ← proposed new key (Option<[u8;32]>)
GlobalState.oracle_rotation_proposed_at ← Unix timestamp of proposal (Option<i64>)
```

**Rotation flow:**

```
proposeOracle(new_pubkey)
  ← requires: signer == global_state.authority
  ← sets: pending_oracle_pubkey = Some(new_pubkey)
  ← sets: oracle_rotation_proposed_at = Some(Clock::unix_timestamp)
  ← emits: OracleRotationProposed { new_pubkey, proposed_at }

  ... wait 48 hours (172_800 seconds) ...

confirmOracle()
  ← requires: signer == global_state.authority
  ← requires: Clock::unix_timestamp >= oracle_rotation_proposed_at + 172_800
  ← sets: oracle_pubkey = pending_oracle_pubkey.unwrap()
  ← clears: pending_oracle_pubkey, oracle_rotation_proposed_at
  ← emits: OracleRotationConfirmed { new_pubkey }

cancelOracleRotation()
  ← requires: signer == global_state.authority
  ← clears: pending_oracle_pubkey, oracle_rotation_proposed_at
  ← emits: OracleRotationCancelled
```

If oracle key is suspected compromised, the authority calls `cancelOracleRotation()` immediately (no timelock on cancel), then `proposeOracle(fresh_key)` + wait 48h + `confirmOracle()`.

### 2.5 Key Management

| Variable | Type | Purpose | Storage |
|---|---|---|---|
| `SOL_ORACLE_PRIVATE_KEY` | 64-byte base58 string (Ed25519 keypair) | Signs Merkle roots for Solana distributions | Vercel server-only env var |
| `DISTRIBUTOR_PRIVATE_KEY` | 32-byte hex (secp256k1) | Signs Merkle roots for EVM distributions | Vercel server-only env var (existing) |
| `SOL_PROGRAM_ID` | base58 pubkey | Deployed program ID | `NEXT_PUBLIC_SOL_PROGRAM_ID` |
| `SOL_ORACLE_PUBKEY` | base58 pubkey | Stored in GlobalState at initialize | `NEXT_PUBLIC_SOL_ORACLE_PUBKEY` (for client verification display only) |

The `SOL_ORACLE_PRIVATE_KEY` is the full 64-byte Solana keypair (seed + pubkey). It is generated once using `solana-keygen new --outfile oracle-keypair.json` and the resulting base58 string is stored in Vercel. The public key portion (bytes 32–63) is extracted by `solanaPublisher.ts` and stored in `GlobalState.oracle_pubkey` at `initialize` time.

The `DISTRIBUTOR_PRIVATE_KEY` (EVM secp256k1) is completely separate. Key compromise on one chain does not affect the other.

---

## 3. Anchor Program Specification

### 3.1 Cargo.toml Dependencies

```toml
[package]
name = "mintware-distributor-sol"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "mintware_distributor_sol"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.30.1", features = ["token"] }
solana-program = "1.18.26"
```

### 3.2 Program ID and Constants

```rust
// lib.rs
use anchor_lang::prelude::*;

declare_id!("MW7D1sTribUTorS0LaNaPr0gram111111111111111");
// ^ placeholder — replace with actual program ID after first deploy

pub const ORACLE_ROTATION_DELAY: i64 = 172_800; // 48 hours in seconds
pub const WITHDRAWAL_COOLDOWN: i64 = 604_800;   // 7 days in seconds
pub const MAX_CAMPAIGN_ID_LEN: usize = 64;       // max UTF-8 bytes in campaign_id

// PDA seeds
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const CAMPAIGN_STATE_SEED: &[u8] = b"campaign_state";
pub const CAMPAIGN_VAULT_SEED: &[u8] = b"campaign_vault";
pub const CLAIMED_STATE_SEED: &[u8] = b"claimed_state";
```

### 3.3 State Account Definitions

#### 3.3.1 GlobalState

Singleton PDA — one per program deployment.

```rust
// state/global_state.rs
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct GlobalState {
    /// Program upgrade authority — can call admin instructions
    pub authority: Pubkey,               // 32 bytes

    /// Active Ed25519 oracle public key (32 bytes)
    pub oracle_pubkey: [u8; 32],         // 32 bytes

    /// Proposed new oracle pubkey (None if no rotation in progress)
    pub pending_oracle_pubkey: Option<[u8; 32]>,  // 1 + 32 = 33 bytes

    /// Unix timestamp when rotation was proposed (None if no rotation)
    pub oracle_rotation_proposed_at: Option<i64>, // 1 + 8 = 9 bytes

    /// Halt switch — set true to block all claim/deposit instructions
    pub paused: bool,                    // 1 byte

    /// Bump seed for this PDA (cached to avoid recomputation)
    pub bump: u8,                        // 1 byte
}

impl GlobalState {
    /// Discriminator (8) + all fields above
    pub const LEN: usize = 8 + 32 + 32 + 33 + 9 + 1 + 1;
    // = 8 + 108 = 116 bytes
    // Round up to nearest 8 for alignment: 120 bytes rent-exempt
}
```

PDA derivation: `find_program_address(&[GLOBAL_STATE_SEED], program_id)`

There is exactly one `GlobalState` per program deployment. The bump is stored in the account to avoid re-deriving it in hot-path instructions.

#### 3.3.2 CampaignState

One PDA per campaign. Stores campaign metadata, token vault reference, lifecycle state, and balance accounting.

```rust
// state/campaign_state.rs
use anchor_lang::prelude::*;

#[account]
pub struct CampaignState {
    /// Campaign identifier string (max MAX_CAMPAIGN_ID_LEN bytes, UTF-8)
    /// Stored as fixed-length array + actual length to keep account size fixed
    pub campaign_id: [u8; 64],           // 64 bytes
    pub campaign_id_len: u8,             // 1 byte  (actual length, 1..=64)

    /// SPL token mint for this campaign's reward token
    pub token_mint: Pubkey,              // 32 bytes

    /// First depositor becomes creator — can call withdraw_campaign after cooldown
    pub creator: Pubkey,                 // 32 bytes

    /// Total tokens deposited (balance-diff accounting — mirrors EVM v2)
    pub total_deposited: u64,            // 8 bytes

    /// Total tokens claimed so far
    pub total_claimed: u64,             // 8 bytes

    /// Whether close_campaign has been called
    pub closed: bool,                    // 1 byte

    /// Unix timestamp when close_campaign was called (None if not closed)
    pub closed_at: Option<i64>,          // 1 + 8 = 9 bytes

    /// Bump seed for this PDA
    pub bump: u8,                        // 1 byte

    /// Bump seed for the vault token account PDA
    pub vault_bump: u8,                  // 1 byte
}

impl CampaignState {
    /// Discriminator (8) + all fields
    pub const LEN: usize = 8 + 64 + 1 + 32 + 32 + 8 + 8 + 1 + 9 + 1 + 1;
    // = 8 + 157 = 165 bytes
    // Padded to 168 bytes
}
```

PDA derivation: `find_program_address(&[CAMPAIGN_STATE_SEED, campaign_id_bytes], program_id)`

Where `campaign_id_bytes` is the raw UTF-8 bytes of the campaign ID string (up to 64 bytes).

The **campaign vault** is a separate SPL token account PDA that holds the actual tokens:

PDA derivation: `find_program_address(&[CAMPAIGN_VAULT_SEED, campaign_id_bytes], program_id)`

The vault is a token account initialized with authority set to the `CampaignState` PDA. No separate token authority account is needed — the `CampaignState` PDA signs transfers via `invoke_signed`.

#### 3.3.3 ClaimedState

One PDA per (campaign, epoch, wallet) triple. Acts as a bitmap replacement — if this account exists and `claimed == true`, the claim has been processed.

```rust
// state/claimed_state.rs
use anchor_lang::prelude::*;

#[account]
pub struct ClaimedState {
    /// The wallet that submitted this claim
    pub wallet: Pubkey,                  // 32 bytes

    /// Campaign this claim belongs to
    pub campaign_id: [u8; 64],           // 64 bytes
    pub campaign_id_len: u8,             // 1 byte

    /// Epoch number
    pub epoch_number: u64,               // 8 bytes

    /// Amount claimed (for audit — mirrors what was transferred)
    pub amount_claimed: u64,             // 8 bytes

    /// Unix timestamp of claim
    pub claimed_at: i64,                 // 8 bytes

    /// Always true once created — account existence is the guard;
    /// this field is for off-chain readability
    pub claimed: bool,                   // 1 byte

    /// Bump seed
    pub bump: u8,                        // 1 byte
}

impl ClaimedState {
    pub const LEN: usize = 8 + 32 + 64 + 1 + 8 + 8 + 8 + 1 + 1;
    // = 8 + 123 = 131 bytes
    // Padded to 136 bytes
}
```

PDA derivation:
```
find_program_address(
    &[
        CLAIMED_STATE_SEED,
        campaign_id_bytes,
        &epoch_number.to_le_bytes(),
        wallet_pubkey.as_ref(),
    ],
    program_id
)
```

The existence of this PDA is the double-claim guard. `init_if_needed` with a constraint that `claimed_state.claimed == false` is NOT safe — use `init` (not `init_if_needed`). If the account already exists, Anchor's `init` will fail the transaction. This is the correct behaviour.

**Rent responsibility:** The user pays rent for their own `ClaimedState` PDA. This is non-negotiable — the alternative (program pays rent) would allow an attacker to exhaust the program's rent reserve by submitting many small claims. The rent cost is approximately 0.0016 SOL (136 bytes at current rent schedule) and is a one-time cost per (campaign, epoch, wallet) triple.

### 3.4 Instruction Specifications

All instructions are defined in `lib.rs` under `#[program] mod mintware_distributor_sol`. Security checks within each instruction follow cheapest-first ordering (local reads before sysvar reads before cross-account reads before token operations).

#### 3.4.1 `initialize`

Sets up the singleton `GlobalState`. Can only be called once (Anchor `init` constraint).

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    oracle_pubkey: [u8; 32],     // Ed25519 oracle public key
) -> Result<()>
```

**Accounts (`Initialize`):**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `authority` | `Signer<'info>` | No | Yes | Becomes `GlobalState.authority` |
| `global_state` | `Account<'info, GlobalState>` | Yes | No | PDA: `[GLOBAL_STATE_SEED]` |
| `system_program` | `Program<'info, System>` | No | No | Required for PDA init |

**Security checks:**
1. Anchor `init` constraint ensures this can only be called once (account must not exist).
2. `oracle_pubkey` must not be all zeros (checked in instruction body).

**Side effects:**
- Creates `GlobalState` PDA, sets `authority`, `oracle_pubkey`, `paused = false`, caches `bump`.
- Emits `ProgramInitialized { authority, oracle_pubkey }`.

#### 3.4.2 `deposit_campaign`

Locks tokens into a campaign vault. First caller becomes creator. Uses balance-diff accounting to handle fee-on-transfer tokens correctly.

```rust
pub fn deposit_campaign(
    ctx: Context<DepositCampaign>,
    campaign_id: String,        // max 64 bytes UTF-8
    amount: u64,                // token amount in base units (before transfer)
) -> Result<()>
```

**Accounts (`DepositCampaign`):**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `depositor` | `Signer<'info>` | Yes | Yes | Pays for account creation if new campaign |
| `global_state` | `Account<'info, GlobalState>` | No | No | Read paused flag |
| `campaign_state` | `Account<'info, CampaignState>` | Yes | No | PDA: `[CAMPAIGN_STATE_SEED, campaign_id]` — `init_if_needed` |
| `campaign_vault` | `Account<'info, TokenAccount>` | Yes | No | PDA: `[CAMPAIGN_VAULT_SEED, campaign_id]` — `init_if_needed` |
| `depositor_token_account` | `Account<'info, TokenAccount>` | Yes | No | Depositor's token account for `token_mint` |
| `token_mint` | `Account<'info, Mint>` | No | No | SPL token mint |
| `token_program` | `Program<'info, Token>` | No | No | |
| `system_program` | `Program<'info, System>` | No | No | For PDA init |
| `rent` | `Sysvar<'info, Rent>` | No | No | For PDA init |

**Security checks (cheapest first):**
1. `require!(!global_state.paused, ErrorCode::ProgramPaused)` — local read
2. `require!(campaign_id.len() <= MAX_CAMPAIGN_ID_LEN, ErrorCode::CampaignIdTooLong)` — local
3. `require!(!campaign_state.closed, ErrorCode::CampaignClosed)` — local
4. `require!(amount > 0, ErrorCode::InvalidAmount)` — local

**Balance-diff accounting:**
```rust
let vault_balance_before = ctx.accounts.campaign_vault.amount;
// ... transfer_checked ...
ctx.accounts.campaign_vault.reload()?;
let vault_balance_after = ctx.accounts.campaign_vault.amount;
let actual_received = vault_balance_after - vault_balance_before;
campaign_state.total_deposited = campaign_state.total_deposited
    .checked_add(actual_received)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
```

**Creator assignment:** If `campaign_state.creator == Pubkey::default()` (first deposit), set `campaign_state.creator = depositor.key()`.

**Emits:** `CampaignDeposited { campaign_id, depositor, amount_received: actual_received, total_deposited }`

#### 3.4.3 `claim`

The core instruction. Verifies oracle sig via Instructions sysvar, verifies Merkle proof, mints tokens to user. This is the most expensive instruction (~30,000–45,000 compute units).

```rust
pub fn claim(
    ctx: Context<Claim>,
    campaign_id: String,        // identifies the campaign
    epoch_number: u64,          // which epoch this claim is for
    merkle_root: [u8; 32],      // the root this oracle signed
    deadline: i64,              // oracle-specified expiry (Unix timestamp)
    amount: u64,                // claim amount in base units
    merkle_proof: Vec<[u8; 32]>,// Merkle proof path (max 20 nodes)
    oracle_sig: [u8; 64],       // the Ed25519 signature, for sysvar cross-check
) -> Result<()>
```

**Accounts (`Claim`):**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `claimant` | `Signer<'info>` | Yes | Yes | Wallet claiming; pays rent for `claimed_state` |
| `global_state` | `Account<'info, GlobalState>` | No | No | PDA: `[GLOBAL_STATE_SEED]` |
| `campaign_state` | `Account<'info, CampaignState>` | Yes | No | PDA: `[CAMPAIGN_STATE_SEED, campaign_id]` |
| `campaign_vault` | `Account<'info, TokenAccount>` | Yes | No | PDA: `[CAMPAIGN_VAULT_SEED, campaign_id]` |
| `claimed_state` | `Account<'info, ClaimedState>` | Yes | No | PDA: `[CLAIMED_STATE_SEED, campaign_id, epoch_le, claimant]` — `init` |
| `claimant_token_account` | `Account<'info, TokenAccount>` | Yes | No | Must match `token_mint` and be owned by `claimant` |
| `token_mint` | `Account<'info, Mint>` | No | No | Must match `campaign_state.token_mint` |
| `token_program` | `Program<'info, Token>` | No | No | |
| `system_program` | `Program<'info, System>` | No | No | For `claimed_state` init |
| `instructions` | `Sysvar<'info, Instructions>` | No | No | `#[account(address = sysvar::instructions::ID)]` |

**Security checks (cheapest first):**

```
1.  require!(!global_state.paused)                          — local read
2.  require!(!campaign_state.closed)                        — local read
3.  require!(amount > 0)                                    — local
4.  require!(merkle_proof.len() <= 20)                      — local (prevents DoS via huge proof)
5.  require!(campaign_id_bytes == campaign_state.campaign_id_slice)  — local comparison
6.  require!(campaign_state.token_mint == token_mint.key()) — account key comparison
7.  deadline check: Clock::get()?.unix_timestamp < deadline  — sysvar read (cheap)
8.  balance check: campaign_vault.amount >= amount           — account read
9.  Ed25519 sysvar verification (see §2.3)                  — sysvar + slice work
10. Merkle proof verification                               — hash computations
11. [CEI] Mark claimed_state.claimed = true + set fields    — state change
12. [CEI] transfer_checked from vault to claimant           — CPI (most expensive, last)
```

**CEI pattern enforcement:**

All state changes (step 11) happen before the token transfer (step 12). This mirrors the EVM Checks-Effects-Interactions pattern and prevents reentrancy. On Solana, reentrancy via CPIs is possible if the called program calls back into this program — the CEI ordering prevents any exploitable window.

```rust
// Step 11 — Effects
let claimed_state = &mut ctx.accounts.claimed_state;
claimed_state.wallet = claimant.key();
// ... set all fields ...
claimed_state.claimed = true;

// Step 12 — Interactions
anchor_spl::token::transfer_checked(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.campaign_vault.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.claimant_token_account.to_account_info(),
            authority: ctx.accounts.campaign_state.to_account_info(),
        },
        &[&[CAMPAIGN_STATE_SEED, campaign_id_bytes, &[campaign_state.bump]]],
    ),
    amount,
    token_mint.decimals,
)?;

campaign_state.total_claimed = campaign_state.total_claimed
    .checked_add(amount)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
```

**Ed25519 sysvar verification (step 9 detail):**

```rust
fn verify_oracle_signature(
    instructions_sysvar: &AccountInfo,
    oracle_pubkey: &[u8; 32],
    expected_sig: &[u8; 64],
    campaign_id: &str,
    epoch_number: u64,
    merkle_root: &[u8; 32],
    deadline: i64,
) -> Result<()> {
    // Load instruction at index 0
    let ix_0 = load_instruction_at_checked(0, instructions_sysvar)?;

    // Check program ID is Ed25519SigVerify
    require_keys_eq!(ix_0.program_id, ED25519_PROGRAM_ID, ErrorCode::OracleSignatureInvalid);

    let data = ix_0.data.as_ref();
    // Parse header
    let num_sigs = u16::from_le_bytes([data[0], data[1]]);
    require!(num_sigs == 1, ErrorCode::OracleSignatureInvalid);

    let sig_offset = u16::from_le_bytes([data[3], data[4]]) as usize;
    let pk_offset = u16::from_le_bytes([data[7], data[8]]) as usize;
    let msg_offset = u16::from_le_bytes([data[11], data[12]]) as usize;
    let msg_size = u16::from_le_bytes([data[13], data[14]]) as usize;

    // Extract and compare pubkey
    let ix_pubkey = &data[pk_offset..pk_offset + 32];
    require!(ix_pubkey == oracle_pubkey, ErrorCode::OracleSignatureInvalid);

    // Extract and compare signature
    let ix_sig = &data[sig_offset..sig_offset + 64];
    require!(ix_sig == expected_sig, ErrorCode::OracleSignatureInvalid);

    // Reconstruct expected message and compare
    let expected_msg = build_oracle_message(campaign_id, epoch_number, merkle_root, deadline);
    let ix_msg = &data[msg_offset..msg_offset + msg_size];
    require!(ix_msg == expected_msg.as_slice(), ErrorCode::OracleSignatureInvalid);

    Ok(())
}

fn build_oracle_message(
    campaign_id: &str,
    epoch_number: u64,
    merkle_root: &[u8; 32],
    deadline: i64,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(48 + campaign_id.len());
    msg.extend_from_slice(merkle_root);            // bytes 0–31
    msg.extend_from_slice(&deadline.to_le_bytes()); // bytes 32–39
    msg.extend_from_slice(&epoch_number.to_le_bytes()); // bytes 40–47
    msg.extend_from_slice(campaign_id.as_bytes());  // bytes 48–N
    msg
}
```

**Merkle proof verification (step 10 detail):**

```rust
fn verify_merkle_proof(
    proof: &[[u8; 32]],
    root: &[u8; 32],
    leaf: [u8; 32],
) -> bool {
    let mut computed = leaf;
    for sibling in proof {
        // Sort siblings to match StandardMerkleTree.js canonical ordering
        if computed <= *sibling {
            computed = solana_program::keccak::hashv(&[&computed, sibling]).0;
        } else {
            computed = solana_program::keccak::hashv(&[sibling, &computed]).0;
        }
    }
    computed == *root
}
```

**Emits:** `RewardClaimed { campaign_id, epoch_number, claimant, amount, claimed_at }`

#### 3.4.4 `close_campaign`

Puts a campaign into closed state. Only callable by `global_state.authority` (Mintware controls campaign end dates, same as EVM). Starts the 7-day `WITHDRAWAL_COOLDOWN`.

```rust
pub fn close_campaign(
    ctx: Context<CloseCampaign>,
    campaign_id: String,
) -> Result<()>
```

**Accounts (`CloseCampaign`):**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `authority` | `Signer<'info>` | No | Yes | Must match `global_state.authority` |
| `global_state` | `Account<'info, GlobalState>` | No | No | For authority check |
| `campaign_state` | `Account<'info, CampaignState>` | Yes | No | PDA |

**Security checks:**
1. `require_keys_eq!(authority.key(), global_state.authority)` — key comparison
2. `require!(!campaign_state.closed)` — idempotency guard

**Side effects:**
- Sets `campaign_state.closed = true`, `campaign_state.closed_at = Some(Clock::get()?.unix_timestamp)`
- Emits `CampaignClosed { campaign_id, closed_at }`

#### 3.4.5 `withdraw_campaign`

Recovers remaining vault balance to the creator. Only callable after 7-day cooldown post-close.

```rust
pub fn withdraw_campaign(
    ctx: Context<WithdrawCampaign>,
    campaign_id: String,
) -> Result<()>
```

**Accounts (`WithdrawCampaign`):**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `creator` | `Signer<'info>` | Yes | Yes | Must match `campaign_state.creator` |
| `campaign_state` | `Account<'info, CampaignState>` | Yes | No | PDA |
| `campaign_vault` | `Account<'info, TokenAccount>` | Yes | No | PDA |
| `creator_token_account` | `Account<'info, TokenAccount>` | Yes | No | Creator's token account |
| `token_mint` | `Account<'info, Mint>` | No | No | |
| `token_program` | `Program<'info, Token>` | No | No | |

**Security checks:**
1. `require_keys_eq!(creator.key(), campaign_state.creator)`
2. `require!(campaign_state.closed)`
3. `require!(Clock::get()?.unix_timestamp >= campaign_state.closed_at.unwrap() + WITHDRAWAL_COOLDOWN)`
4. `require!(campaign_vault.amount > 0)`

**Emits:** `CampaignWithdrawn { campaign_id, creator, amount_withdrawn }`

#### 3.4.6 `propose_oracle`

Proposes a new oracle pubkey. Starts 48-hour timelock.

```rust
pub fn propose_oracle(
    ctx: Context<ProposeOracle>,
    new_oracle_pubkey: [u8; 32],
) -> Result<()>
```

**Accounts:** `authority (Signer)`, `global_state (Account<GlobalState>, writable)`

**Security checks:**
1. `require_keys_eq!(authority.key(), global_state.authority)`
2. `require!(new_oracle_pubkey != [0u8; 32])` — reject zero key
3. `require!(global_state.pending_oracle_pubkey.is_none())` — reject if rotation already in progress

**Side effects:** Sets `pending_oracle_pubkey`, `oracle_rotation_proposed_at`. Emits `OracleRotationProposed`.

#### 3.4.7 `confirm_oracle`

Activates the proposed oracle key after the 48-hour timelock.

```rust
pub fn confirm_oracle(ctx: Context<ConfirmOracle>) -> Result<()>
```

**Accounts:** `authority (Signer)`, `global_state (Account<GlobalState>, writable)`

**Security checks:**
1. `require_keys_eq!(authority.key(), global_state.authority)`
2. `require!(global_state.pending_oracle_pubkey.is_some())`
3. `require!(Clock::get()?.unix_timestamp >= global_state.oracle_rotation_proposed_at.unwrap() + ORACLE_ROTATION_DELAY)`

**Emits:** `OracleRotationConfirmed { new_pubkey: global_state.oracle_pubkey }`

#### 3.4.8 `cancel_oracle_rotation`

Cancels an in-progress rotation immediately (no timelock on cancel).

```rust
pub fn cancel_oracle_rotation(ctx: Context<CancelOracleRotation>) -> Result<()>
```

**Accounts:** `authority (Signer)`, `global_state (Account<GlobalState>, writable)`

**Security checks:**
1. `require_keys_eq!(authority.key(), global_state.authority)`
2. `require!(global_state.pending_oracle_pubkey.is_some())`

**Emits:** `OracleRotationCancelled`

#### 3.4.9 `emergency_withdraw`

Drains a campaign vault to the authority when program is paused. Analogous to EVM `emergencyWithdraw`. Requires paused state to prevent misuse.

```rust
pub fn emergency_withdraw(
    ctx: Context<EmergencyWithdraw>,
    campaign_id: String,
) -> Result<()>
```

**Accounts:**

| Account | Type | Writable | Signer | Description |
|---|---|---|---|---|
| `authority` | `Signer<'info>` | Yes | Yes | Must match `global_state.authority` |
| `global_state` | `Account<'info, GlobalState>` | No | No | |
| `campaign_state` | `Account<'info, CampaignState>` | Yes | No | PDA |
| `campaign_vault` | `Account<'info, TokenAccount>` | Yes | No | PDA |
| `authority_token_account` | `Account<'info, TokenAccount>` | Yes | No | Authority's token account |
| `token_mint` | `Account<'info, Mint>` | No | No | |
| `token_program` | `Program<'info, Token>` | No | No | |

**Security checks:**
1. `require!(global_state.paused)` — emergency only
2. `require_keys_eq!(authority.key(), global_state.authority)`
3. `require!(campaign_vault.amount > 0)`

**Emits:** `EmergencyWithdraw { campaign_id, amount, authority }`

### 3.5 Error Enum

```rust
// errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Program is currently paused")]
    ProgramPaused,                          // 6000

    #[msg("Campaign is closed")]
    CampaignClosed,                         // 6001

    #[msg("Campaign ID exceeds maximum length of 64 bytes")]
    CampaignIdTooLong,                      // 6002

    #[msg("Amount must be greater than zero")]
    InvalidAmount,                          // 6003

    #[msg("Claim deadline has passed")]
    DeadlineExpired,                        // 6004

    #[msg("Insufficient vault balance for this claim")]
    InsufficientVaultBalance,               // 6005

    #[msg("Oracle signature verification failed")]
    OracleSignatureInvalid,                 // 6006

    #[msg("Merkle proof verification failed")]
    MerkleProofInvalid,                     // 6007

    #[msg("Reward has already been claimed")]
    AlreadyClaimed,                         // 6008

    #[msg("Merkle proof exceeds maximum length of 20 nodes")]
    MerkleProofTooLong,                     // 6009

    #[msg("Oracle rotation is already in progress")]
    OracleRotationInProgress,               // 6010

    #[msg("Oracle rotation timelock has not elapsed (48 hours required)")]
    OracleRotationTimelockActive,           // 6011

    #[msg("No oracle rotation is currently in progress")]
    NoOracleRotationInProgress,             // 6012

    #[msg("Withdrawal cooldown has not elapsed (7 days required)")]
    WithdrawalCooldownActive,               // 6013

    #[msg("Only the campaign creator can withdraw")]
    NotCampaignCreator,                     // 6014

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,                     // 6015

    #[msg("Token mint mismatch between claim and campaign")]
    TokenMintMismatch,                      // 6016

    #[msg("Ed25519 instruction not found at index 0")]
    MissingEd25519Instruction,              // 6017

    #[msg("Caller is not the program authority")]
    Unauthorized,                           // 6018

    #[msg("Program must be paused for emergency withdrawal")]
    NotPaused,                              // 6019

    #[msg("Cannot propose zero public key as oracle")]
    InvalidOraclePubkey,                    // 6020
}
```

### 3.6 Events

```rust
// events.rs
use anchor_lang::prelude::*;

#[event]
pub struct ProgramInitialized {
    pub authority: Pubkey,
    pub oracle_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct CampaignDeposited {
    pub campaign_id: String,
    pub depositor: Pubkey,
    pub token_mint: Pubkey,
    pub amount_received: u64,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct RewardClaimed {
    pub campaign_id: String,
    pub epoch_number: u64,
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
}

#[event]
pub struct CampaignClosed {
    pub campaign_id: String,
    pub closed_at: i64,
}

#[event]
pub struct CampaignWithdrawn {
    pub campaign_id: String,
    pub creator: Pubkey,
    pub amount_withdrawn: u64,
    pub timestamp: i64,
}

#[event]
pub struct OracleRotationProposed {
    pub new_pubkey: [u8; 32],
    pub proposed_at: i64,
    pub activates_at: i64,           // proposed_at + ORACLE_ROTATION_DELAY
}

#[event]
pub struct OracleRotationConfirmed {
    pub new_pubkey: [u8; 32],
    pub confirmed_at: i64,
}

#[event]
pub struct OracleRotationCancelled {
    pub cancelled_at: i64,
}

#[event]
pub struct EmergencyWithdraw {
    pub campaign_id: String,
    pub amount: u64,
    pub authority: Pubkey,
    pub timestamp: i64,
}
```

### 3.7 Compute Unit Estimates

| Instruction | Estimated CUs | Notes |
|---|---|---|
| `initialize` | ~3,000 | One PDA init |
| `deposit_campaign` | ~8,000–12,000 | Two PDA inits (new campaign) or ~4,000 (existing) |
| `claim` | ~35,000–50,000 | Sysvar read + Merkle hashing (depth 20 = 20 keccak calls) + CPI transfer |
| `close_campaign` | ~2,500 | State write only |
| `withdraw_campaign` | ~8,000 | One CPI transfer |
| `propose_oracle` | ~2,500 | State write |
| `confirm_oracle` | ~2,500 | State write |
| `cancel_oracle_rotation` | ~2,500 | State write |
| `emergency_withdraw` | ~8,000 | One CPI transfer |

The full claim transaction includes the `Ed25519SigVerify` instruction (~3,000 CUs) plus the `claim` instruction. Total transaction budget: ~55,000 CUs, well within the 200,000 default limit. Set `ComputeBudgetProgram::set_compute_unit_limit(70_000)` on the client side to avoid overpaying.

---

## 4. Leaf Encoding Specification

### 4.1 Why Different from EVM

The EVM leaf uses `abi.encode(address, uint256)` which pads the 20-byte Ethereum address to 32 bytes and pads the uint256 to 32 bytes, producing a 64-byte payload. On Solana, addresses are natively 32 bytes (Ed25519 public keys). Using the EVM encoding on Solana would require packing a 32-byte Solana pubkey into a field designed for 20-byte EVM addresses — this causes ambiguity and breaks the `StandardMerkleTree.js` library's encoding assumptions.

The Solana leaf therefore uses a purpose-built encoding that treats the wallet as a full 32-byte pubkey.

### 4.2 Exact Leaf Byte Layout

```
Step 1: Construct the inner payload (40 bytes total)
─────────────────────────────────────────────────────
Offset  Size  Description
0       32    wallet pubkey bytes (Ed25519 public key, 32 bytes, big-endian)
32      8     amount in base token units (u64, little-endian)
              NOTE: little-endian to match Solana's native integer layout

Total: 40 bytes

Step 2: Inner hash
──────────────────
inner_hash = keccak256(inner_payload_40_bytes)   → 32 bytes

Step 3: Leaf hash (double keccak — matches StandardMerkleTree canonical leaf)
──────────────────────────────────────────────────────────────────────────────
leaf = keccak256(inner_hash)                     → 32 bytes
```

Full notation: `leaf = keccak256(keccak256(pubkey_bytes[32] || amount_le_u64[8]))`

### 4.3 Rust Implementation

```rust
use solana_program::keccak;

pub fn compute_leaf(wallet: &Pubkey, amount: u64) -> [u8; 32] {
    // Step 1: build 40-byte payload
    let mut payload = [0u8; 40];
    payload[..32].copy_from_slice(wallet.as_ref());
    payload[32..].copy_from_slice(&amount.to_le_bytes());

    // Step 2: inner hash
    let inner_hash = keccak::hash(&payload).0;  // [u8; 32]

    // Step 3: leaf hash (double keccak)
    keccak::hash(&inner_hash).0
}
```

### 4.4 TypeScript Implementation (for Merkle tree building and API)

The Mintware `epochProcessor.ts` and `solanaPublisher.ts` must use this encoding when building Solana Merkle trees. The `@openzeppelin/merkle-tree` `StandardMerkleTree` class uses its own leaf encoding by default — that encoding is NOT used for Solana trees.

Instead, build a custom Merkle tree using `@noble/hashes/sha3` for keccak256:

```typescript
import { keccak_256 } from "@noble/hashes/sha3";
import { MerkleTree } from "merkletreejs"; // npm: merkletreejs

// Leaf encoding — must match Rust compute_leaf() exactly
export function computeSolanaLeaf(
  walletPubkey: string, // base58 pubkey string
  amount: bigint
): Buffer {
  const pubkeyBytes = Buffer.from(bs58.decode(walletPubkey)); // 32 bytes
  const amountBytes = Buffer.allocUnsafe(8);
  amountBytes.writeBigUInt64LE(amount);                        // little-endian u64

  const payload = Buffer.concat([pubkeyBytes, amountBytes]);   // 40 bytes
  const innerHash = keccak_256(payload);                       // 32 bytes
  return Buffer.from(keccak_256(innerHash));                   // 32 bytes
}

// Build Merkle tree from participants
export function buildSolanaEpochTree(
  participants: Array<{ wallet: string; amount: bigint }>
): MerkleTree {
  const leaves = participants.map((p) =>
    computeSolanaLeaf(p.wallet, p.amount)
  );

  return new MerkleTree(leaves, keccak_256, {
    sortPairs: true, // canonical ordering — must match Rust verify_merkle_proof
    hashLeaves: false, // leaves already hashed
  });
}

// Get proof for a specific wallet
export function getSolanaProof(
  tree: MerkleTree,
  wallet: string,
  amount: bigint
): Buffer[] {
  const leaf = computeSolanaLeaf(wallet, amount);
  return tree.getProof(leaf).map((p) => p.data);
}
```

**Critical detail:** `sortPairs: true` in `merkletreejs` corresponds to the sibling sorting in the Rust `verify_merkle_proof` (`if computed <= *sibling` branch). These must match. If `sortPairs` is false in JS, all proofs will be invalid.

### 4.5 Test Vectors

The following test vectors must pass in both Rust (unit tests in `lib.rs`) and TypeScript (Vitest tests in `solanaPublisher.test.ts`).

**Vector 1 — Known inputs:**

```
wallet:  4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R  (base58)
         → bytes: [0x35, 0xa8, 0x1e, 0xfa, ...]   (32 bytes)
amount:  1_000_000  (1 USDC with 6 decimals)
         → little-endian bytes: [0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00]

payload (40 bytes):
  35a81efa 2f3a9c08 ... [pubkey 32 bytes] ...
  40420f00 00000000                          [amount LE]

inner_hash = keccak256(payload_40_bytes)
  = [compute and record during test implementation]

leaf = keccak256(inner_hash)
  = [compute and record during test implementation]
```

The exact hash values are left as blanks to be filled in during T1 implementation by running both the Rust and TypeScript implementations against this input. The vectors must agree byte-for-byte. Discrepancy means a little-endian vs big-endian error in the amount encoding or pubkey byte ordering.

**Vector 2 — Edge case (max u64 amount):**

```
wallet:  11111111111111111111111111111111  (system program — 32 zero bytes)
amount:  18_446_744_073_709_551_615  (u64::MAX)
         → little-endian: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
```

This tests that 64-bit overflow is not truncated by JavaScript's `Number` type. Use `BigInt` throughout — never cast amount to `Number` before encoding.

**Vector 3 — Two-leaf tree proof verification:**

```
Leaf A: wallet=4k3Dyjz..., amount=1_000_000
Leaf B: wallet=7VFQL3..., amount=2_000_000

root = sortedMerkleRoot(leafA, leafB)
proof_for_A = [leafB]   (if leafA < leafB after sorting)

Verify: keccak256(sort(leafA, leafB)) == root
```

This tests that the Rust `verify_merkle_proof` function and the TypeScript `MerkleTree` agree on sibling ordering.

### 4.6 Important Distinction from EVM Leaf

| Property | EVM leaf | Solana leaf |
|---|---|---|
| Wallet size | 20 bytes (Ethereum address) | 32 bytes (Ed25519 pubkey) |
| Wallet encoding | ABI-encoded (padded to 32 bytes) | Raw bytes (no padding needed) |
| Amount encoding | ABI-encoded (big-endian 32 bytes) | Little-endian 8 bytes |
| Hash function | `keccak256` (via `StandardMerkleTree.of`) | `keccak256` (via `@noble/hashes/sha3`) |
| Double hash | Yes (StandardMerkleTree internal) | Yes (explicit in `compute_leaf`) |
| Total payload | 64 bytes | 40 bytes |

The 40-byte Solana payload is smaller than the 64-byte EVM payload. This is correct and expected — Solana pubkeys need no padding.

---

## 5. Off-Chain TypeScript Specification

### 5.1 `solanaPublisher.ts`

**Location:** `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/lib/web3/solanaPublisher.ts`

This module mirrors `onchainPublisher.ts` for the Solana oracle. It must not import from `onchainPublisher.ts` and must not share private key state with it.

```typescript
// lib/web3/solanaPublisher.ts

import { Connection, Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { keccak_256 } from "@noble/hashes/sha3";
import { createClient } from "@supabase/supabase-js";

/** Shape stored in sol_distributions after signing */
export interface SolDistributionRecord {
  campaign_id: string;
  epoch_number: number;
  merkle_root: string;           // hex string "0x..."
  oracle_sig: string;            // base64 encoded 64-byte signature
  deadline: number;              // Unix timestamp (seconds)
  ipfs_cid: string | null;       // optional — populated by separate IPFS upload step
  status: "pending" | "published" | "finalized";
  created_at: string;
}

/**
 * Build the canonical oracle message bytes for a Solana distribution.
 * MUST match build_oracle_message() in claim.rs exactly.
 */
export function buildSolanaOracleMessage(
  campaignId: string,
  epochNumber: bigint,
  merkleRoot: Uint8Array,        // 32 bytes
  deadline: bigint               // i64 Unix timestamp
): Uint8Array {
  const msgLen = 32 + 8 + 8 + campaignId.length;
  const msg = new Uint8Array(msgLen);
  let offset = 0;

  // bytes 0–31: merkle_root
  msg.set(merkleRoot, offset);
  offset += 32;

  // bytes 32–39: deadline i64 LE
  const deadlineView = new DataView(msg.buffer, offset, 8);
  deadlineView.setBigInt64(0, deadline, true /* little-endian */);
  offset += 8;

  // bytes 40–47: epoch_number u64 LE
  const epochView = new DataView(msg.buffer, offset, 8);
  epochView.setBigUint64(0, epochNumber, true /* little-endian */);
  offset += 8;

  // bytes 48–N: campaign_id UTF-8
  const campaignIdBytes = new TextEncoder().encode(campaignId);
  msg.set(campaignIdBytes, offset);

  return msg;
}

/**
 * Load the oracle keypair from the SOL_ORACLE_PRIVATE_KEY environment variable.
 * The env var holds the 64-byte Solana keypair encoded as base58.
 */
function loadOracleKeypair(): Keypair {
  const raw = process.env.SOL_ORACLE_PRIVATE_KEY;
  if (!raw) throw new Error("SOL_ORACLE_PRIVATE_KEY is not set");
  const bytes = bs58.decode(raw);
  if (bytes.length !== 64) {
    throw new Error(
      `SOL_ORACLE_PRIVATE_KEY must be 64 bytes (got ${bytes.length})`
    );
  }
  return Keypair.fromSecretKey(bytes);
}

/**
 * Sign a Merkle root for a Solana campaign epoch.
 * Stores the result in sol_distributions.
 *
 * @returns The oracle signature as a base64 string (64 bytes)
 */
export async function signSolanaEpoch(params: {
  campaignId: string;
  epochNumber: number;
  merkleRoot: Uint8Array;   // 32 bytes
  deadline: number;         // Unix timestamp in seconds
}): Promise<{ oracleSig: string; publicKey: string }> {
  const keypair = loadOracleKeypair();

  const msg = buildSolanaOracleMessage(
    params.campaignId,
    BigInt(params.epochNumber),
    params.merkleRoot,
    BigInt(params.deadline)
  );

  // Sign using noble/curves ed25519 (same underlying curve as @solana/web3.js)
  const sig = ed25519.sign(msg, keypair.secretKey.slice(0, 32));

  const oracleSig = Buffer.from(sig).toString("base64");
  const publicKey = bs58.encode(keypair.publicKey.toBytes());

  // Persist to sol_distributions
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase.from("sol_distributions").upsert(
    {
      campaign_id: params.campaignId,
      epoch_number: params.epochNumber,
      merkle_root: Buffer.from(params.merkleRoot).toString("hex"),
      oracle_sig: oracleSig,
      deadline: params.deadline,
      status: "published",
    },
    { onConflict: "campaign_id,epoch_number" }
  );

  if (error) throw new Error(`sol_distributions upsert failed: ${error.message}`);

  // Log redacted signature for audit
  const sigRedacted = `${oracleSig.slice(0, 12)}...[REDACTED]`;
  console.log(
    `[solanaPublisher] Signed epoch ${params.epochNumber} for campaign ${params.campaignId}`,
    `| sig=${sigRedacted} | deadline=${params.deadline}`
  );

  return { oracleSig, publicKey };
}
```

**Dependencies to add to `package.json`:**
```json
"@solana/web3.js": "^1.98.0",
"@noble/curves": "^1.4.0",
"merkletreejs": "^0.4.0"
```

Note: `@noble/hashes` is likely already present (used by wagmi/viem ecosystem). Verify before adding.

### 5.2 `sol_distributions` Supabase Table

**Migration file:** `supabase/migrations/20260329000001_sol_distributions.sql`

```sql
-- Solana epoch distribution records
-- Mirrors the `distributions` table structure but for Solana campaigns

CREATE TABLE IF NOT EXISTS sol_distributions (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         TEXT NOT NULL,
  epoch_number        BIGINT NOT NULL,

  -- Merkle root as hex string (64 hex chars = 32 bytes)
  merkle_root         TEXT NOT NULL CHECK (merkle_root ~ '^[0-9a-f]{64}$'),

  -- Oracle Ed25519 signature as base64 (88 chars = 64 bytes base64-encoded)
  oracle_sig          TEXT NOT NULL,

  -- Deadline Unix timestamp (seconds); null means not yet signed
  deadline            BIGINT,

  -- Optional IPFS CID for the full epoch snapshot
  ipfs_cid            TEXT,

  -- Settlement state
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'published', 'finalized')),

  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce one record per (campaign, epoch) pair
  CONSTRAINT sol_distributions_campaign_epoch_unique
    UNIQUE (campaign_id, epoch_number)
);

-- Index for claim API lookups (campaign + epoch is the primary access pattern)
CREATE INDEX idx_sol_distributions_lookup
  ON sol_distributions (campaign_id, epoch_number);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_sol_distributions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sol_distributions_updated_at
  BEFORE UPDATE ON sol_distributions
  FOR EACH ROW EXECUTE FUNCTION update_sol_distributions_updated_at();

-- RLS: server-only (service role key required)
ALTER TABLE sol_distributions ENABLE ROW LEVEL SECURITY;

-- No public access — all reads go through the API route
-- Service role key bypasses RLS
```

### 5.3 Solana Claim API Route

**Location:** `app/api/(rewards)/claim/sol/route.ts`

This is a `GET` endpoint. It returns everything the client needs to construct the claim transaction: the Merkle proof, oracle signature, deadline, and amount.

**Request:**
```
GET /api/claim/sol?campaign=<campaign_id>&epoch=<epoch_number>&wallet=<base58_pubkey>
```

**Response (200):**
```typescript
interface SolClaimResponse {
  campaign_id: string;
  epoch_number: number;
  wallet: string;              // base58 pubkey
  amount: string;              // u64 as string (avoid JS number precision loss)
  merkle_root: string;         // hex string
  merkle_proof: string[];      // array of hex strings, each 32 bytes = 64 hex chars
  oracle_sig: string;          // base64 encoded 64-byte signature
  deadline: number;            // Unix timestamp
  token_mint: string;          // base58 SPL mint address
  campaign_vault: string;      // base58 PDA address of campaign vault
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `missing_params` | Missing `campaign`, `epoch`, or `wallet` |
| 400 | `invalid_wallet` | `wallet` is not valid base58 pubkey |
| 404 | `epoch_not_found` | No record in `sol_distributions` for campaign+epoch |
| 404 | `wallet_not_eligible` | Wallet not in epoch Merkle tree |
| 410 | `deadline_expired` | `deadline < now()` |
| 409 | `already_claimed` | `ClaimedState` PDA exists on-chain (verify via RPC) |
| 500 | `oracle_sig_missing` | `deadline` or `oracle_sig` is null in DB |

**Implementation sketch:**

```typescript
// app/api/(rewards)/claim/sol/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PublicKey, Connection } from "@solana/web3.js";
import { getSolanaProof, buildSolanaEpochTree } from "@/lib/web3/solanaPublisher";

const SOL_RPC = process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const campaignId = searchParams.get("campaign");
  const epochStr = searchParams.get("epoch");
  const wallet = searchParams.get("wallet");

  if (!campaignId || !epochStr || !wallet) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  // Validate wallet is a valid pubkey
  let walletPubkey: PublicKey;
  try {
    walletPubkey = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }

  const epochNumber = parseInt(epochStr, 10);
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch distribution record
  const { data: dist, error: distError } = await supabase
    .from("sol_distributions")
    .select("merkle_root, oracle_sig, deadline, status")
    .eq("campaign_id", campaignId)
    .eq("epoch_number", epochNumber)
    .single();

  if (distError || !dist) {
    return NextResponse.json({ error: "epoch_not_found" }, { status: 404 });
  }

  if (!dist.oracle_sig || dist.deadline === null) {
    return NextResponse.json({ error: "oracle_sig_missing" }, { status: 500 });
  }

  if (dist.deadline < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "deadline_expired" }, { status: 410 });
  }

  // Fetch epoch participants to rebuild tree
  // (participants stored in `activity` table or dedicated `sol_epoch_participants` table — T4 decision)
  const { data: participants } = await supabase
    .from("activity")
    .select("wallet, epoch_points_final")
    .eq("campaign_id", campaignId)
    .eq("epoch_number", epochNumber);

  if (!participants) {
    return NextResponse.json({ error: "epoch_not_found" }, { status: 404 });
  }

  // Find this wallet
  const entry = participants.find(
    (p) => p.wallet.toLowerCase() === wallet.toLowerCase()
  );
  if (!entry) {
    return NextResponse.json({ error: "wallet_not_eligible" }, { status: 404 });
  }

  // Rebuild tree and get proof
  const tree = buildSolanaEpochTree(
    participants.map((p) => ({
      wallet: p.wallet,
      amount: BigInt(p.epoch_points_final),
    }))
  );

  const proof = getSolanaProof(tree, wallet, BigInt(entry.epoch_points_final));
  const root = tree.getRoot();

  // Sanity check root matches DB
  if (root.toString("hex") !== dist.merkle_root) {
    console.error("[sol/claim] Merkle root mismatch — DB may be stale");
    return NextResponse.json({ error: "epoch_not_found" }, { status: 404 });
  }

  // Derive campaign vault PDA for client convenience
  const programId = new PublicKey(process.env.NEXT_PUBLIC_SOL_PROGRAM_ID!);
  const campaignIdBytes = Buffer.from(campaignId);
  const [campaignVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("campaign_vault"), campaignIdBytes],
    programId
  );

  // Fetch token mint from campaign config (Supabase campaigns table)
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("sol_token_mint")
    .eq("id", campaignId)
    .single();

  return NextResponse.json({
    campaign_id: campaignId,
    epoch_number: epochNumber,
    wallet,
    amount: entry.epoch_points_final.toString(),
    merkle_root: dist.merkle_root,
    merkle_proof: proof.map((p) => p.toString("hex")),
    oracle_sig: dist.oracle_sig,
    deadline: dist.deadline,
    token_mint: campaign?.sol_token_mint ?? null,
    campaign_vault: campaignVault.toString(),
  });
}
```

**Rate limiting:** Apply existing `middleware.ts` rate limiter to this route. Add `"/api/claim/sol"` to the rate-limited paths with a limit of 10 req/min per IP (same as EVM claim).

### 5.4 `ClaimCard.tsx` Chain Dispatch

The existing `ClaimCard.tsx` handles EVM claims. A Solana claim path is added as a parallel branch. The component must not break existing EVM functionality.

**Detection logic:**

```typescript
// At the top of ClaimCard, after existing EVM state:
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";

// Inside component:
const { publicKey: solanaPublicKey, sendTransaction } = useSolanaWallet();
const isSolanaReward = reward.chain === "solana" || reward.network_type === "svm";
```

Note: Adding `@solana/wallet-adapter-react` is a non-trivial dependency. If the Solana wallet adapter is not already in the project (it is not as of Phase 1), this must be scaffolded in T5. The component should fail gracefully — if `isSolanaReward` is true but no Solana wallet adapter is available, show a "Connect Solana wallet" prompt instead of the claim button.

**Solana claim flow in ClaimCard:**

```typescript
async function handleSolanaClaim() {
  if (!solanaPublicKey) return;
  setClaimState("loading");

  // 1. Fetch claim data from API
  const res = await fetch(
    `/api/claim/sol?campaign=${reward.campaign_id}&epoch=${reward.epoch_number}&wallet=${solanaPublicKey.toString()}`
  );
  if (!res.ok) {
    const { error } = await res.json();
    setClaimError(error);
    setClaimState("error");
    return;
  }
  const claimData: SolClaimResponse = await res.json();

  // 2. Build transaction
  const connection = new Connection(process.env.NEXT_PUBLIC_SOL_RPC_URL!);
  const transaction = new Transaction();

  // Instruction 0: Ed25519SigVerify
  const oracleSigBytes = Buffer.from(claimData.oracle_sig, "base64");
  const oraclePubkeyBytes = bs58.decode(process.env.NEXT_PUBLIC_SOL_ORACLE_PUBKEY!);
  const message = buildSolanaOracleMessage(
    claimData.campaign_id,
    BigInt(claimData.epoch_number),
    Buffer.from(claimData.merkle_root, "hex"),
    BigInt(claimData.deadline)
  );
  transaction.add(
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: oraclePubkeyBytes,
      message,
      signature: oracleSigBytes,
    })
  );

  // Instruction 1: mintware_distributor::claim
  // (IDL-generated instruction builder — provided by T1 IDL artifact)
  transaction.add(
    await program.methods
      .claim(
        claimData.campaign_id,
        new BN(claimData.epoch_number),
        Array.from(Buffer.from(claimData.merkle_root, "hex")),
        new BN(claimData.deadline),
        new BN(claimData.amount),
        claimData.merkle_proof.map((p) => Array.from(Buffer.from(p, "hex"))),
        Array.from(oracleSigBytes)
      )
      .accounts({
        claimant: solanaPublicKey,
        globalState: globalStatePDA,
        campaignState: campaignStatePDA,
        campaignVault: new PublicKey(claimData.campaign_vault),
        claimedState: claimedStatePDA,
        claimantTokenAccount: claimantTokenAccount,
        tokenMint: new PublicKey(claimData.token_mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction()
  );

  // Set compute budget
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 70_000 })
  );

  // 3. Send transaction
  const sig = await sendTransaction(transaction, connection);
  await connection.confirmTransaction(sig, "confirmed");

  setClaimState("success");
}
```

**UI changes to `ClaimCard.tsx`:** The existing EVM claim button (`handleEVMClaim`) remains unchanged. A new `handleSolanaClaim` function is added. The render branch switches on `isSolanaReward`:

```tsx
{isSolanaReward ? (
  <button onClick={handleSolanaClaim} style={claimButtonStyle}>
    {claimState === "loading" ? "Claiming..." : `Claim ${formattedAmount}`}
  </button>
) : (
  // existing EVM claim button
  <button onClick={handleEVMClaim} style={claimButtonStyle}>
    {/* existing EVM claim UI */}
  </button>
)}
```

The button style is shared (`claimButtonStyle`) — no visual difference between EVM and Solana claim buttons.

---

## 6. Security Model

### Threat 1: Replay Attacks (Cross-Campaign, Cross-Epoch, Cross-Chain)

**Threat:** An oracle signature from epoch 5 of campaign A is submitted for epoch 6 of campaign A, or for a different campaign B, or on EVM using a Solana sig.

**Mitigation:** The oracle message binds `campaign_id`, `epoch_number`, `merkle_root`, and `deadline` into one signed payload. The Anchor program reconstructs this exact message from the `claim` instruction arguments and compares it against the message extracted from the `Ed25519SigVerify` sysvar. Any substitution changes the message bytes, causing the sysvar comparison to fail.

Cross-chain replay is impossible by key type: the Solana oracle uses Ed25519 (`SOL_ORACLE_PRIVATE_KEY`); the EVM oracle uses secp256k1 (`DISTRIBUTOR_PRIVATE_KEY`). An Ed25519 sig cannot be submitted to the EVM `ecrecover`-based verifier and vice versa.

**Residual risk:** None if `campaign_id` and `epoch_number` are unique. The campaign engine must enforce `(campaign_id, epoch_number)` uniqueness in `sol_distributions` (enforced by the `UNIQUE` constraint in the migration).

### Threat 2: Oracle Key Compromise

**Threat:** `SOL_ORACLE_PRIVATE_KEY` is leaked from Vercel. Attacker signs fraudulent Merkle roots and drains campaign vaults.

**Mitigation — layers:**

1. **Detection window:** Attackers cannot submit claims until the oracle sig is paired with a campaign that has vault balance. The `ClaimedState` PDA limits each (campaign, epoch, wallet) triple to one claim — so the attacker must generate one fake sig per wallet per epoch, which is observable volume.
2. **Oracle rotation timelock:** Legitimate rotation takes 48 hours. In a compromise event, call `cancelOracleRotation()` immediately (no timelock), then `proposeOracle(fresh_key)`. During the 48-hour window before new key activation, the old key is still live — this is a known gap. For high-value campaigns, `close_campaign()` can be called immediately to stop new deposits.
3. **Deadline expiry:** Every oracle sig includes a deadline. Mintware should set short deadlines (e.g. 30 days) for Solana campaigns. Leaked sigs expire and cannot be replayed after the deadline.
4. **Key isolation:** `SOL_ORACLE_PRIVATE_KEY` is server-only, never in `NEXT_PUBLIC_*`. It is not the Solana program upgrade authority. Compromise of the oracle key does not allow program upgrades or authority changes.

**Recommended ops procedure:** Rotate oracle key every 90 days as a precaution, independent of compromise.

### Threat 3: Double-Claim

**Threat:** User claims the same (campaign, epoch) reward twice by submitting two transactions.

**Mitigation:** The `ClaimedState` PDA uses Anchor `init` (not `init_if_needed`). If the PDA already exists, the transaction fails at account resolution before any instruction logic executes — the Anchor runtime returns `AccountAlreadyInitialized`. This is a hard constraint enforced by the runtime, not by program logic that could be bypassed.

**Note:** The `claimed: bool` field in `ClaimedState` is redundant for security (existence is the guard) but is included for off-chain readability when indexers query claimed accounts.

### Threat 4: Rent Exhaustion

**Threat:** Attacker creates millions of `ClaimedState` PDAs (each ~0.0016 SOL) to drain program-held SOL reserves, or to force legitimate users to pay excessive rent.

**Mitigation:** The user pays rent for their own `ClaimedState` PDA (the `claimant` account is `mut` and `signer`, and it funds the `init`). The program holds no SOL reserve used for user account rent. The `CampaignState` and `GlobalState` PDAs are funded at creation by the respective initializer.

An attacker creating `ClaimedState` PDAs would be spending their own SOL (0.0016 SOL per account). The only benefit to the attacker is preventing legitimate users from claiming — but the PDA seed includes the wallet pubkey, so one attacker-created `ClaimedState` blocks only the attacker's own wallet from claiming in that epoch, not other wallets.

### Threat 5: Balance Drain via Proof Manipulation

**Threat:** User modifies the `amount` in the `claim` call to claim more than their entitlement.

**Mitigation:** The Merkle leaf encodes `(wallet, amount)` as a pair. Changing either component changes the leaf hash, causing proof verification to fail. The oracle signature covers the Merkle root — any root that would validate a manipulated amount was not signed by the oracle. Three independent checks must all pass: oracle sig, Merkle root match, Merkle proof. All three fail if amount is manipulated.

**Additional guard:** `campaign_vault.amount >= amount` is checked before transfer (step 8 in the security check sequence). If somehow all proof checks passed with a fraudulent amount, the transfer would still fail if the vault is underfunded.

### Threat 6: Admin Key (Authority) Compromise

**Threat:** The Solana program upgrade authority or `GlobalState.authority` is compromised. Attacker calls `close_campaign()` on all campaigns, then `emergency_withdraw()` after pausing, draining all vault balances to their own token accounts.

**Mitigation:**

1. `emergency_withdraw` requires `paused = true` — attacker must also call a `pause` instruction (which does not currently exist in the spec as a standalone instruction). Add a `set_paused(bool)` instruction gated on `global_state.authority` to make the pause state explicit and auditable.
2. `close_campaign` → `withdraw_campaign` requires 7-day cooldown AND creator must call `withdraw_campaign` (not authority). So even if authority calls `close_campaign`, only the campaign creator can recover funds — authority cannot steal creator deposits via this path.
3. `emergency_withdraw` specifically sends funds to `authority_token_account` — this is the emergency path for cases where the creator is unreachable and funds are trapped. This is the only authority-controlled fund recovery path. Mintware must hold this key in a hardware wallet.

**Recommendation:** Use a multisig (e.g. Squads Protocol) as the program upgrade authority and as `GlobalState.authority` before any Mainnet deployment with real funds.

### Threat 7: Campaign Rug by Creator

**Threat:** Campaign creator calls `withdraw_campaign` before participants have claimed their rewards.

**Mitigation:** The 7-day `WITHDRAWAL_COOLDOWN` after `close_campaign` gives participants time to claim. `close_campaign` is controlled by Mintware's `authority`, not the creator — the creator cannot unilaterally close their campaign. Only Mintware can initiate the close, and Mintware controls the timing. The spec deliberately mirrors the EVM `MintwareDistributor.sol` design: `closeCampaign()` is `onlyOwner`.

This means the creator cannot rug; only Mintware can close campaigns. If Mintware malfunctions and fails to close campaigns, tokens remain locked indefinitely in the vault — this is the conservative failure mode. A future upgrade could add a creator-initiated close with a longer cooldown as an escape hatch.

### Threat 8: Stale Signatures (Deadline Not Enforced)

**Threat:** A signature with deadline in 2030 is permanently valid, allowing claims long after the campaign ends.

**Mitigation:**

1. Deadline is enforced on-chain: `require!(Clock::get()?.unix_timestamp < deadline)`.
2. The claim API returns `410 deadline_expired` if `deadline < now()` server-side, providing a user-friendly error before the on-chain tx fails.
3. Mintware's `solanaPublisher.ts` sets `deadline = now() + 90_days` when signing, so all signatures expire in 90 days. This can be reduced for high-security campaigns.
4. After a campaign is closed, Mintware should NOT sign new epochs for that campaign. The 7-day cooldown window is covered by the deadline on the last signed epoch.

**The M1 fix from the EVM audit applies here:** The API must return 500 if `deadline` is null in `sol_distributions` — never silently use a fallback deadline.

### Threat 9: Cross-Program Invocation (CPI) Risks

**Threat:** A malicious program CPIs into `mintware_distributor_sol::claim` to trigger an unauthorized transfer, or this program's CPI to the SPL token program is intercepted.

**Mitigation:**

1. The `claim` instruction requires `claimant` to be a `Signer`. CPIs cannot forge signatures — a CPI caller would need to be the claimant, meaning the CPI call is authorized by definition.
2. The `Ed25519SigVerify` instruction cannot be added by a CPI — it must be present in the original transaction as instruction 0. A CPI-based attack cannot satisfy the sysvar check because the CPI does not add new instructions to the `Instructions` sysvar.
3. The SPL token `transfer_checked` CPI uses PDA signing (`invoke_signed` with `CampaignState` bump) — the campaign vault can only be drained by this program. No other program can drain the vault without compromising the `CampaignState` PDA.
4. Anchor's account deserialization validates discriminators — fake accounts with the right address but wrong type will fail deserialization before instruction logic runs.

**Residual risk:** Solana does not have reentrancy guards analogous to OpenZeppelin's `ReentrancyGuard`. The CEI ordering in `claim` (state change before CPI) prevents the canonical reentrancy attack. However, Solana's runtime already restricts reentrancy — a program cannot be invoked by itself in the same transaction (direct reentrancy is blocked at the VM level). Indirect reentrancy via an intermediate program is theoretically possible but requires the SPL token program to behave maliciously, which is not a realistic threat for canonical SPL tokens.

---

## 7. Deployment and Operations

### 7.1 Anchor.toml

```toml
# Anchor.toml — place at project root alongside foundry.toml
[features]
seeds = false
skip-lint = false

[programs.localnet]
mintware_distributor_sol = "MW7D1sTribUTorS0LaNaPr0gram111111111111111"

[programs.devnet]
mintware_distributor_sol = "MW7D1sTribUTorS0LaNaPr0gram111111111111111"

[programs.mainnet]
mintware_distributor_sol = "MW7D1sTribUTorS0LaNaPr0gram111111111111111"
# ^ replace with actual program ID after first deploy

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
# Override with ANCHOR_WALLET env var for CI

[scripts]
test = "pnpm anchor:test"

[workspace]
members = ["programs/*"]
```

**Add to `package.json` scripts:**
```json
"anchor:build":    "anchor build",
"anchor:test":     "anchor test",
"anchor:deploy:devnet":  "anchor deploy --provider.cluster devnet",
"anchor:deploy:mainnet": "anchor deploy --provider.cluster mainnet",
"test:all":        "pnpm test && pnpm hardhat:test && pnpm forge:test && pnpm anchor:test"
```

### 7.2 Deploy Commands

**Prerequisites:**
```bash
# Install Anchor CLI (version pinned to match Cargo.toml)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1

# Verify
anchor --version   # should print 0.30.1

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
solana --version   # should print 1.18.26
```

**First deploy (Devnet):**
```bash
# 1. Generate program keypair (do this once, keep safe)
solana-keygen new -o target/deploy/mintware_distributor_sol-keypair.json

# 2. Get program ID
solana address -k target/deploy/mintware_distributor_sol-keypair.json
# → copy this into declare_id!() in lib.rs AND into Anchor.toml [programs.devnet]

# 3. Build
pnpm anchor:build

# 4. Configure devnet
solana config set --url devnet
solana airdrop 2   # fund deployer wallet on devnet

# 5. Deploy
pnpm anchor:deploy:devnet

# 6. Initialize GlobalState (run once after deploy)
npx ts-node scripts/sol-initialize.ts --network devnet
```

**Mainnet deploy:**
```bash
# 1. Fund deployer wallet with ~3 SOL (program deployment cost)
# 2. Set ANCHOR_WALLET to hardware wallet or multisig keypair file
export ANCHOR_WALLET=/path/to/mainnet-deployer.json

# 3. Build fresh (ensure no devnet artifacts)
pnpm anchor:build

# 4. Deploy
pnpm anchor:deploy:mainnet

# 5. Initialize
npx ts-node scripts/sol-initialize.ts --network mainnet
```

**Program upgrade:**
```bash
# Upgrade without changing program ID
anchor upgrade \
  --provider.cluster mainnet \
  --program-id MW7D1sTribUTorS0LaNaPr0gram111111111111111 \
  target/deploy/mintware_distributor_sol.so
```

**GlobalState initialization script (`scripts/sol-initialize.ts`):**

```typescript
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import idl from "../target/idl/mintware_distributor_sol.json";

async function main() {
  const network = process.argv.includes("--network") 
    ? process.argv[process.argv.indexOf("--network") + 1] 
    : "devnet";

  const rpc = network === "mainnet"
    ? process.env.SOL_MAINNET_RPC!
    : "https://api.devnet.solana.com";

  const authorityKeypair = Keypair.fromSecretKey(
    bs58.decode(process.env.SOL_AUTHORITY_PRIVATE_KEY!)
  );
  const oraclePubkeyBytes = bs58.decode(
    process.env.NEXT_PUBLIC_SOL_ORACLE_PUBKEY!
  );

  const provider = new AnchorProvider(
    new Connection(rpc),
    new Wallet(authorityKeypair),
    { commitment: "confirmed" }
  );
  const program = new Program(idl as any, provider);

  const tx = await program.methods
    .initialize(Array.from(oraclePubkeyBytes))
    .rpc();

  console.log(`GlobalState initialized. Tx: ${tx}`);
}

main().catch(console.error);
```

### 7.3 Oracle Key Generation Procedure

This procedure is performed once for Devnet and once for Mainnet. The resulting keypair must be stored securely and must never be committed to git.

```bash
# 1. Generate oracle keypair
solana-keygen new --outfile oracle-keypair.json --no-bip39-passphrase
# Prints: pubkey: <BASE58_PUBKEY>

# 2. Display keypair as base58 (this is SOL_ORACLE_PRIVATE_KEY)
# The file oracle-keypair.json contains a JSON array of 64 bytes
# Convert to base58:
cat oracle-keypair.json | python3 -c "
import sys, json, base58
data = json.load(sys.stdin)
print(base58.b58encode(bytes(data)).decode())
"
# Store this output as SOL_ORACLE_PRIVATE_KEY in Vercel

# 3. Confirm the pubkey (SOL_ORACLE_PUBKEY)
solana-keygen pubkey oracle-keypair.json
# Store this as NEXT_PUBLIC_SOL_ORACLE_PUBKEY in Vercel

# 4. IMMEDIATELY delete oracle-keypair.json from local disk
rm oracle-keypair.json

# 5. Verify SOL_ORACLE_PRIVATE_KEY is set in Vercel as server-only
# (not prefixed with NEXT_PUBLIC_)
```

The oracle keypair for Devnet and Mainnet should be different keys. Compromising the Devnet oracle should never reveal the Mainnet oracle key.

### 7.4 Environment Variables

| Variable | Visibility | Description | New? |
|---|---|---|---|
| `SOL_ORACLE_PRIVATE_KEY` | Server-only | 64-byte Ed25519 oracle keypair, base58-encoded | Yes |
| `NEXT_PUBLIC_SOL_ORACLE_PUBKEY` | Public | Base58 pubkey of oracle (for client-side tx construction) | Yes |
| `NEXT_PUBLIC_SOL_PROGRAM_ID` | Public | Deployed program ID (base58) | Yes |
| `SOL_RPC_URL` | Server-only | Solana RPC endpoint (Helius/QuickNode — not public) | Yes |
| `NEXT_PUBLIC_SOL_RPC_URL` | Public | Client-side RPC endpoint (may be rate-limited public) | Yes |
| `SOL_MAINNET_RPC` | Server-only | Mainnet RPC for scripts and publisher | Yes |
| `SOL_AUTHORITY_PRIVATE_KEY` | Server-only | Deployer/authority keypair for admin scripts | Yes |
| `SUPABASE_URL` | Server-only | Existing — no change | Existing |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Existing — no change | Existing |

**Vercel configuration actions required (T6):**
- Add all 7 new variables to Vercel Production, Preview, and Development environments.
- `SOL_ORACLE_PRIVATE_KEY` and `SOL_AUTHORITY_PRIVATE_KEY` are server-only — must not appear in `NEXT_PUBLIC_*`.
- Set `NEXT_PUBLIC_SOL_PROGRAM_ID` to the actual program ID after T1 deploy.

### 7.5 Solana RPC Recommendation

Do not use the public `api.mainnet-beta.solana.com` RPC in production. It rate-limits aggressively and has no SLA. For Phase 7:

- **Server-side (publisher, claim API, admin scripts):** Helius Dedicated (`SOL_RPC_URL`)
- **Client-side (wallet adapter, transaction submission):** QuickNode public-tier or Helius shared (`NEXT_PUBLIC_SOL_RPC_URL`)

Estimated RPC call volume: The claim API calls `getProgramAccounts` to check `ClaimedState` existence (~1 call per claim check), plus tree rebuild from DB (no RPC). Low volume — shared tier sufficient at launch.

---

## 8. Implementation Tickets

### Ticket 1 — Anchor Program Core (Claim + Deposit + Initialize)

**Branch:** `feature/phase-7-t1-anchor-core`
**Depends on:** Nothing (greenfield)
**Estimate:** 5–7 days

**Scope:**
- Create `programs/mintware-distributor-sol/` directory structure
- Implement all three state accounts (`GlobalState`, `CampaignState`, `ClaimedState`) with correct `LEN` constants
- Implement `initialize`, `deposit_campaign`, and `claim` instructions
- Implement `verify_oracle_signature` helper (Ed25519 sysvar parsing)
- Implement `verify_merkle_proof` and `compute_leaf` helpers
- Write error enum and events
- Write Anchor tests (`tests/mintware-distributor-sol.ts`):
  - Test `initialize` happy path
  - Test `deposit_campaign` happy path (new + existing campaign)
  - Test `claim` happy path end-to-end with real Ed25519 sig
  - Test `claim` fails: paused, closed campaign, expired deadline, wrong oracle sig, invalid Merkle proof, double claim
  - Test `claim` fails: mismatched campaign_id in message
  - Test leaf encoding matches TypeScript implementation (test vectors from §4.5)

**Acceptance criteria:**
- `anchor build` succeeds with no warnings
- `anchor test` passes all claim-path tests
- Leaf encoding test vectors match between Rust and TypeScript
- Double-claim protection: second claim for same (campaign, epoch, wallet) returns `AlreadyClaimed` (or Anchor `AccountAlreadyInitialized`)
- Oracle sig swap: sig from epoch 1 fails for epoch 2 with `OracleSignatureInvalid`
- Compute units for a 20-node proof path: < 60,000 CUs (measured in test output)

### Ticket 2 — Lifecycle Instructions (Close, Withdraw, Emergency)

**Branch:** `feature/phase-7-t2-lifecycle`
**Depends on:** T1 complete and passing
**Estimate:** 2–3 days

**Scope:**
- Implement `close_campaign`, `withdraw_campaign`, `emergency_withdraw`
- Implement `propose_oracle`, `confirm_oracle`, `cancel_oracle_rotation`
- Anchor tests for all six instructions:
  - Close → 7-day wait → withdraw (time manipulation via `Clock` mock in tests)
  - Emergency withdraw requires paused
  - Oracle rotation: propose → wait < 48h → confirm fails; wait >= 48h → confirm succeeds
  - Cancel rotation clears pending state
  - Creator-only withdraw guard
  - Authority-only close guard

**Acceptance criteria:**
- All lifecycle state transitions work in tests
- Timelock enforcement tested with timestamp manipulation
- `withdraw_campaign` cannot be called by non-creator
- `close_campaign` cannot be called by non-authority
- `emergency_withdraw` cannot be called when not paused

### Ticket 3 — Supabase Migration + `solanaPublisher.ts`

**Branch:** `feature/phase-7-t3-publisher`
**Depends on:** T1 (leaf encoding finalized from T1 test vectors)
**Estimate:** 2–3 days

**Scope:**
- Write and apply `supabase/migrations/20260329000001_sol_distributions.sql`
- Implement `lib/web3/solanaPublisher.ts`:
  - `buildSolanaOracleMessage()`
  - `signSolanaEpoch()`
  - `buildSolanaEpochTree()`
  - `getSolanaProof()`
  - `computeSolanaLeaf()`
- Wire `signSolanaEpoch()` into existing `epochProcessor.ts`: after Solana epoch closes, call `signSolanaEpoch` in addition to (not instead of) EVM `onchainPublisher`
- Write Vitest tests in `lib/web3/solanaPublisher.test.ts`:
  - `buildSolanaOracleMessage` produces correct byte layout for known inputs
  - `computeSolanaLeaf` matches Rust `compute_leaf` test vectors exactly
  - `buildSolanaEpochTree` produces correct root for known participant set
  - `getSolanaProof` produces proof that verifies against root
  - Signature produced by `signSolanaEpoch` is verifiable using `@noble/curves/ed25519`

**Acceptance criteria:**
- Migration applies cleanly to Supabase dev instance
- Vitest tests pass: `pnpm test` green (existing 147 tests still pass + new Solana tests)
- Leaf encoding test vectors match T1 Rust vectors
- `signSolanaEpoch` inserts correct record into `sol_distributions` (integration test against dev Supabase)
- No `NEXT_PUBLIC_*` usage in `solanaPublisher.ts`

### Ticket 4 — Solana Claim API Route

**Branch:** `feature/phase-7-t4-claim-api`
**Depends on:** T3 (sol_distributions table must exist)
**Estimate:** 1–2 days

**Scope:**
- Implement `app/api/(rewards)/claim/sol/route.ts` per §5.3
- Add `/api/claim/sol` to `middleware.ts` rate-limited paths (10 req/min per IP)
- Decide and implement the participant data source: either query `activity` table (if Solana campaign activity is tracked there) or create `sol_epoch_participants` table. Document the decision in CLAUDE.md update.
- Write integration tests (or manual test script):
  - Valid claim returns correct proof + sig
  - Returns 404 for non-existent epoch
  - Returns 404 for wallet not in tree
  - Returns 410 for expired deadline
  - Returns 500 for missing oracle sig
  - Returned Merkle proof verifies against returned root using `merkletreejs`

**Acceptance criteria:**
- API returns valid proof data for a known Devnet test scenario
- Rate limiter applied: 11th request within 1 minute returns 429
- Returned proof verifies: `tree.verify(proof, leaf, root) === true`
- No EVM claim route is broken (regression test: existing `/api/claim` still works)
- `campaigns` table must have `sol_token_mint` column — if not present, add a migration in this ticket

### Ticket 5 — ClaimCard Solana Dispatch + Wallet Adapter

**Branch:** `feature/phase-7-t5-claimcard`
**Depends on:** T4 (API must exist for end-to-end test), T1 (IDL must be generated)
**Estimate:** 3–4 days

**Scope:**
- Install and configure `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-base` in `providers.tsx`
- Add `WalletProvider` (Solana) to the provider chain in `components/providers.tsx` — wrapped inside existing RainbowKit provider, not replacing it. The two wallet contexts are independent.
- Update `ClaimCard.tsx` per §5.4:
  - Import IDL from `target/idl/mintware_distributor_sol.json` (generated by `anchor build`)
  - Add `handleSolanaClaim` function
  - Add `isSolanaReward` detection
  - Add Solana claim button branch
  - Graceful fallback if no Solana wallet connected ("Connect Solana wallet")
- Add `NEXT_PUBLIC_SOL_PROGRAM_ID` to env and use in PDA derivations
- Manual end-to-end test on Devnet: connect Phantom, claim a test reward, confirm `ClaimedState` PDA exists on-chain

**Acceptance criteria:**
- Existing EVM `ClaimCard` flow unchanged and working
- Solana claim flow builds correct transaction with `Ed25519SigVerify` + `claim` instructions
- `Ed25519SigVerify` is instruction 0; `claim` is instruction 1 — order enforced
- Successful Devnet claim: `ClaimedState` PDA created, token balance increased by claimed amount
- "Already claimed" state shown correctly on second attempt (API returns 409, UI shows claimed state)
- No `console.error` output during happy-path claim flow
- `pnpm build` succeeds (TypeScript compilation clean)

### Ticket 6 — Deployment, Env Vars, and Ops Runbook

**Branch:** `feature/phase-7-t6-deploy`
**Depends on:** T1–T5 all merged to `feature/phase-7`
**Estimate:** 1–2 days

**Scope:**
- Generate Devnet oracle keypair (procedure from §7.3)
- Generate Mainnet oracle keypair (separate from Devnet)
- Deploy program to Devnet; run `sol-initialize.ts` to create `GlobalState`
- Add all 7 new env vars to Vercel (Production, Preview, Development)
- Run `pnpm test:all` — all test suites green
- Deploy program to Mainnet (after Devnet validation)
- Update `CLAUDE.md`: add Phase 7 to confirmed complete list; add `sol_distributions`, `SOL_ORACLE_PRIVATE_KEY`, `NEXT_PUBLIC_SOL_PROGRAM_ID` to env vars table; add `pnpm anchor:build/test/deploy:*` to scripts reference
- Write ops runbook (`memory/phase7/RUNBOOK.md`):
  - How to sign a new epoch for Solana
  - How to rotate oracle key (step-by-step with timing)
  - How to emergency pause the program
  - How to recover from a failed claim (resubmit vs. investigate)
  - How to upgrade the program safely

**Acceptance criteria:**
- `pnpm test:all` green on CI (Forge + Hardhat + Vitest + Anchor)
- Program deployed to Devnet: `anchor deploy` succeeds
- `GlobalState` PDA exists on Devnet with correct oracle pubkey
- All 7 env vars set in Vercel Production (verify with `vercel env ls --environment=production`)
- Ops runbook covers all five scenarios listed above
- Program deployed to Mainnet (or Mainnet deploy explicitly deferred with reason documented)

---

## Appendix A: PDA Address Derivation Reference

| PDA | Seeds | Notes |
|---|---|---|
| `GlobalState` | `[b"global_state"]` | Singleton, one per program |
| `CampaignState` | `[b"campaign_state", campaign_id.as_bytes()]` | One per campaign ID |
| `CampaignVault` | `[b"campaign_vault", campaign_id.as_bytes()]` | SPL token account PDA |
| `ClaimedState` | `[b"claimed_state", campaign_id.as_bytes(), &epoch_number.to_le_bytes(), wallet.as_ref()]` | One per (campaign, epoch, wallet) |

All PDAs use the program's own `program_id`. Bumps are cached in the account struct's `bump` field after first derivation.

## Appendix B: Instruction Index Reference

| Instruction | Index in program | Discriminator |
|---|---|---|
| `initialize` | 0 | `[175, 175, 109, 31, 13, 152, 155, 237]` (Anchor default) |
| `deposit_campaign` | 1 | Anchor-computed from snake_case name |
| `claim` | 2 | Anchor-computed |
| `close_campaign` | 3 | Anchor-computed |
| `withdraw_campaign` | 4 | Anchor-computed |
| `propose_oracle` | 5 | Anchor-computed |
| `confirm_oracle` | 6 | Anchor-computed |
| `cancel_oracle_rotation` | 7 | Anchor-computed |
| `emergency_withdraw` | 8 | Anchor-computed |

Anchor discriminators are `sha256("global:instruction_name")[0..8]`. The IDL generated by `anchor build` contains the exact discriminators — client code should use the IDL-generated instruction builders rather than hardcoding discriminators.

## Appendix C: Account Size and Rent Reference

At Solana mainnet rent schedule (~6.96 lamports per byte per year), with ~1.3MB minimum rent-exempt threshold:

| Account | Size (bytes) | Rent-exempt deposit (approx) |
|---|---|---|
| `GlobalState` | 120 | ~0.00169 SOL |
| `CampaignState` | 168 | ~0.00237 SOL |
| `CampaignVault` (SPL TokenAccount) | 165 | ~0.00203 SOL |
| `ClaimedState` | 136 | ~0.00192 SOL |

The user pays `~0.00192 SOL` per claim as rent for their `ClaimedState` PDA. At a SOL price of $150, this is approximately $0.29 per claim. This is a one-time cost, not recurring. Campaign designers should communicate this to participants.

To recover rent from `ClaimedState` accounts after a campaign fully ends, a future `close_claimed_state` instruction could be added (callable by the claimant only) that closes the account and returns lamports. This is not in scope for Phase 7.

---

*End of specification. Version 1.0 — 2026-03-29.*

*Files referenced by this spec that do not yet exist and must be created:*
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/programs/mintware-distributor-sol/` (entire directory)
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/lib/web3/solanaPublisher.ts`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/app/api/(rewards)/claim/sol/route.ts`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/supabase/migrations/20260329000001_sol_distributions.sql`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/scripts/sol-initialize.ts`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/Anchor.toml`

*Files referenced that exist and will be modified:*
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/components/rewards/campaigns/ClaimCard.tsx`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/components/providers.tsx`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/middleware.ts`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/package.json`
- `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/CLAUDE.md`
