'use client'
// =============================================================================
// useSocialVault — wagmi hooks for the LIVE MintwareDeFiPairVault (Base Sepolia).
//
// (Filename kept as useSocialVault.ts to minimise import churn across pages; the
// contract it targets is the dual-sided pair vault, NOT the retired SocialVault.)
//
// Flows:
//   useVaultDeposit       — approve token0 + approve token1 → deposit(a0, a1, 0, tier)
//   useVaultWithdraw      — requestRedeem(shares)          (step 1, 7-day notice)
//   useVaultExecuteRedeem — executeRedeem()                (step 2, after notice)
//   useVaultOnchain       — live read of the wallet's shares + lock + totalLiquidity
//
// Shares are V4 liquidity units (NOT USDC principal). token0 = USDC (6dp),
// token1 = WETH (18dp). Both tokens must be approved before deposit.
// =============================================================================

import { useState, useEffect }  from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract, useChainId, useSwitchChain } from 'wagmi'
import { parseUnits }           from 'viem'
import type { LockTier }        from '@/lib/web2/vault/types'
import { PAIR_VAULT_ABI, ERC20_ABI, LOCK_TIER_INDEX } from './pairVaultAbi'

const PAIR_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '') as `0x${string}`

// token0 = USDC (6dp), token1 = WETH (18dp) on Base Sepolia. Overridable via env.
const TOKEN0_ADDRESS  = (process.env.NEXT_PUBLIC_VAULT_TOKEN0_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`
const TOKEN1_ADDRESS  = (process.env.NEXT_PUBLIC_VAULT_TOKEN1_ADDRESS ?? '0x4200000000000000000000000000000000000006') as `0x${string}`
export const TOKEN0_DECIMALS = Number(process.env.NEXT_PUBLIC_VAULT_TOKEN0_DECIMALS ?? 6)   // USDC
export const TOKEN1_DECIMALS = Number(process.env.NEXT_PUBLIC_VAULT_TOKEN1_DECIMALS ?? 18)  // WETH
export const TOKEN0_SYMBOL = process.env.NEXT_PUBLIC_VAULT_TOKEN0_SYMBOL ?? 'USDC'
export const TOKEN1_SYMBOL = process.env.NEXT_PUBLIC_VAULT_TOKEN1_SYMBOL ?? 'WETH'

// The chain the vault is deployed on (Base Sepolia for the testnet beta). Deposits/
// withdrawals MUST run here — on any other chain the tx reverts, so we switch first.
export const VAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_VAULT_CHAIN_ID ?? 84532)

// ─── useVaultDeposit ─────────────────────────────────────────────────────────
// Step 1: approve token0 (USDC) + token1 (WETH) to the pair vault
// Step 2: deposit(amount0Desired, amount1Desired, minShares=0, tierIndex)
// After success → caller should POST /api/vault/deposit to record in DB.

export interface UseVaultDepositResult {
  stage:       'idle' | 'switching_chain' | 'approving' | 'approved' | 'depositing' | 'success' | 'error'
  isPending:   boolean
  isSuccess:   boolean
  txHash:      `0x${string}` | undefined
  error:       string
  /** deposit(amount0 [USDC human], amount1 [WETH human], tier, wallet) */
  deposit:     (amount0: number, amount1: number, tier: LockTier, wallet: string) => Promise<void>
  reset:       () => void
}

export function useVaultDeposit(): UseVaultDepositResult {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [stage, setStage]     = useState<UseVaultDepositResult['stage']>('idle')
  const [error, setError]     = useState('')
  const [depositHash, setDepositHash] = useState<`0x${string}` | undefined>()

  const { writeContractAsync: writeApprove }  = useWriteContract()
  const { writeContractAsync: writeDeposit }  = useWriteContract()

  const { isSuccess } = useWaitForTransactionReceipt({ hash: depositHash })

  useEffect(() => {
    if (isSuccess && stage === 'depositing') setStage('success')
  }, [isSuccess, stage])

  // Approve `spender` to pull `amountWei` of `token`, with the classic reset-to-0
  // fallback for tokens (like some USDC forks) that revert on a non-zero→non-zero bump.
  async function ensureApproval(token: `0x${string}`, spender: `0x${string}`, amountWei: bigint) {
    if (amountWei === 0n || !address || !publicClient) return
    const current = await publicClient.readContract({
      address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, spender],
    }) as bigint
    if (current >= amountWei) return
    try {
      await writeApprove({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, amountWei] })
    } catch (approvalError) {
      if (current > 0n) {
        await writeApprove({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, 0n] })
        await writeApprove({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, amountWei] })
      } else {
        throw approvalError
      }
    }
  }

  async function deposit(amount0: number, amount1: number, tier: LockTier, _wallet: string) {
    if (!PAIR_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    if (!publicClient) { setError('Network client unavailable'); return }
    if (amount0 <= 0 && amount1 <= 0) { setError('Enter an amount for at least one token'); return }
    setError('')
    // Ensure the wallet is on the vault's chain first — otherwise approve/deposit reverts.
    if (chainId !== VAULT_CHAIN_ID) {
      try {
        setStage('switching_chain')
        await switchChainAsync({ chainId: VAULT_CHAIN_ID })
      } catch {
        setError('Switch your wallet to Base Sepolia to deposit into the beta vault.')
        setStage('error')
        return
      }
    }
    setStage('approving')
    try {
      const amount0Wei = amount0 > 0 ? parseUnits(amount0.toString(), TOKEN0_DECIMALS) : 0n
      const amount1Wei = amount1 > 0 ? parseUnits(amount1.toString(), TOKEN1_DECIMALS) : 0n

      // Approve BOTH sides the vault will pull.
      await ensureApproval(TOKEN0_ADDRESS, PAIR_VAULT_ADDRESS, amount0Wei)
      await ensureApproval(TOKEN1_ADDRESS, PAIR_VAULT_ADDRESS, amount1Wei)
      setStage('approved')

      // minShares = 0 (no slippage floor on testnet). Balanced-liquidity dust is refunded on-chain.
      const args = [amount0Wei, amount1Wei, 0n, LOCK_TIER_INDEX[tier]] as const

      await publicClient.simulateContract({
        address:      PAIR_VAULT_ADDRESS,
        abi:          PAIR_VAULT_ABI,
        functionName: 'deposit',
        args,
        account:      _wallet as `0x${string}`,
      })

      setStage('depositing')
      const hash = await writeDeposit({
        address:      PAIR_VAULT_ADDRESS,
        abi:          PAIR_VAULT_ABI,
        functionName: 'deposit',
        args,
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
    isPending: stage === 'switching_chain' || stage === 'approving' || stage === 'approved' || stage === 'depositing',
    isSuccess: stage === 'success',
    txHash:    depositHash,
    error,
    deposit,
    reset,
  }
}

// ─── useVaultWithdraw ────────────────────────────────────────────────────────
// Calls requestRedeem(shares) — queues the 7-day notice on-chain. `shares` are the
// wallet's on-chain V4 liquidity units (read via useVaultOnchain), NOT a USDC amount.
// After success → caller should POST /api/vault/withdraw to mirror in DB.

export interface UseVaultWithdrawResult {
  isPending: boolean
  isSuccess: boolean
  txHash:    `0x${string}` | undefined
  error:     string
  withdraw:  (shares: bigint) => void
  reset:     () => void
}

export function useVaultWithdraw(): UseVaultWithdrawResult {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError]   = useState('')
  const [switching, setSwitching] = useState(false)

  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContract, isPending }        = useWriteContract()
  const { isSuccess }                       = useWaitForTransactionReceipt({ hash: txHash })

  async function withdraw(shares: bigint) {
    if (!PAIR_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    if (shares <= 0n) { setError('No shares to withdraw'); return }
    setError('')
    // Same-chain requirement as deposit — switch to the vault's chain first.
    if (chainId !== VAULT_CHAIN_ID) {
      try {
        setSwitching(true)
        await switchChainAsync({ chainId: VAULT_CHAIN_ID })
      } catch {
        setError('Switch your wallet to Base Sepolia to withdraw.')
        setSwitching(false)
        return
      }
      setSwitching(false)
    }
    writeContract(
      {
        address:      PAIR_VAULT_ADDRESS,
        abi:          PAIR_VAULT_ABI,
        functionName: 'requestRedeem',
        args:         [shares],
      },
      {
        onSuccess: hash => setTxHash(hash),
        onError:   e    => setError(e.message),
      }
    )
  }

  function reset() { setTxHash(undefined); setError(''); setSwitching(false) }

  return { isPending: isPending || switching, isSuccess, txHash, error, withdraw, reset }
}

// ─── useVaultExecuteRedeem ────────────────────────────────────────────────────
// Step 2 of async redemption: executeRedeem() settles the wallet's queued request
// after its notice window has elapsed. Takes no args — the vault stores one pending
// WithdrawalRequest per wallet.

export interface UseVaultExecuteResult {
  isPending: boolean
  isSuccess: boolean
  txHash:    `0x${string}` | undefined
  error:     string
  execute:   () => void
  reset:     () => void
}

export function useVaultExecuteRedeem(): UseVaultExecuteResult {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError]   = useState('')

  const { writeContract, isPending } = useWriteContract()
  const { isSuccess }                = useWaitForTransactionReceipt({ hash: txHash })

  function execute() {
    if (!PAIR_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    setError('')
    writeContract(
      {
        address:      PAIR_VAULT_ADDRESS,
        abi:          PAIR_VAULT_ABI,
        functionName: 'executeRedeem',
        args:         [],
      },
      {
        onSuccess: hash => setTxHash(hash),
        onError:   e    => setError(e.message),
      }
    )
  }

  function reset() { setTxHash(undefined); setError('') }

  return { isPending, isSuccess, txHash, error, execute, reset }
}

// ─── useVaultClaimFees ────────────────────────────────────────────────────────
// claimFees() pays out accrued swap fees in BOTH tokens for the connected wallet.

export interface UseVaultClaimResult {
  isPending: boolean
  isSuccess: boolean
  txHash:    `0x${string}` | undefined
  error:     string
  claim:     () => void
  reset:     () => void
}

export function useVaultClaimFees(): UseVaultClaimResult {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError]   = useState('')

  const { writeContract, isPending } = useWriteContract()
  const { isSuccess }                = useWaitForTransactionReceipt({ hash: txHash })

  function claim() {
    if (!PAIR_VAULT_ADDRESS) { setError('Vault address not configured'); return }
    setError('')
    writeContract(
      { address: PAIR_VAULT_ADDRESS, abi: PAIR_VAULT_ABI, functionName: 'claimFees', args: [] },
      { onSuccess: hash => setTxHash(hash), onError: e => setError(e.message) },
    )
  }

  function reset() { setTxHash(undefined); setError('') }

  return { isPending, isSuccess, txHash, error, claim, reset }
}

// ─── useVaultPosition ────────────────────────────────────────────────────────
// Read locks(wallet) from the pair vault.

export function useVaultPosition(wallet: `0x${string}` | undefined) {
  return useReadContract({
    address:      PAIR_VAULT_ADDRESS,
    abi:          PAIR_VAULT_ABI,
    functionName: 'locks',
    args:         wallet ? [wallet] : undefined,
    query:        { enabled: !!wallet && !!PAIR_VAULT_ADDRESS },
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
    shares:       bigint    // raw V4 liquidity units owned (== ownership units)
    sharesNum:    number    // shares as a plain number (display convenience)
    depositedAt:  number    // unix seconds (0 if none)
    lockedUntil:  number    // unix seconds (0 if none)
    tier:         LockTier
    hasPosition:  boolean   // shares > 0
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
  const addr    = isAddr(vaultAddress) ? vaultAddress : (isAddr(PAIR_VAULT_ADDRESS) ? PAIR_VAULT_ADDRESS : undefined)
  const enabled = !!addr

  // Lock metadata: locks(wallet) → (depositedAt, lockedUntil, tier, initialized)
  const locksQuery = useReadContract({
    address:      addr,
    abi:          PAIR_VAULT_ABI,
    functionName: 'locks',
    args:         wallet ? [wallet] : undefined,
    query:        { enabled: enabled && !!wallet },
  })

  // Position size: shares(wallet) → V4 liquidity units owned
  const sharesQuery = useReadContract({
    address:      addr,
    abi:          PAIR_VAULT_ABI,
    functionName: 'shares',
    args:         wallet ? [wallet] : undefined,
    query:        { enabled: enabled && !!wallet },
  })

  const liqQuery = useReadContract({
    address:      addr,
    abi:          PAIR_VAULT_ABI,
    functionName: 'totalLiquidity',
    query:        { enabled },
  })

  const lock   = locksQuery.data as readonly [bigint, bigint, number, boolean] | undefined
  const shares = sharesQuery.data as bigint | undefined

  const position = (lock && shares !== undefined)
    ? {
        shares,
        sharesNum:   Number(shares),
        depositedAt: Number(lock[0]),
        lockedUntil: Number(lock[1]),
        tier:        (TIER_BY_INDEX[lock[2]] ?? 'flex') as LockTier,
        hasPosition: shares > 0n,
      }
    : undefined

  return {
    enabled,
    isLoading:      enabled && (locksQuery.isLoading || sharesQuery.isLoading || liqQuery.isLoading),
    position,
    totalLiquidity: liqQuery.data as bigint | undefined,
  }
}
