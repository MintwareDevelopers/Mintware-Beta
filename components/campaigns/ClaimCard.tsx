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
//
// Styling: inline <style> — no Tailwind. Matches profile page design tokens.
// Fonts: Plus Jakarta Sans for labels, DM Mono for amounts/addresses/hashes.
// Colors: #3A5CE8 primary, #F7F6FF background, #2A9E8A success, #C2537A pink
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
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
  // New zero-oracle-gas fields — returned by /api/claim
  merkle_root: string | null
  oracle_signature: string | null
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

  // Notify parent on success so it can refetch
  useEffect(() => {
    if (isTxSuccess) {
      onClaimed()
    }
  }, [isTxSuccess, onClaimed])

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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="reward-row">
      <style>{`
        .reward-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
          background: #fff;
          border: 1px solid #E8E7F4;
          border-radius: 14px;
          transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }
        .reward-row:hover {
          border-color: rgba(58,92,232,0.2);
          box-shadow: 0 2px 8px rgba(26,26,46,0.06);
        }
        .reward-row .rr-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }
        .reward-row .rr-body {
          flex: 1;
          min-width: 0;
        }
        .reward-row .rr-name {
          font-size: 13px;
          font-weight: 600;
          color: #1A1A2E;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .reward-row .rr-meta {
          font-size: 11px;
          color: #8A8C9E;
          font-family: var(--font-mono,'DM Mono',monospace);
        }
        .reward-row .rr-amount {
          font-family: var(--font-mono,'DM Mono',monospace);
          font-size: 15px;
          font-weight: 600;
          color: #1A1A2E;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .reward-row .rr-amount.claimable { color: #3A5CE8; }
        .reward-row .rr-amount.claimed   { color: #2A9E8A; }
        .reward-row .rr-action {
          flex-shrink: 0;
          margin-left: 8px;
        }
        .rr-btn {
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .rr-btn.claim {
          background: #3A5CE8;
          color: #fff;
        }
        .rr-btn.claim:hover:not(:disabled) {
          background: #2a4cd8;
          box-shadow: 0 2px 8px rgba(58,92,232,0.35);
        }
        .rr-btn.claim:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .rr-btn.switch {
          background: #F7F6FF;
          color: #3A5CE8;
          border: 1px solid rgba(58,92,232,0.3);
        }
        .rr-btn.switch:hover:not(:disabled) {
          background: rgba(58,92,232,0.08);
        }
        .rr-btn.switch:disabled { opacity: 0.55; cursor: not-allowed; }
        .rr-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }
        .rr-badge.pending  { background: rgba(194,83,122,0.1); color: #C2537A; }
        .rr-badge.claimed  { background: rgba(42,158,138,0.1); color: #2A9E8A; }
        .rr-badge.claimable{ background: rgba(58,92,232,0.1);  color: #3A5CE8; }
        .rr-success {
          font-size: 11px;
          color: #2A9E8A;
          font-family: var(--font-mono,'DM Mono',monospace);
        }
        .rr-success a {
          color: #2A9E8A;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .rr-error {
          font-size: 11px;
          color: #C2537A;
          margin-top: 4px;
          max-width: 220px;
          word-break: break-word;
        }
      `}</style>

      {/* Icon */}
      <div
        className="rr-icon"
        style={{
          background: reward.status === 'claimed'
            ? 'rgba(42,158,138,0.1)'
            : reward.status === 'claimable'
            ? 'rgba(58,92,232,0.1)'
            : 'rgba(194,83,122,0.1)',
        }}
      >
        {reward.status === 'claimed' ? '✓' : reward.status === 'claimable' ? '◎' : '⏳'}
      </div>

      {/* Body */}
      <div className="rr-body">
        <div className="rr-name">{reward.campaign_name} — Epoch {reward.epoch_number}</div>
        <div className="rr-meta">
          {chainName && `${chainName} · `}
          {fmtDate(reward.created_at)}
        </div>
        {isTxSuccess && txHash && (
          <div className="rr-success" style={{ marginTop: 4 }}>
            ✓ Claimed!{' '}
            {explorerBase && (
              <a href={`${explorerBase}${txHash}`} target="_blank" rel="noopener noreferrer">
                View tx ↗
              </a>
            )}
          </div>
        )}
        {reward.status === 'claimed' && reward.claimed_at && !isTxSuccess && (
          <div style={{ marginTop: 3 }}>
            <span className="rr-badge claimed">✓ Claimed {fmtDate(reward.claimed_at)}</span>
          </div>
        )}
        {claimError && <div className="rr-error">{claimError}</div>}
      </div>

      {/* Amount */}
      <div className={`rr-amount ${reward.status}`}>
        {fmtWei(reward.amount_wei, reward.token_symbol)}
      </div>

      {/* Action */}
      <div className="rr-action">
        {reward.status === 'pending' && (
          <span className="rr-badge pending">⏳ Pending</span>
        )}

        {reward.status === 'claimed' && !isTxSuccess && (
          <span className="rr-badge claimed">✓ Done</span>
        )}

        {reward.status === 'claimable' && !isTxSuccess && (
          <>
            {isWrongChain ? (
              <button
                className="rr-btn switch"
                disabled={isSwitching}
                onClick={() => {
                  if (targetChainId) switchChain({ chainId: targetChainId })
                }}
              >
                {isSwitching ? 'Switching…' : `Switch to ${chainName}`}
              </button>
            ) : (
              <button
                className="rr-btn claim"
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
          <span className="rr-badge claimed">✓ Claimed</span>
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

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const claimable = data?.rewards.filter(r => r.status === 'claimable') ?? []
  const claimed   = data?.rewards.filter(r => r.status === 'claimed') ?? []
  const pending   = data?.rewards.filter(r => r.status === 'pending') ?? []

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <style>{`
        .cc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
          flex-wrap: wrap;
          gap: 10px;
        }
        .cc-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #3A5CE8;
        }
        .cc-totals {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .cc-chip {
          padding: 3px 10px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          font-family: var(--font-mono,'DM Mono',monospace);
        }
        .cc-chip.claimable { background: rgba(58,92,232,0.1);  color: #3A5CE8; }
        .cc-chip.claimed   { background: rgba(42,158,138,0.1); color: #2A9E8A; }
        .cc-chip.pending   { background: rgba(194,83,122,0.1); color: #C2537A; }
        .cc-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #8A8C9E;
          margin: 20px 0 8px;
        }
        .cc-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cc-empty {
          text-align: center;
          padding: 48px 20px;
          background: #fff;
          border: 1px solid #E8E7F4;
          border-radius: 20px;
        }
        .cc-empty-icon {
          font-size: 36px;
          margin-bottom: 12px;
        }
        .cc-empty-title {
          font-size: 15px;
          font-weight: 600;
          color: #1A1A2E;
          margin-bottom: 6px;
        }
        .cc-empty-sub {
          font-size: 12px;
          color: #8A8C9E;
          max-width: 280px;
          margin: 0 auto;
          line-height: 1.55;
        }
        .cc-loading {
          text-align: center;
          padding: 48px 20px;
          color: #8A8C9E;
          font-size: 13px;
        }
        .cc-error {
          text-align: center;
          padding: 24px 20px;
          color: #C2537A;
          font-size: 13px;
          background: rgba(194,83,122,0.05);
          border: 1px solid rgba(194,83,122,0.15);
          border-radius: 12px;
        }
        .cc-refresh-btn {
          margin-top: 10px;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid rgba(194,83,122,0.3);
          background: transparent;
          color: #C2537A;
          font-size: 12px;
          cursor: pointer;
        }
      `}</style>

      {isLoading && (
        <div className="cc-loading">Loading rewards…</div>
      )}

      {error && !isLoading && (
        <div className="cc-error">
          {error}
          <br />
          <button className="cc-refresh-btn" onClick={fetchStatus}>Retry</button>
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {/* Header */}
          <div className="cc-header">
            <span className="cc-title">Campaign Rewards</span>
            {data.rewards.length > 0 && (
              <div className="cc-totals">
                {data.totals.claimable_count > 0 && (
                  <span className="cc-chip claimable">
                    {data.totals.claimable_count} claimable
                  </span>
                )}
                {data.totals.claimed_count > 0 && (
                  <span className="cc-chip claimed">
                    {data.totals.claimed_count} claimed
                  </span>
                )}
                {data.totals.pending_count > 0 && (
                  <span className="cc-chip pending">
                    {data.totals.pending_count} pending
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Empty state */}
          {data.rewards.length === 0 && (
            <div className="cc-empty">
              <div className="cc-empty-icon">◎</div>
              <div className="cc-empty-title">No rewards yet</div>
              <div className="cc-empty-sub">
                Join a campaign and earn points to receive token rewards at each epoch end.
              </div>
            </div>
          )}

          {/* Claimable */}
          {claimable.length > 0 && (
            <>
              <div className="cc-section-label">Ready to claim</div>
              <div className="cc-list">
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
              <div className="cc-section-label">Awaiting publication</div>
              <div className="cc-list">
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
              <div className="cc-section-label">Claimed history</div>
              <div className="cc-list">
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
