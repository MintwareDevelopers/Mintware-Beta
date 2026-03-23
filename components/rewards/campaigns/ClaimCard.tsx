'use client'

// =============================================================================
// ClaimCard.tsx
//
// Displays all claimable, pending, and claimed rewards for a wallet.
// Called from the /profile page "Rewards" tab.
//
// Flow per reward:
//   1. Fetch GET /api/claim/status?address= on mount
//   2. For 'claimable' rewards, show [Claim Rewards] button
//   3. On click:
//      a. If wrong chain → show Switch Network button (useSwitchChain)
//      b. Fetch GET /api/claim?address=&distribution_id= for proof
//      c. Call writeContract({ claim(distributionId, amountWei, proof) })
//      d. useWaitForTransactionReceipt → pending → success states
//   4. 'claimed' rewards show tx link to block explorer
//   5. 'pending' rewards show "Awaiting on-chain publication" state
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import {
  useChainId,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'

// ---------------------------------------------------------------------------
// MintwareDistributor ABI — only the functions we call (v2)
// 7-param zero-oracle-gas signature: user submits oracle's EIP-712 sig +
// deadline alongside their Merkle proof in a single transaction.
// ---------------------------------------------------------------------------
const DISTRIBUTOR_ABI = [
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId',       type: 'string'    },
      { name: 'epochNumber',      type: 'uint256'   },
      { name: 'merkleRoot',       type: 'bytes32'   },
      { name: 'oracleSignature',  type: 'bytes'     },
      { name: 'deadline',         type: 'uint256'   },  // v2: sig expiry timestamp
      { name: 'amount',           type: 'uint256'   },
      { name: 'merkleProof',      type: 'bytes32[]' },
    ],
    outputs: [],
  },
] as const

// batchClaim ABI — submits multiple claims in one transaction.
// Each element of claimsData maps to a ClaimParams struct on the contract.
const BATCH_DISTRIBUTOR_ABI = [
  {
    name: 'batchClaim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'claimsData',
        type: 'tuple[]',
        components: [
          { name: 'campaignId',      type: 'string'    },
          { name: 'epochNumber',     type: 'uint256'   },
          { name: 'merkleRoot',      type: 'bytes32'   },
          { name: 'oracleSignature', type: 'bytes'     },
          { name: 'deadline',        type: 'uint256'   },
          { name: 'amount',          type: 'uint256'   },
          { name: 'merkleProof',     type: 'bytes32[]' },
        ],
      },
    ],
    outputs: [],
  },
] as const

// ---------------------------------------------------------------------------
// Chain ID mapping
// ---------------------------------------------------------------------------
const CHAIN_IDS: Record<string, number> = {
  base:         8453,
  base_sepolia: 84532,
  core_dao:     1116,
  bnb:          56,
  hardhat:      31337,
}

const CHAIN_NAMES: Record<string, string> = {
  base:         'Base',
  base_sepolia: 'Base Sepolia',
  core_dao:     'Core DAO',
  bnb:          'BNB Chain',
  hardhat:      'Hardhat (local)',
}

