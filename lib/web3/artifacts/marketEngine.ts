import { parseAbi } from "viem"

export const MARKET_ENGINE_ABI = [
  ...parseAbi([
    'function poolManager() view returns (address)',
    'function nonQuoteMark() view returns (address)',
    'function appraisalHook() view returns (address)',
    'function permissionsAdapter() view returns (address)',
    'function adapter0() view returns (address)',
    'function adapter1() view returns (address)',
    'function positionLiquidity() view returns (uint128)',
    'function tickLower() view returns (int24)',
    'function tickUpper() view returns (int24)',
  ]),
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'quoteAsset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'poolKey', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }] },
  { type: 'function', name: 'activated', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalNav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }, { name: 'minSharesOut', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'minAmount0', type: 'uint256' }, { name: 'minAmount1', type: 'uint256' }], outputs: [{ name: 'burned', type: 'uint256' }, { name: 'amount0Out', type: 'uint256' }, { name: 'amount1Out', type: 'uint256' }] },
  { type: 'event', name: 'Deposited', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }, { name: 'shares', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Withdrawn', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'sharesBurned', type: 'uint256', indexed: false }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }] },
] as const

export const RWA_HOOK_ABI = parseAbi([
  'function permissionsFactory() view returns (address)',
  'function permissionsAdapter() view returns (address)',
  'function poolManager() view returns (address)',
  'function vault() view returns (address)',
  'function asset() view returns (address)',
  'function quoteAsset() view returns (address)',
  'function expectedPoolId() view returns (bytes32)',
  'function latestMark() view returns (uint256 priceWad, uint64 observedAt)',
  'function bandStatus() view returns (int24 spotTick, int24 appraisalTick, uint256 deviationTicks, bool inCore, bool inSpec, bool fresh)',
  'function config() view returns (uint24 coreBandTicks,uint24 specBandTicks,uint24 maxStepTicks,uint32 minUpdateInterval,uint32 maxAppraisalAge,uint24 coreFeePips,uint24 specFeePips,uint24 maxDriftTicksPerDay,uint32 oracleGraceSecs)',
  'function oracleReady() view returns (bool)',
  'function tradingPaused() view returns (bool)',
])
export const PERMISSIONS_ADAPTER_ABI = parseAbi([
  'function PERMISSIONED_TOKEN() view returns (address)',
  'function POOL_MANAGER() view returns (address)',
  'function allowedWrappers(address wrapper) view returns (bool)',
  'function isAllowed(address account, bytes2 permission) view returns (bool)',
  'function swappingEnabled() view returns (bool)',
])
export const PERMISSIONS_FACTORY_ABI = parseAbi(['function verifiedPermissionsAdapterOf(address adapter) view returns (address)'])
