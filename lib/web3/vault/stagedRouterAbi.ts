// Lean ABIs for the staged-buffer pairing router + the demo proof rig (mock token / adapter).
// Full generated ABI lives in the Forge artifact; this is the hand-picked surface the UI calls.

export const STAGED_ROUTER_ABI = [
  {
    type: 'function', name: 'stage', stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'stagedIsToken0', type: 'bool' },
      { name: 'amount', type: 'uint256' },
      { name: 'adapter', type: 'address' },
    ],
    outputs: [{ name: 'stageId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'pair', stateMutability: 'nonpayable',
    inputs: [
      { name: 'stageId', type: 'uint256' },
      { name: 'counterpartyAmount', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ name: 'lpSharesMinted', type: 'uint256' }],
  },
  {
    type: 'function', name: 'unstage', stateMutability: 'nonpayable',
    inputs: [{ name: 'stageId', type: 'uint256' }],
    outputs: [{ name: 'returned', type: 'uint256' }],
  },
  {
    type: 'function', name: 'stagedAssets', stateMutability: 'view',
    inputs: [{ name: 'stageId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'stages', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'vault', type: 'address' },
      { name: 'adapter', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'stagedIsToken0', type: 'bool' },
      { name: 'active', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'nextStageId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const

// MockERC20 (open mint) + MockYieldAdapter — only used to drive the on-chain testnet demo.
export const DEMO_ERC20_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const
