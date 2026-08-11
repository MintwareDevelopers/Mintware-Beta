// Frontend ABI for MintwareDeFiPairVault — the LIVE dual-sided pair liquidity vault
// (Base Sepolia). This replaces the retired single-sided SocialVault / 4626 ABI.
//
// Source of truth: contracts-v4/src/vaults/MintwareDeFiPairVault.sol
// Full ABI: contracts-v4/out/MintwareDeFiPairVault.sol/MintwareDeFiPairVault.json
//
// Deposits are DUAL-token: the caller approves BOTH token0 and token1 to the vault,
// then calls deposit(amount0Desired, amount1Desired, minShares, tier). Shares are V4
// liquidity units (NOT a USDC 6-dp principal). Withdraw is two-phase:
// requestRedeem(shares) → wait the notice window → executeRedeem().

// LockTier enum (VaultTypes.sol): Flex=0, Committed=1, Aligned=2, Core=3
export const LOCK_TIER_INDEX = {
  flex:      0,
  committed: 1,
  aligned:   2,
  core:      3,
} as const satisfies Record<string, number>

export const PAIR_VAULT_ABI = [
  // ── reads ──────────────────────────────────────────────────────────────────
  {
    // per-wallet share balance (== V4 liquidity units owned)
    type: 'function',
    name: 'shares',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalLiquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'poolInitialized',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    // locks(wallet) → LockInfo(depositedAt, lockedUntil, tier, initialized)
    type: 'function',
    name: 'locks',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'depositedAt',  type: 'uint256' },
      { name: 'lockedUntil',  type: 'uint256' },
      { name: 'tier',         type: 'uint8'   },
      { name: 'initialized',  type: 'bool'    },
    ],
    stateMutability: 'view',
  },
  {
    // withdrawals(wallet) → WithdrawalRequest(shares, noticeExpiry, executed)
    type: 'function',
    name: 'withdrawals',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'shares',       type: 'uint256' },
      { name: 'noticeExpiry', type: 'uint256' },
      { name: 'executed',     type: 'bool'    },
    ],
    stateMutability: 'view',
  },
  {
    // pendingFees(wallet) → (fee0, fee1) accrued but unclaimed
    type: 'function',
    name: 'pendingFees',
    inputs: [{ name: 'lp', type: 'address' }],
    outputs: [
      { name: 'fee0', type: 'uint256' },
      { name: 'fee1', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  // ── writes ─────────────────────────────────────────────────────────────────
  {
    // dual-token deposit; caller must approve BOTH token0 and token1 first
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'amount0Desired', type: 'uint256' },
      { name: 'amount1Desired', type: 'uint256' },
      { name: 'minShares',      type: 'uint256' },
      { name: 'tier',           type: 'uint8'   },
    ],
    outputs: [{ name: 'sharesMinted', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    // async redemption — step 1: queue shares (reverts before depositedAt + MIN_HOLD_PERIOD)
    type: 'function',
    name: 'requestRedeem',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    // async redemption — step 2: settle after noticeExpiry (returns both token amounts)
    type: 'function',
    name: 'executeRedeem',
    inputs: [],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    // claim accrued swap fees in BOTH tokens
    type: 'function',
    name: 'claimFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── events ─────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'lp',           type: 'address', indexed: true  },
      { name: 'amount0',      type: 'uint256', indexed: false },
      { name: 'amount1',      type: 'uint256', indexed: false },
      { name: 'sharesMinted', type: 'uint256', indexed: false },
      { name: 'tier',         type: 'uint8',   indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RedeemRequested',
    inputs: [
      { name: 'lp',           type: 'address', indexed: true  },
      { name: 'shares',       type: 'uint256', indexed: false },
      { name: 'noticeExpiry', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Redeemed',
    inputs: [
      { name: 'lp',       type: 'address', indexed: true  },
      { name: 'shares',   type: 'uint256', indexed: false },
      { name: 'amount0',  type: 'uint256', indexed: false },
      { name: 'amount1',  type: 'uint256', indexed: false },
      { name: 'penalty0', type: 'uint256', indexed: false },
      { name: 'penalty1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeesClaimed',
    inputs: [
      { name: 'lp',      type: 'address', indexed: true  },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
] as const

// Minimal ERC-20 ABI — approve + allowance + balanceOf + decimals (for the two tokens)
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const
