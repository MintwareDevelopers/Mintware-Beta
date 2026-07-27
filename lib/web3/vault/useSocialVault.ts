'use client'
// =============================================================================
// useSocialVault — wagmi hooks for SocialVault on-chain interactions
//
// Three flows:
//   useVaultDeposit   — approve USDC → deposit()
//   useVaultWithdraw  — requestWithdrawal()
//   useVaultSeed      — approve token → seedTeamTokens()
//
// Pattern: each hook returns { write, isPending, isSuccess, isError, error }
// mirroring the ClaimCard.tsx pattern already in the codebase.
//
// All hooks are no-ops when the vault address is not set.
// =============================================================================

import { useState, useEffect }  from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from 'wagmi'
import { parseUnits, keccak256, toBytes }  from 'viem'
import type { LockTier }        from '@/lib/web2/vault/types'
import { SOCIAL_VAULT_ABI, ERC20_ABI, LOCK_TIER_INDEX } from './socialVaultAbi'

const SOCIAL_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '') as `0x${string}`
const USDC_ADDRESS         = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`

// USDC has 6 decimals
const USDC_DECIMALS = 6

// ─── useVaultDeposit ─────────────────────────────────────────────────────────
// Step 1: approve USDC to SocialVault
// Step 2: deposit(amount, tierIndex)
// After success → caller should POST /api/vault/deposit to record in DB

export interface UseVaultDepositResult {
  stage:       'idle' | 'resetting_approval' | 'approving' | 'approved' | 'depositing' | 'success' | 'error'
  isPending:   boolean
  isSuccess:   boolean
  txHash:      `0x${string}` | undefined
  error:       string
  deposit:     (amountUsdc: number, tier: LockTier, wallet: string) => Promise<void>
  reset:       () => void
}

export function useVaultDeposit(): UseVaultDepositResult {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [stage, setStage]     = useState<UseVaultDepositResult['stage']>('idle')
  const [error, setError]     = useState('')
  const [depositHash, setDepositHash] = useState<`0x${string}` | undefined>()

  const { writeContractAsync: writeApprove }  = useWriteContract()
  const { writeContractAsync: writeDeposit }  = useWriteContract()

  const { isSuccess } = useWaitForTransactionReceipt({ hash: depositHash })

  useEffect(() => {
    if (isSuccess && stage === 'depositing') setStage('success')
  }, [isSuccess, stage])

  async function deposit(amountUsdc: number, tier: LockTier, _wallet: string) {
    if (!SOCIAL_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    if (!publicClient) { setError('Network client unavailable'); return }
    setError(''); setStage('approving')
    try {
      const amountWei = parseUnits(amountUsdc.toString(), USDC_DECIMALS)
      const tierIndex = LOCK_TIER_INDEX[tier]
      const currentAllowance = address
        ? await publicClient.readContract({
            address:      USDC_ADDRESS,
            abi:          ERC20_ABI,
            functionName: 'allowance',
            args:         [address, SOCIAL_VAULT_ADDRESS],
          })
        : 0n

      if (currentAllowance < amountWei) {
        try {
          await writeApprove({
            address:      USDC_ADDRESS,
            abi:          ERC20_ABI,
            functionName: 'approve',
            args:         [SOCIAL_VAULT_ADDRESS, amountWei],
          })
        } catch (approvalError) {
          if (currentAllowance > 0n) {
            setStage('resetting_approval')
            await writeApprove({
              address:      USDC_ADDRESS,
              abi:          ERC20_ABI,
              functionName: 'approve',
              args:         [SOCIAL_VAULT_ADDRESS, 0n],
            })
            setStage('approving')
            await writeApprove({
              address:      USDC_ADDRESS,
              abi:          ERC20_ABI,
              functionName: 'approve',
              args:         [SOCIAL_VAULT_ADDRESS, amountWei],
            })
          } else {
            throw approvalError
          }
        }
        setStage('approved')
      } else {
        setStage('approved')
      }

      await publicClient.simulateContract({
        address:      SOCIAL_VAULT_ADDRESS,
        abi:          SOCIAL_VAULT_ABI,
        functionName: 'deposit',
        args:         [amountWei, tierIndex],
        account:      _wallet as `0x${string}`,
      })

      // Step 2: deposit
      setStage('depositing')
      const hash = await writeDeposit({
        address:      SOCIAL_VAULT_ADDRESS,
        abi:          SOCIAL_VAULT_ABI,
        functionName: 'deposit',
        args:         [amountWei, tierIndex],
      })
      setDepositHash(hash)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transaction failed')
      setStage('error')
    }
  }

  function reset() { setStage('idle'); setError(''); setDepositHash(undefined) }

  return {
    stage,
    isPending: stage === 'resetting_approval' || stage === 'approving' || stage === 'approved' || stage === 'depositing',
    isSuccess: stage === 'success',
    txHash:    depositHash,
    error,
    deposit,
    reset,
  }
}

// ─── useVaultWithdraw ────────────────────────────────────────────────────────
// Calls requestWithdrawal(amount) — queues 7-day notice on-chain.
// After success → caller should POST /api/vault/withdraw to mirror in DB.

export interface UseVaultWithdrawResult {
  isPending: boolean
  isSuccess: boolean
  txHash:    `0x${string}` | undefined
  error:     string
  withdraw:  (amountUsdc: number) => void
  reset:     () => void
}

export function useVaultWithdraw(): UseVaultWithdrawResult {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError]   = useState('')

  const { writeContract, isPending }        = useWriteContract()
  const { isSuccess }                       = useWaitForTransactionReceipt({ hash: txHash })

  function withdraw(amountUsdc: number) {
    if (!SOCIAL_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    setError('')
    const amountWei = parseUnits(amountUsdc.toString(), USDC_DECIMALS)
    writeContract(
      {
        address:      SOCIAL_VAULT_ADDRESS,
        abi:          SOCIAL_VAULT_ABI,
        functionName: 'requestWithdrawal',
        args:         [amountWei],
      },
      {
        onSuccess: hash => setTxHash(hash),
        onError:   e    => setError(e.message),
      }
    )
  }

  function reset() { setTxHash(undefined); setError('') }

  return { isPending, isSuccess, txHash, error, withdraw, reset }
}

// ─── useVaultSeed ────────────────────────────────────────────────────────────
// Step 1: approve project token to SocialVault
// Step 2: seedTeamTokens(vaultId, projectToken, amount, poolKey, sqrtPrice)

export interface SeedParams {
  vaultDbId:     string       // UUID from DB — hashed to bytes32
  projectToken:  `0x${string}`
  amountTokens:  bigint       // raw token units (caller must handle decimals)
  poolKey: {
    currency0:   `0x${string}`
    currency1:   `0x${string}`
    fee:         number
    tickSpacing: number
    hooks:       `0x${string}`
  }
  sqrtPriceX96: bigint
}

export interface UseVaultSeedResult {
  stage:     'idle' | 'resetting_approval' | 'approving' | 'approved' | 'seeding' | 'success' | 'error'
  isPending: boolean
  isSuccess: boolean
  txHash:    `0x${string}` | undefined
  error:     string
  seed:      (params: SeedParams) => Promise<void>
  reset:     () => void
}

export function useVaultSeed(): UseVaultSeedResult {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [stage, setStage] = useState<UseVaultSeedResult['stage']>('idle')
  const [error, setError] = useState('')
  const [seedHash, setSeedHash] = useState<`0x${string}` | undefined>()

  const { writeContractAsync: writeApprove } = useWriteContract()
  const { writeContractAsync: writeSeed }    = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash: seedHash })

  useEffect(() => {
    if (isSuccess && stage === 'seeding') setStage('success')
  }, [isSuccess, stage])

  async function seed(params: SeedParams) {
    if (!SOCIAL_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    if (!publicClient) { setError('Network client unavailable'); return }
    setError(''); setStage('approving')
    try {
      // Convert UUID string → bytes32 via keccak256 hash (deterministic)
      const vaultIdBytes32 = keccak256(toBytes(params.vaultDbId)) as `0x${string}`
      const currentAllowance = address
        ? await publicClient.readContract({
            address:      params.projectToken,
            abi:          ERC20_ABI,
            functionName: 'allowance',
            args:         [address, SOCIAL_VAULT_ADDRESS],
          })
        : 0n

      if (currentAllowance < params.amountTokens) {
        try {
          await writeApprove({
            address:      params.projectToken,
            abi:          ERC20_ABI,
            functionName: 'approve',
            args:         [SOCIAL_VAULT_ADDRESS, params.amountTokens],
          })
        } catch (approvalError) {
          if (currentAllowance > 0n) {
            setStage('resetting_approval')
            await writeApprove({
              address:      params.projectToken,
              abi:          ERC20_ABI,
              functionName: 'approve',
              args:         [SOCIAL_VAULT_ADDRESS, 0n],
            })
            setStage('approving')
            await writeApprove({
              address:      params.projectToken,
              abi:          ERC20_ABI,
              functionName: 'approve',
              args:         [SOCIAL_VAULT_ADDRESS, params.amountTokens],
            })
          } else {
            throw approvalError
          }
        }
      }
      setStage('approved')

      await publicClient.simulateContract({
        address:      SOCIAL_VAULT_ADDRESS,
        abi:          SOCIAL_VAULT_ABI,
        functionName: 'seedTeamTokens',
        args: [
          vaultIdBytes32,
          params.projectToken,
          params.amountTokens,
          {
            currency0:   params.poolKey.currency0,
            currency1:   params.poolKey.currency1,
            fee:         params.poolKey.fee,
            tickSpacing: params.poolKey.tickSpacing,
            hooks:       params.poolKey.hooks,
          },
          params.sqrtPriceX96,
        ],
        account:      address as `0x${string}`,
      })

      setStage('seeding')
      const hash = await writeSeed({
        address:      SOCIAL_VAULT_ADDRESS,
        abi:          SOCIAL_VAULT_ABI,
        functionName: 'seedTeamTokens',
        args: [
          vaultIdBytes32,
          params.projectToken,
          params.amountTokens,
          {
            currency0:   params.poolKey.currency0,
            currency1:   params.poolKey.currency1,
            fee:         params.poolKey.fee,
            tickSpacing: params.poolKey.tickSpacing,
            hooks:       params.poolKey.hooks,
          },
          params.sqrtPriceX96,
        ],
      })
      setSeedHash(hash)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transaction failed')
      setStage('error')
    }
  }

  function reset() { setStage('idle'); setError(''); setSeedHash(undefined) }

  return {
    stage,
    isPending: stage === 'resetting_approval' || stage === 'approving' || stage === 'approved' || stage === 'seeding',
    isSuccess: stage === 'success',
    txHash:    seedHash,
    error,
    seed,
    reset,
  }
}

// ─── useVaultPosition ────────────────────────────────────────────────────────
// Read positions(wallet) from SocialVault

export function useVaultPosition(wallet: `0x${string}` | undefined) {
  return useReadContract({
    address:      SOCIAL_VAULT_ADDRESS,
    abi:          SOCIAL_VAULT_ABI,
    functionName: 'positions',
    args:         wallet ? [wallet] : undefined,
    query:        { enabled: !!wallet && !!SOCIAL_VAULT_ADDRESS },
  })
}

// ─── useVaultOnchain ─────────────────────────────────────────────────────────
// Live on-chain state for a SPECIFIC vault contract (per-vault, not the env
// default): the connected wallet's real position + the vault's total liquidity.
// This is the authoritative on-chain read that mirrors the Supabase records.

const TIER_BY_INDEX = ['flex', 'committed', 'aligned', 'core'] as const

export interface VaultOnchainState {
  /** true once at least one read has resolved and the address is a valid vault */
  enabled:         boolean
  isLoading:       boolean
  /** connected wallet's on-chain position (undefined until loaded) */
  position?: {
    usdcDeposited:   number   // human USDC (6-dp scaled)
    depositedAt:     number   // unix seconds (0 if none)
    lockedUntil:     number   // unix seconds (0 if none)
    tier:            LockTier
    compoundEnabled: boolean
    hasPosition:     boolean  // usdcDeposited > 0
  }
  /** vault-wide Uniswap V4 liquidity units (not USD) */
  totalLiquidity?: bigint
}

function isAddr(a?: string | null): a is `0x${string}` {
  return !!a && /^0x[0-9a-fA-F]{40}$/.test(a)
}

export function useVaultOnchain(
  vaultAddress: string | null | undefined,
  wallet:       `0x${string}` | undefined,
): VaultOnchainState {
  const addr    = isAddr(vaultAddress) ? vaultAddress : (isAddr(SOCIAL_VAULT_ADDRESS) ? SOCIAL_VAULT_ADDRESS : undefined)
  const enabled = !!addr

  const posQuery = useReadContract({
    address:      addr,
    abi:          SOCIAL_VAULT_ABI,
    functionName: 'positions',
    args:         wallet ? [wallet] : undefined,
    query:        { enabled: enabled && !!wallet },
  })

  const liqQuery = useReadContract({
    address:      addr,
    abi:          SOCIAL_VAULT_ABI,
    functionName: 'totalLiquidity',
    query:        { enabled },
  })

  const raw = posQuery.data as
    | readonly [bigint, bigint, bigint, number, boolean]
    | undefined

  const position = raw
    ? {
        usdcDeposited:   Number(raw[0]) / 10 ** USDC_DECIMALS,
        depositedAt:     Number(raw[1]),
        lockedUntil:     Number(raw[2]),
        tier:            (TIER_BY_INDEX[raw[3]] ?? 'flex') as LockTier,
        compoundEnabled: raw[4],
        hasPosition:     raw[0] > 0n,
      }
    : undefined

  return {
    enabled,
    isLoading:      enabled && (posQuery.isLoading || liqQuery.isLoading),
    position,
    totalLiquidity: liqQuery.data as bigint | undefined,
  }
}