const EXPLORER_TX: Record<string, string> = {
  base:         'https://basescan.org/tx/',
  base_sepolia: 'https://sepolia.basescan.org/tx/',
  core_dao:     'https://scan.coredao.org/tx/',
  bnb:          'https://bscscan.com/tx/',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ClaimableReward {
  distribution_id: string | null
  campaign_id: string
  campaign_name: string
  epoch_number: number
  amount_wei: string
  payout_usd: number | null
  token_symbol: string | null
  token_address: string | null
  contract_address: string | null
  chain: string | null
  status: 'claimable' | 'claimed' | 'pending'
  claimed_at: string | null
  published_at: string | null
  created_at: string
  // Zero-oracle-gas fields — populated from /api/claim/status (deadline) or /api/claim (proof)
  merkle_root: string | null
  oracle_signature: string | null
  deadline: number | null
}

interface StatusResponse {
  address: string
  rewards: ClaimableReward[]
  totals: {
    claimable_count: number
    claimed_count: number
    pending_count: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtWei(amountWei: string, symbol: string | null, decimals = 18): string {
  try {
    const val = Number(BigInt(amountWei)) / 10 ** decimals
    const formatted = val < 0.01
      ? val.toFixed(6)
      : val < 1
      ? val.toFixed(4)
      : val.toLocaleString(undefined, { maximumFractionDigits: 2 })
    return `${formatted}${symbol ? ` ${symbol}` : ''}`
  } catch {
    return amountWei
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// RewardRow — one row for each reward in the list
// ---------------------------------------------------------------------------
interface RewardRowProps {
  reward: ClaimableReward
  wallet: string
  onClaimed: () => void
}

function RewardRow({ reward, wallet, onClaimed }: RewardRowProps) {
  const currentChainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const [claimError, setClaimError] = useState<string | null>(null)
  const [isFetchingProof, setIsFetchingProof] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined)

  const {
    writeContract,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isTxSuccess,
  } = useWaitForTransactionReceipt({ hash: txHash })

  // Notify parent on success so it can refetch; also mark claimed in DB
  useEffect(() => {
    if (isTxSuccess && txHash && reward.distribution_id) {
      toast.success('Reward claimed!', {
        description: `${fmtWei(reward.amount_wei, reward.token_symbol)} from ${reward.campaign_name}`,
      })
      // Fire-and-forget: update daily_payouts.claimed_at — never blocks the UI
      fetch('/api/claim/mark-claimed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, distribution_id: reward.distribution_id, tx_hash: txHash }),
      }).catch(() => {})
      onClaimed()
    }
  }, [isTxSuccess, txHash, wallet, reward.distribution_id, onClaimed])

  // Propagate wagmi write errors
  useEffect(() => {
    if (writeError) {
      const msg = (writeError as Error & { shortMessage?: string })?.shortMessage
        ?? writeError.message
        ?? 'Transaction failed'
      setClaimError(msg)
    }
  }, [writeError])

  const targetChainId = reward.chain ? (CHAIN_IDS[reward.chain] ?? null) : null
  const isWrongChain = targetChainId !== null && currentChainId !== targetChainId
  const chainName = reward.chain ? (CHAIN_NAMES[reward.chain] ?? reward.chain) : null

  async function handleClaim() {
    if (!reward.distribution_id || !reward.contract_address) {
      setClaimError('Distribution is not yet deployed on-chain.')
      return
    }

    setClaimError(null)
    setIsFetchingProof(true)

    try {
      // Fetch Merkle proof + oracle signature server-side.
      // tree_json and oracle key never leave the server.
      const res = await fetch(
        `/api/claim?address=${encodeURIComponent(wallet)}&distribution_id=${encodeURIComponent(reward.distribution_id)}`
      )
      const json = await res.json()

      if (!res.ok) {
        setClaimError(json.error ?? 'Failed to fetch claim proof.')
        return
      }

      const { amount_wei, merkle_proof, oracle_signature, merkle_root, campaign_id, epoch_number, deadline } = json as {
        amount_wei: string
        merkle_proof: string[]
        oracle_signature: string
        merkle_root: string
        campaign_id: string
        epoch_number: number
        deadline: number     // v2: unix timestamp — sig expiry set by oracle
      }

      if (!oracle_signature) {
        setClaimError('Distribution is not yet signed. Check back soon.')
        return
      }

      // Submit on-chain claim — 7-param zero-oracle-gas signature (v2):
      //   claim(campaignId, epochNumber, merkleRoot, oracleSignature, deadline, amount, proof)
      writeContract(
        {
          address: reward.contract_address as `0x${string}`,
          abi: DISTRIBUTOR_ABI,
          functionName: 'claim',
          args: [
            campaign_id,                         // string  campaignId
            BigInt(epoch_number),                 // uint256 epochNumber
            merkle_root as `0x${string}`,         // bytes32 merkleRoot
            oracle_signature as `0x${string}`,    // bytes   oracleSignature (EIP-712)
            BigInt(deadline),                     // uint256 deadline (unix timestamp)
            BigInt(amount_wei),                   // uint256 amount
            merkle_proof as `0x${string}`[],      // bytes32[] merkleProof
          ],
          chainId: targetChainId ?? undefined,
        },
        {
          onSuccess: (hash) => {
            setTxHash(hash)
          },
        }
      )
    } catch (err) {
      setClaimError((err as Error).message ?? 'Unknown error')
    } finally {
      setIsFetchingProof(false)
    }
  }

  const explorerBase = reward.chain ? (EXPLORER_TX[reward.chain] ?? null) : null
  const isLoading = isFetchingProof || isWritePending || isConfirming

  // Icon background class based on status
  const iconBgClass = reward.status === 'claimed'
    ? 'bg-[rgba(42,158,138,0.1)]'
    : reward.status === 'claimable'
    ? 'bg-[rgba(58,92,232,0.1)]'
    : 'bg-[rgba(194,83,122,0.1)]'

  // Amount color class based on status
  const amountColorClass = reward.status === 'claimable'
    ? 'text-mw-brand-deep'
    : reward.status === 'claimed'
    ? 'text-mw-teal'
    : 'text-[#1A1A2E]'

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex items-center gap-[14px] px-5 py-4 bg-white border border-[#E8E7F4] rounded-[14px] transition-[box-shadow,border-color] duration-150 hover:border-[rgba(58,92,232,0.2)] hover:shadow-[0_2px_8px_rgba(26,26,46,0.06)]">
      {/* Icon */}
      <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center text-[18px] shrink-0 ${iconBgClass}`}>
        {reward.status === 'claimed'
          ? <CheckCircle2 size={18} />
          : reward.status === 'claimable'
          ? <Circle size={18} />
          : <Clock size={18} />}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-[#1A1A2E] mb-[2px] whitespace-nowrap overflow-hidden text-ellipsis">
          {reward.campaign_name} — Epoch {reward.epoch_number}
        </div>
        <div className="text-[11px] text-mw-ink-4 font-mono">
          {chainName && `${chainName} · `}
          {fmtDate(reward.created_at)}
        </div>
        {isTxSuccess && txHash && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-mw-teal font-mono">
            <CheckCircle2 size={11} /> Claimed!{' '}
            {explorerBase && (
              <a href={`${explorerBase}${txHash}`} target="_blank" rel="noopener noreferrer" className="text-mw-teal underline underline-offset-2">
                View tx ↗
              </a>
            )}
          </div>
        )}
        {reward.status === 'claimed' && reward.claimed_at && !isTxSuccess && (
          <div className="mt-[3px]">
            <span className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[10px] text-[10px] font-semibold tracking-[0.3px] whitespace-nowrap bg-[rgba(42,158,138,0.1)] text-mw-teal">✓ Claimed {fmtDate(reward.claimed_at)}</span>
          </div>
        )}
        {claimError && (
          <div className="text-[11px] text-mw-pink mt-1 max-w-[220px] break-words">
            {claimError}
          </div>
        )}
      </div>

      {/* Amount */}
      <div className={`font-mono text-[15px] font-semibold whitespace-nowrap shrink-0 ${amountColorClass}`}>
        {fmtWei(reward.amount_wei, reward.token_symbol)}
      </div>

      {/* Action */}
      <div className="shrink-0 ml-2">
        {reward.status === 'pending' && (
          <span className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[10px] text-[10px] font-semibold tracking-[0.3px] whitespace-nowrap bg-[rgba(194,83,122,0.1)] text-mw-pink">
            <Clock size={10} /> Pending
          </span>
        )}

        {reward.status === 'claimed' && !isTxSuccess && (
          <span className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[10px] text-[10px] font-semibold tracking-[0.3px] whitespace-nowrap bg-[rgba(42,158,138,0.1)] text-mw-teal">
            <CheckCircle2 size={10} /> Done
          </span>
        )}

        {reward.status === 'claimable' && !isTxSuccess && (
          <>
            {isWrongChain ? (
              <button
                className="px-4 py-2 rounded-full text-[12px] font-semibold cursor-pointer border transition-all duration-150 whitespace-nowrap bg-mw-surface-purple text-mw-brand-deep border-[rgba(58,92,232,0.3)] hover:bg-[rgba(58,92,232,0.08)] disabled:opacity-55 disabled:cursor-not-allowed"
                disabled={isSwitching}
                onClick={() => {
                  if (targetChainId) switchChain({ chainId: targetChainId })
                }}
              >
                {isSwitching ? 'Switching…' : `Switch to ${chainName}`}
              </button>
            ) : (
              <button
                className="px-4 py-2 rounded-full text-[12px] font-semibold cursor-pointer border-none transition-all duration-150 whitespace-nowrap bg-mw-brand-deep text-white hover:bg-[#2a4cd8] hover:shadow-[0_2px_8px_rgba(58,92,232,0.35)] disabled:opacity-55 disabled:cursor-not-allowed"
                disabled={isLoading}
                onClick={handleClaim}
              >
                {isFetchingProof
                  ? 'Preparing…'
                  : isWritePending
                  ? 'Confirm in wallet…'
                  : isConfirming
                  ? 'Confirming…'
                  : 'Claim Rewards'}
              </button>
            )}
          </>
        )}

        {isTxSuccess && (
          <span className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[10px] text-[10px] font-semibold tracking-[0.3px] whitespace-nowrap bg-[rgba(42,158,138,0.1)] text-mw-teal">
            <CheckCircle2 size={10} /> Claimed
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ClaimCard — main export
// ---------------------------------------------------------------------------
interface ClaimCardProps {
  wallet: string
}

export function ClaimCard({ wallet }: ClaimCardProps) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isBatching, setIsBatching]       = useState(false)
  const [batchError, setBatchError]       = useState<string | null>(null)
  const [batchTxHash, setBatchTxHash]     = useState<`0x${string}` | undefined>(undefined)

  const { writeContract: writeBatch, isPending: isBatchPending } = useWriteContract()
  const { isLoading: isBatchConfirming, isSuccess: isBatchSuccess } =
    useWaitForTransactionReceipt({ hash: batchTxHash })

  const currentChainId = useChainId()
  const { switchChain } = useSwitchChain()

  const fetchStatus = useCallback(async () => {
    if (!wallet) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/claim/status?address=${encodeURIComponent(wallet)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load rewards')
      setData(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [wallet])

  // Refetch after successful batch claim
  useEffect(() => {
    if (isBatchSuccess) {
      toast.success('All rewards claimed!', { description: 'Batch claim confirmed on-chain.' })
      fetchStatus()
    }
  }, [isBatchSuccess, fetchStatus])

  const handleBatchClaim = useCallback(async (rewards: ClaimableReward[]) => {
    if (rewards.length === 0 || isBatching) return
    setIsBatching(true)
    setBatchError(null)

    try {
      // Fetch proofs for all claimable rewards in parallel
      const proofResults = await Promise.all(
        rewards.map(async (r) => {
          if (!r.distribution_id) return null
          const res = await fetch(
            `/api/claim?address=${encodeURIComponent(r.token_address ?? '')}&distribution_id=${encodeURIComponent(r.distribution_id)}`
          )
          if (!res.ok) return null
          return await res.json() as {
            amount_wei: string; merkle_proof: string[]; oracle_signature: string
            merkle_root: string; campaign_id: string; epoch_number: number; deadline: number
          }
        })
      )

      // Filter out any proofs that failed
      const validProofs = proofResults.filter((p): p is NonNullable<typeof p> => p !== null)
      if (validProofs.length === 0) {
        setBatchError('Failed to fetch claim proofs. Try claiming individually.')
        return
      }

      // All rewards in a batch must share the same contract + chain
      const contractAddress = rewards[0].contract_address as `0x${string}`

      writeBatch(
        {
          address: contractAddress,
          abi: BATCH_DISTRIBUTOR_ABI,
          functionName: 'batchClaim',
          args: [
            validProofs.map((p, i) => ({
              campaignId:      p.campaign_id,
              epochNumber:     BigInt(p.epoch_number),
              merkleRoot:      p.merkle_root as `0x${string}`,
              oracleSignature: p.oracle_signature as `0x${string}`,
              deadline:        BigInt(p.deadline),
              amount:          BigInt(p.amount_wei),
              merkleProof:     p.merkle_proof as `0x${string}`[],
            })),
          ],
        },
        { onSuccess: (hash) => setBatchTxHash(hash) }
      )
    } catch (err) {
      setBatchError((err as Error).message ?? 'Batch claim failed')
    } finally {
      setIsBatching(false)
    }
  }, [isBatching, writeBatch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const claimable = data?.rewards.filter(r => r.status === 'claimable') ?? []
  const claimed   = data?.rewards.filter(r => r.status === 'claimed') ?? []
  const pending   = data?.rewards.filter(r => r.status === 'pending') ?? []

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {isLoading && (
        <div className="text-center py-12 px-5 text-mw-ink-4 text-[13px]">Loading rewards…</div>
      )}

      {error && !isLoading && (
        <div className="text-center py-6 px-5 text-mw-pink text-[13px] bg-[rgba(194,83,122,0.05)] border border-[rgba(194,83,122,0.15)] rounded-md">
          {error}
          <br />
          <button
            className="mt-[10px] px-[14px] py-[6px] rounded-sm border border-[rgba(194,83,122,0.3)] bg-transparent text-mw-pink text-[12px] cursor-pointer"
            onClick={fetchStatus}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-[18px] flex-wrap gap-[10px]">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-mw-brand-deep">Campaign Rewards</span>
            <div className="flex items-center gap-2">
              {/* Claim All — only shown when 2+ claimable rewards share a contract */}
              {(() => {
                // Group claimable by contract_address
                const batchable = claimable.filter(
                  r => r.contract_address && r.distribution_id
                )
                const contractGroups = new Map<string, ClaimableReward[]>()
                for (const r of batchable) {
                  const key = r.contract_address!
                  if (!contractGroups.has(key)) contractGroups.set(key, [])
                  contractGroups.get(key)!.push(r)
                }
                // Show "Claim All" for the first group with 2+ rewards
                const batchGroup = [...contractGroups.values()].find(g => g.length >= 2)
                if (!batchGroup) return null
                const isBusy = isBatching || isBatchPending || isBatchConfirming
                return (
                  <button
                    className={`px-[14px] py-[6px] rounded-full bg-mw-brand-deep text-white border-none text-[12px] font-semibold font-sans transition-opacity duration-150 ${isBusy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    disabled={isBusy}
                    onClick={() => handleBatchClaim(batchGroup)}
                    title={`Claim ${batchGroup.length} rewards in one transaction`}
                  >
                    {isBatchPending
                      ? 'Confirm in wallet…'
                      : isBatchConfirming
                      ? 'Confirming…'
                      : isBatching
                      ? 'Preparing…'
                      : `Claim All (${batchGroup.length})`}
                  </button>
                )
              })()}
              {data.rewards.length > 0 && (
                <div className="flex gap-2 items-center">
                  {data.totals.claimable_count > 0 && (
                    <span className="px-[10px] py-[3px] rounded-[10px] text-[11px] font-semibold font-mono bg-[rgba(58,92,232,0.1)] text-mw-brand-deep">
                      {data.totals.claimable_count} claimable
                    </span>
                  )}
                  {data.totals.claimed_count > 0 && (
                    <span className="px-[10px] py-[3px] rounded-[10px] text-[11px] font-semibold font-mono bg-[rgba(42,158,138,0.1)] text-mw-teal">
                      {data.totals.claimed_count} claimed
                    </span>
                  )}
                  {data.totals.pending_count > 0 && (
                    <span className="px-[10px] py-[3px] rounded-[10px] text-[11px] font-semibold font-mono bg-[rgba(194,83,122,0.1)] text-mw-pink">
                      {data.totals.pending_count} pending
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Batch claim feedback */}
          {batchError && (
            <div className="mb-3 px-[14px] py-[10px] bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.2)] rounded-[10px] text-[12px] text-mw-pink font-sans">
              {batchError}
            </div>
          )}
          {isBatchSuccess && (
            <div className="mb-3 px-[14px] py-[10px] bg-[rgba(42,158,138,0.06)] border border-[rgba(42,158,138,0.2)] rounded-[10px] text-[12px] text-mw-teal font-sans flex items-center gap-[6px]">
              <CheckCircle2 size={13} /> All rewards claimed successfully!
            </div>
          )}

          {/* Empty state */}
          {data.rewards.length === 0 && (
            <div className="text-center py-12 px-5 bg-white border border-[#E8E7F4] rounded-xl">
              <div className="flex justify-center text-[#C4C3F0] mb-3"><Circle size={36} /></div>
              <div className="text-[15px] font-semibold text-[#1A1A2E] mb-[6px]">No rewards yet</div>
              <div className="text-[12px] text-mw-ink-4 max-w-[280px] mx-auto leading-[1.55]">
                Join a campaign and earn points to receive token rewards at each epoch end.
              </div>
            </div>
          )}

          {/* Claimable */}
          {claimable.length > 0 && (
            <>
              <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-4 mt-5 mb-2">Ready to claim</div>
              <div className="flex flex-col gap-2">
                {claimable.map(r => (
                  <RewardRow
                    key={`${r.distribution_id}-${r.epoch_number}`}
                    reward={r}
                    wallet={wallet}
                    onClaimed={fetchStatus}
                  />
                ))}
              </div>
            </>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <>
              <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-4 mt-5 mb-2">Awaiting publication</div>
              <div className="flex flex-col gap-2">
                {pending.map(r => (
                  <RewardRow
                    key={`${r.campaign_id}-${r.epoch_number}`}
                    reward={r}
                    wallet={wallet}
                    onClaimed={fetchStatus}
                  />
                ))}
              </div>
            </>
          )}

          {/* Claimed */}
          {claimed.length > 0 && (
            <>
              <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-4 mt-5 mb-2">Claimed history</div>
              <div className="flex flex-col gap-2">
                {claimed.map(r => (
                  <RewardRow
                    key={`${r.distribution_id}-${r.epoch_number}-claimed`}
                    reward={r}
                    wallet={wallet}
                    onClaimed={fetchStatus}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
