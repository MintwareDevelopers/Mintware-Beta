// Minimal ABI for the LP-gateway position manager (contracts-v4/src/gateway/
// MintwareLpGatewayPositionManager.sol) — only the members the off-chain layer reads/writes. Kept
// hand-trimmed (not the full artifact) so the bundle stays small; extend as routes need more.

export const LP_GATEWAY_ABI = [
  { type: 'function', stateMutability: 'view', name: 'sharesOf', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'totalShares', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'totalNav', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'deployedPrincipal', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'poke', inputs: [], outputs: [] },
  // Round-3 XR-2: the follower is anchored at creation and the FIRST deploy is banded; the cron pre-flights this.
  { type: 'function', stateMutability: 'view', name: 'referencePrice', inputs: [], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'atBlock', type: 'uint64' }, { name: 'entryHighSqrtPriceX96', type: 'uint160' }] },
  { type: 'function', stateMutability: 'view', name: 'maxDeviationBps', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'depositWithMin', inputs: [{ name: 'quoteAmount', type: 'uint256' }, { name: 'minSharesOut', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'withdrawWithMin', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'minQuoteOut', type: 'uint256' }, { name: 'minPairedOut', type: 'uint256' }], outputs: [{ name: 'quoteOut', type: 'uint256' }, { name: 'pairedOut', type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'tokenId', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'harvestRecipient', inputs: [], outputs: [{ type: 'address' }] },
  // Timelocked harvest-recipient rotation (audit closeout 2026-09-08, F-02 rec. 3): propose → 48h → accept.
  { type: 'function', stateMutability: 'view', name: 'pendingHarvestRecipient', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'harvestRecipientEta', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', stateMutability: 'view', name: 'HARVEST_RECIPIENT_DELAY', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'proposeHarvestRecipient', inputs: [{ name: 'recipient', type: 'address' }], outputs: [] },
  { type: 'function', stateMutability: 'nonpayable', name: 'acceptHarvestRecipient', inputs: [], outputs: [] },
  { type: 'function', stateMutability: 'nonpayable', name: 'cancelHarvestRecipientRotation', inputs: [], outputs: [] },
  // C-10: yield-source outage tolerance. `totalNav` falls back to `lastKnownIdle` while `sourceReadable()` is
  // false — surfaces should flag the figure as STALE then; deposits revert `SourceUnavailable` until it recovers.
  { type: 'function', stateMutability: 'view', name: 'sourceReadable', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'view', name: 'lastKnownIdle', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'quoteAsset', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'pairedAsset', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'poolManager', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'tickLower', inputs: [], outputs: [{ type: 'int24' }] },
  { type: 'function', stateMutability: 'view', name: 'tickUpper', inputs: [], outputs: [{ type: 'int24' }] },
  { type: 'function', stateMutability: 'view', name: 'paused', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'setPaused', inputs: [{ name: 'p', type: 'bool' }], outputs: [] },
  { type: 'function', stateMutability: 'nonpayable', name: 'compoundQuote', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'poolKey',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
  },
  { type: 'function', stateMutability: 'nonpayable', name: 'deposit', inputs: [{ name: 'quoteAmount', type: 'uint256' }], outputs: [{ name: 'sharesMinted', type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'withdraw', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'quoteOut', type: 'uint256' }, { name: 'pairedOut', type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'harvest', inputs: [{ name: 'deadline', type: 'uint256' }], outputs: [{ name: 'quoteFees', type: 'uint256' }, { name: 'pairedFees', type: 'uint256' }] },
  // Earn-vs-LP decision (2026-09-08): `pairedAmount` (owner-supplied) is gone — `deploy()` now swaps
  // `swapAmount` of `quoteToDeploy` into the paired leg atomically, in-contract; `minPairedOut` bounds that
  // swap's own slippage.
  { type: 'function', stateMutability: 'nonpayable', name: 'deploy', inputs: [{ name: 'quoteToDeploy', type: 'uint256' }, { name: 'swapAmount', type: 'uint256' }, { name: 'minPairedOut', type: 'uint256' }, { name: 'minLiquidity', type: 'uint128' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { type: 'function', stateMutability: 'view', name: 'deployedPairedValue', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'principalCap', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'setPrincipalCap', inputs: [{ name: 'cap', type: 'uint256' }], outputs: [] },
  {
    type: 'event',
    name: 'Deployed',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'quoteUsed', type: 'uint256', indexed: false },
      { name: 'pairedUsed', type: 'uint256', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'quoteIn', type: 'uint256', indexed: false },
      { name: 'sharesMinted', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'sharesBurned', type: 'uint256', indexed: false },
      { name: 'quoteOut', type: 'uint256', indexed: false },
      { name: 'pairedOut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'IdleLegUnavailable',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'idleEntitledLastKnown', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HarvestRecipientProposed',
    inputs: [
      { name: 'current', type: 'address', indexed: true },
      { name: 'proposed', type: 'address', indexed: true },
      { name: 'eta', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HarvestRecipientRotated',
    inputs: [
      { name: 'previous', type: 'address', indexed: true },
      { name: 'current', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Harvested',
    inputs: [
      { name: 'quoteFees', type: 'uint256', indexed: false },
      { name: 'pairedFees', type: 'uint256', indexed: false },
      { name: 'recipient', type: 'address', indexed: true },
    ],
  },
] as const

// Must match MintwareLpGatewayPositionManager.VIRTUAL (SeniorSharesMath offset).
export const LP_GATEWAY_VIRTUAL = 1_000_000n

// Minimal ABI for the staging reserve (MintwareLpGatewayStaging.sol).
export const LP_STAGING_ABI = [
  { type: 'function', stateMutability: 'view', name: 'stagedAssets', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'maxUnstageable', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'adapter', inputs: [], outputs: [{ type: 'address' }] },
] as const

// D-4: `depositCap()` exists ONLY on MintwareIdleYieldAdapter (the real MintwareERC4626YieldAdapter has
// `perBlockWithdrawCap` instead) — a staticcall probe for it is how the off-chain layer tells idle mode
// from a real yield source, mirroring the factory's own `_verifyAdapterBinding` staticcall pattern.
export const LP_IDLE_ADAPTER_PROBE_ABI = [
  { type: 'function', stateMutability: 'view', name: 'depositCap', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
