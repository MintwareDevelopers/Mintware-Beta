// SocialVault + ERC-20 approve ABI — only what the frontend needs
// Full ABI lives in contracts-v4/out/SocialVault.sol/SocialVault.json

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
    type: 'function',
    name: 'positions',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'usdcDeposited',    type: 'uint256' },
      { name: 'depositedAt',      type: 'uint256' },
      { name: 'lockedUntil',      type: 'uint256' },
      { name: 'tier',             type: 'uint8'   },
      { name: 'compoundEnabled',  type: 'bool'    },
    ],
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
    name: 'usdc',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // ── writes ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'tier',   type: 'uint8'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestWithdrawal',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
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
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'lp',     type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'tier',   type: 'uint8',   indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawalRequested',
    inputs: [
      { name: 'lp',           type: 'address', indexed: true  },
      { name: 'amount',       type: 'uint256', indexed: false },
      { name: 'noticeExpiry', type: 'uint256', indexed: false },
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
