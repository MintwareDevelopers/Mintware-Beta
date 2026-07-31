// RWA oracle-pool NAV keeper.
//
// Reads the RWA vault's on-chain NAV (ERC-4626 convertToAssets) and posts the
// corresponding Q96 appraisal to MintwareOracleHook.setAppraisal, keeping the
// vRWA/USDC pool's price bands centred on NAV. Called by the weekly cron.
//
// Fully env-gated: if the pool isn't wired up yet, it no-ops with skipped:
// 'not_configured' (safe to ship before the pool is deployed). Mirrors the
// server-side keeper pattern in lib/rewards/treasury/sweep.ts.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { appraisalX96FromNav } from '@/lib/rewards/rwa/appraisal'

const VAULT_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
])
const ERC20_ABI = parseAbi(['function decimals() view returns (uint8)'])
const HOOK_ABI = parseAbi([
  'function keeper() view returns (address)',
  'function setAppraisal(bytes32 poolId, uint256 appraisalX96)',
])

export interface NavKeeperReport {
  configured: boolean
  skipped?: 'not_configured' | 'keeper_mismatch'
  chain?: string
  poolId?: string
  appraisalX96?: string
  vrwaIsCurrency0?: boolean
  navAssetsRaw?: string
  txHash?: string
  keeperExpected?: string
  keeperOnChain?: string
}

function normKey(k: string): Hex {
  const s = k.startsWith('0x') ? k.slice(2) : k
  return `0x${s}` as Hex
}

export async function runNavAppraisal(): Promise<NavKeeperReport> {
  const hookAddr   = process.env.RWA_ORACLE_HOOK_ADDRESS
  const poolId     = process.env.RWA_POOL_ID
  const vaultAddr  = process.env.RWA_VAULT_ADDRESS
  const vrwaAddr   = process.env.RWA_POOL_VRWA
  const usdcAddr   = process.env.RWA_POOL_USDC
  const keeperKey  = process.env.RWA_KEEPER_PRIVATE_KEY
  const chainName  = process.env.RWA_POOL_CHAIN ?? 'base_sepolia'

  if (!hookAddr || !poolId || !vaultAddr || !vrwaAddr || !usdcAddr || !keeperKey) {
    return { configured: false, skipped: 'not_configured' }
  }

  const chain: Chain = chainName === 'base' ? base : baseSepolia
  const rpc = chainName === 'base'
    ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org')

  const account = privateKeyToAccount(normKey(keeperKey))
  const publicClient = createPublicClient({ chain, transport: http(rpc) })

  // Read on-chain NAV + token metadata.
  const [shareDecimals, vrwaDecimals, onChainKeeper] = await Promise.all([
    publicClient.readContract({ address: vaultAddr as Address, abi: VAULT_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: vrwaAddr as Address, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: hookAddr as Address, abi: HOOK_ABI, functionName: 'keeper' }),
  ])

  // Don't broadcast a tx that will revert with OnlyKeeper — surface the mismatch.
  if ((onChainKeeper as string).toLowerCase() !== account.address.toLowerCase()) {
    return {
      configured: true, skipped: 'keeper_mismatch', chain: chainName, poolId,
      keeperExpected: account.address, keeperOnChain: onChainKeeper as string,
    }
  }

  const oneWholeShare = 10n ** BigInt(shareDecimals)
  const navAssetsRaw = await publicClient.readContract({
    address: vaultAddr as Address, abi: VAULT_ABI, functionName: 'convertToAssets', args: [oneWholeShare],
  })

  // currency0 is the lower token address (Uniswap ordering).
  const vrwaIsCurrency0 = BigInt(vrwaAddr) < BigInt(usdcAddr)

  const appraisalX96 = appraisalX96FromNav({
    assetsPerWholeShareRaw: navAssetsRaw,
    vrwaDecimals: Number(vrwaDecimals),
    vrwaIsCurrency0,
  })

  const walletClient = createWalletClient({ account, chain, transport: http(rpc) })
  const txHash = await walletClient.writeContract({
    address: hookAddr as Address,
    abi: HOOK_ABI,
    functionName: 'setAppraisal',
    args: [poolId as Hex, appraisalX96],
  })

  return {
    configured: true,
    chain: chainName,
    poolId,
    appraisalX96: appraisalX96.toString(),
    vrwaIsCurrency0,
    navAssetsRaw: navAssetsRaw.toString(),
    txHash,
  }
}
