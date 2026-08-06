// Vault + ERC-20 ABI — only what the frontend needs.
// TARGET: MintwareDeFiVault4626 (the ERC-4626 DeFi vault). The legacy Phase-2 SocialVault
// was retired; this file was repointed to the 4626 successor. (Export name kept as
// SOCIAL_VAULT_ABI to avoid churn; a rename to VAULT_ABI is a cosmetic follow-up.)
// Full ABI lives in contracts-v4/out/MintwareDeFiVault4626.sol/MintwareDeFiVault4626.json

// LockTier enum (matches Solidity enum order exactly)
export const LOCK_TIER_INDEX = {
  flex:      0,
  committed: 1,
  aligned:   2,
  core:      3,
} as const satisfies Record<string, number>

export const SOCIAL_VAULT_ABI = [
  // ── reads ──────────────────────────────────────────────────────────────────
  {
    // MintwareBaseVault4626.locks(address) → LockInfo
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
    // ERC-20 share balance (principal-denominated, 6-dp like USDC)
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'maxRedeem',
    inputs: [{ name: 'owner', type: 'address' }],
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
    name: 'totalPrincipal',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'asset',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // ── writes ─────────────────────────────────────────────────────────────────
  {
    // deposit with an explicit lock tier (Flex/Committed/Aligned/Core)
    type: 'function',
    name: 'depositWithLock',
    inputs: [
      { name: 'assets',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'tier',     type: 'uint8'   },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    // async redemption — step 1: queue shares (7-day notice)
    type: 'function',
    name: 'requestRedeem',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    // async redemption — step 2: settle after the notice period
    type: 'function',
    name: 'executeRedeem',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    // D6 instant redemption for unlocked/Flex positions (past the 24h min-hold)
    type: 'function',
    name: 'redeem',
    inputs: [
      { name: 'shares',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner',    type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'seedTeamTokens',
    inputs: [
      { name: 'vaultId',      type: 'bytes32'  },
      { name: 'projectToken', type: 'address'  },
      { name: 'amount',       type: 'uint256'  },
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0',   type: 'address' },
          { name: 'currency1',   type: 'address' },
          { name: 'fee',         type: 'uint24'  },
          { name: 'tickSpacing', type: 'int24'   },
          { name: 'hooks',       type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── events ─────────────────────────────────────────────────────────────────
  {
    // ERC-4626 Deposit(sender, owner, assets, shares)
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'sender', type: 'address', indexed: true  },
      { name: 'owner',  type: 'address', indexed: true  },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawalRequested',
    inputs: [
      { name: 'owner',        type: 'address', indexed: true  },
      { name: 'shares',       type: 'uint256', indexed: false },
      { name: 'noticeExpiry', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawalExecuted',
    inputs: [
      { name: 'owner',    type: 'address', indexed: true  },
      { name: 'assetsOut', type: 'uint256', indexed: false },
      { name: 'penalty',  type: 'uint256', indexed: false },
    ],
  },
] as const

// Minimal ERC-20 ABI — approve + allowance
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
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const
