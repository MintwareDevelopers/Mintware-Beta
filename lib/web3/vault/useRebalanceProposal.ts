// =============================================================================
// useRebalanceProposal.ts — T4.3 — React hook for submitting signed proposals
//
// Responsibilities:
//   1. Fetch pending (unexpired) RangeProposals for a vault from the API
//   2. Expose a `submit(proposal)` function that calls
//      SocialVault.rebalanceWithProposal() on-chain via wagmi writeContract
//   3. Track submission status and update Supabase proposal row on success
//
// Permissionless: any wallet can submit a valid oracle-signed proposal.
// The UI surfaces a "Submit Rebalance" button; keeper bots call the API directly.
//
// Usage:
//   const { proposals, submit, isSubmitting, error } = useRebalanceProposal(vaultDbId, chain)
//
// Architecture: Web3 layer — oracle proposal submission
// =============================================================================

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWalletClient, usePublicClient }  from 'wagmi'

// ─── ABI fragment — only what we need ─────────────────────────────────────────

const REBALANCE_WITH_PROPOSAL_ABI = [
  {
    name:    'rebalanceWithProposal',
    type:    'function',
    inputs: [
      { name: 'vaultId',          type: 'bytes32' },
      { name: 'newTickLower',     type: 'int24'   },
      { name: 'newTickUpper',     type: 'int24'   },
      { name: 'validUntil',       type: 'uint256' },
      { name: 'nonce',            type: 'uint256' },
      { name: 'oracleSignature',  type: 'bytes'   },
    ],
    outputs:          [],
    stateMutability: 'nonpayable',
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RebalanceProposalRow {
  id:               string
  vault_id:         string
  tick_lower:       number
  tick_upper:       number
  reason:           string
  oracle_signature: string
  signer_address:   string
  valid_until:      number   // Unix timestamp
  nonce:            number
  status:           'pending' | 'submitted' | 'expired'
  created_at:       string
}

export interface UseRebalanceProposalResult {
  proposals:   RebalanceProposalRow[]
  isLoading:   boolean
  isSubmitting: boolean
  error:       string | null
  submit:      (proposal: RebalanceProposalRow) => Promise<string | null>
  refresh:     () => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRebalanceProposal(
  vaultDbId:          string | null | undefined,
  socialVaultAddress: `0x${string}` | null | undefined,
): UseRebalanceProposalResult {
  const { data: walletClient } = useWalletClient()
  const publicClient           = usePublicClient()

  const [proposals,    setProposals]    = useState<RebalanceProposalRow[]>([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [refreshKey,   setRefreshKey]   = useState(0)

  // ── Fetch pending proposals ─────────────────────────────────────────────
  useEffect(() => {
    if (!vaultDbId) return

    setIsLoading(true)
    setError(null)

    fetch(`/api/vault/rebalance-proposals?vault_id=${encodeURIComponent(vaultDbId)}`)
      .then(res => res.json())
      .then((data: { proposals?: RebalanceProposalRow[]; error?: string }) => {
        if (data.error) throw new Error(data.error)
        setProposals(data.proposals ?? [])
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to fetch proposals'
        setError(msg)
      })
      .finally(() => setIsLoading(false))
  }, [vaultDbId, refreshKey])

  // ── Submit on-chain ─────────────────────────────────────────────────────
  const submit = useCallback(async (proposal: RebalanceProposalRow): Promise<string | null> => {
    if (!walletClient)        throw new Error('No wallet connected')
    if (!publicClient)        throw new Error('No public client')
    if (!socialVaultAddress)  throw new Error('SocialVault address not set')

    setIsSubmitting(true)
    setError(null)

    try {
      // vaultId in contract = keccak256(toBytes(uuid)) — same pattern as T4.2
      const { keccak256, toBytes } = await import('viem')
      const vaultId = keccak256(toBytes(proposal.vault_id)) as `0x${string}`

      const txHash = await walletClient.writeContract({
        address:      socialVaultAddress,
        abi:          REBALANCE_WITH_PROPOSAL_ABI,
        functionName: 'rebalanceWithProposal',
        args: [
          vaultId,
          proposal.tick_lower,
          proposal.tick_upper,
          BigInt(proposal.valid_until),
          BigInt(proposal.nonce),
          proposal.oracle_signature as `0x${string}`,
        ],
      })

      console.log(
        `[useRebalanceProposal] tx submitted: ${txHash} ` +
        `vault=${proposal.vault_id} nonce=${proposal.nonce}`
      )

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      console.log(`[useRebalanceProposal] ✓ confirmed: ${txHash}`)

      // Mark proposal as submitted in DB
      await fetch('/api/vault/rebalance-proposals/mark-submitted', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ proposal_id: proposal.id, tx_hash: txHash }),
      })

      // Refresh proposal list
      setRefreshKey(k => k + 1)

      return txHash
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed'
      setError(msg)
      console.error('[useRebalanceProposal] submission error:', msg)
      return null
    } finally {
      setIsSubmitting(false)
    }
  }, [walletClient, publicClient, socialVaultAddress])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  return { proposals, isLoading, isSubmitting, error, submit, refresh }
}
