'use client'

// =============================================================================
// Step5Review.tsx — Campaign summary + Fund Campaign button
//
// Shows full config, guardrail warnings, funding breakdown.
// Fund flow: approve() → wait → createDistribution() → wait → redirect
// States: idle → approving → waiting_approve → funding → waiting_fund → confirmed
// Uses wagmi writeContract + useWaitForTransactionReceipt
// =============================================================================

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import type { CreatorFormState } from '@/lib/campaigns/creator'
import {
  computeWarnings, fmtUSDShort, fmtPct,
  ERC20_APPROVE_ABI, DISTRIBUTOR_ABI, DISTRIBUTOR_ADDRESS,
} from '@/lib/campaigns/creator'
import { GuardrailWarning } from '@/components/creator/GuardrailWarning'

interface Step5ReviewProps {
  form:        CreatorFormState
  onConfirmed: (campaignId?: string) => void
}

type FundState =
  | 'idle'
  | 'creating'
  | 'approving'
  | 'waiting_approve'
  | 'funding'
  | 'waiting_fund'
  | 'confirmed'
  | 'error'

interface ReviewRowProps {
  label: string
  value: string | React.ReactNode
  mono?: boolean
}

function ReviewRow({ label, value, mono = true }: ReviewRowProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '9px 0', borderBottom: '1px solid #F0EFFF',
    }}>
      <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E' }}>
        {label}
      </span>
      <span style={{
        fontFamily: mono ? 'DM Mono, monospace' : 'Plus Jakarta Sans, sans-serif',
        fontSize: 13, fontWeight: 600, color: '#1A1A2E',
      }}>
        {value}
      </span>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        color: '#8A8C9E', marginBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const FUND_LABELS: Record<FundState, string> = {
  idle:            'Fund Campaign',
  creating:        'Creating campaign…',
  approving:       'Approving token spend…',
  waiting_approve: 'Waiting for approval…',
  funding:         'Funding campaign…',
  waiting_fund:    'Confirming on-chain…',
  confirmed:       '✓ Campaign funded!',
  error:           'Transaction failed — retry',
}

export function Step5Review({ form, onConfirmed }: Step5ReviewProps) {
  const { address } = useAccount()
  const [fundState,   setFundState]   = useState<FundState>('idle')
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)
  const [campaignId,  setCampaignId]  = useState<string | null>(null)

  const warnings = computeWarnings(form)

  // wagmi write hooks
  const {
    writeContract:      writeApprove,
    data:               approveTxHash,
    isPending:          approveIsPending,
    error:              approveWriteError,
    reset:              resetApprove,
  } = useWriteContract()

  const {
    writeContract:      writeFund,
    data:               fundTxHash,
    isPending:          fundIsPending,
    error:              fundWriteError,
    reset:              resetFund,
  } = useWriteContract()

  const {
    isSuccess: approveConfirmed,
    isError:   approveReceiptError,
  } = useWaitForTransactionReceipt({ hash: approveTxHash })

  const {
    isSuccess: fundConfirmed,
    isError:   fundReceiptError,
    data:      fundReceipt,
  } = useWaitForTransactionReceipt({ hash: fundTxHash })

  // Approval confirmed → send depositCampaign tx
  useEffect(() => {
    if (!approveConfirmed || fundState !== 'waiting_approve') return
    if (!form.token || !campaignId) return
    setFundState('funding')
    const amount = parseUnits(String(form.poolUsd), form.token.decimals)
    writeFund({
      address:      DISTRIBUTOR_ADDRESS,
      abi:          DISTRIBUTOR_ABI,
      functionName: 'depositCampaign',
      args: [campaignId, form.token.address as `0x${string}`, amount],
    })
    setFundState('waiting_fund')
  }, [approveConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fund tx submitted
  useEffect(() => {
    if (fundIsPending && fundState === 'funding') setFundState('waiting_fund')
  }, [fundIsPending]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fund confirmed
  useEffect(() => {
    if (!fundConfirmed) return
    setFundState('confirmed')
    onConfirmed(campaignId ?? undefined)
  }, [fundConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Error handling
  useEffect(() => {
    if (!approveWriteError && !fundWriteError && !approveReceiptError && !fundReceiptError) return
    const msg = approveWriteError?.message ?? fundWriteError?.message ?? 'Transaction failed.'
    setErrorMsg(msg.split('\n')[0])
    setFundState('error')
    resetApprove()
    resetFund()
  }, [approveWriteError, fundWriteError, approveReceiptError, fundReceiptError]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFund() {
    if (!form.token || (fundState !== 'idle' && fundState !== 'error')) return
    setErrorMsg(null)
    setFundState('creating')

    // Step 1: create campaign record in Supabase
    let newCampaignId: string
    try {
      const walletAddr = address ?? ''
      const res  = await fetch('/api/campaigns/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ form, wallet: walletAddr }),
      })
      const data = await res.json() as { campaignId?: string; error?: string }
      if (!res.ok || !data.campaignId) throw new Error(data.error ?? 'Failed to create campaign')
      newCampaignId = data.campaignId
      setCampaignId(newCampaignId)
    } catch (err) {
      setErrorMsg((err as Error).message)
      setFundState('error')
      return
    }

    // Step 2: approve token spend
    setFundState('approving')
    const amount = parseUnits(String(form.poolUsd), form.token.decimals)
    writeApprove({
      address:      form.token.address as `0x${string}`,
      abi:          ERC20_APPROVE_ABI,
      functionName: 'approve',
      args:         [DISTRIBUTOR_ADDRESS, amount],
    })
    if (approveIsPending) setFundState('waiting_approve')
  }

  // Transition approving → waiting after tx is submitted
  useEffect(() => {
    if (approveIsPending && fundState === 'approving') setFundState('waiting_approve')
  }, [approveIsPending]) // eslint-disable-line react-hooks/exhaustive-deps

  const isWorking  = ['creating', 'approving', 'waiting_approve', 'funding', 'waiting_fund'].includes(fundState)
  const isConfirmed = fundState === 'confirmed'

  // Build config summary for points
  const isPoints = form.type === 'points'
  const isToken  = form.type === 'token_reward'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Guardrail warnings */}
      {warnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {warnings.map(w => <GuardrailWarning key={w.key} message={w.message} />)}
        </div>
      )}

      {/* Campaign summary */}
      <SectionCard title="Campaign">
        <ReviewRow label="Type"     value={isToken ? 'Token Reward Pool' : 'Points Campaign'} mono={false} />
        <ReviewRow label="Token"    value={form.token ? `${form.token.symbol} (${form.token.name})` : '—'} />
        <ReviewRow label="Chain"    value={form.chainId === 8453 ? 'Base' : form.chainId === 1 ? 'Ethereum' : 'Arbitrum'} mono={false} />
        <ReviewRow label="Duration" value={`${form.durationDays} days`} />
        <ReviewRow
          label="Start"
          value={
            form.schedule === 'now'
              ? 'Immediately on funding'
              : form.startAt
                ? form.startAt.toLocaleString()
                : '—'
          }
          mono={false}
        />
      </SectionCard>

      {/* Actions summary */}
      <SectionCard title="Rewards">
        {isToken && (
          <>
            <ReviewRow label="Buyer reward"    value={fmtPct(form.buyerRewardPct)} />
            <ReviewRow label="Referral reward" value={fmtPct(form.referralRewardPct)} />
            <ReviewRow label="Hold period"     value={form.advancedMode ? `${form.referralHoldHours}h` : '—'} />
            <ReviewRow label="Score multiplier" value={form.useScoreMultiplier ? 'Enabled' : 'Disabled'} mono={false} />
          </>
        )}
        {isPoints && (
          <>
            <ReviewRow label="Focus" value={form.pointsFocus === 'both' ? 'Trade + Bridge' : form.pointsFocus.charAt(0).toUpperCase() + form.pointsFocus.slice(1)} mono={false} />
            {(form.pointsFocus === 'trade' || form.pointsFocus === 'both') && (
              <ReviewRow label="Points per $1 traded" value={`${form.pointsPerUsdTrade} pts`} />
            )}
            {(form.pointsFocus === 'bridge' || form.pointsFocus === 'both') && (
              <ReviewRow label="Bridge points" value={`${form.fixedBridgePoints} pts`} />
            )}
            <ReviewRow label="Payout preset"  value={`Top ${form.payoutPreset}`} />
          </>
        )}
      </SectionCard>

      {/* Funding */}
      <SectionCard title="Funding">
        <ReviewRow label="Pool size" value={fmtUSDShort(form.poolUsd)} />
        <ReviewRow label="Token"     value={form.token ? form.token.symbol : '—'} />
        <div style={{
          marginTop: 10,
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#8A8C9E',
        }}>
          {form.token
            ? `Deposits ${fmtUSDShort(form.poolUsd)} worth of ${form.token.symbol} to MintwareDistributor contract`
            : 'Select a token to see deposit amount'
          }
        </div>
      </SectionCard>

      {/* Error */}
      {errorMsg && (
        <div style={{
          background: 'rgba(194,83,122,0.06)', border: '1px solid rgba(194,83,122,0.2)',
          borderRadius: 10, padding: '12px 16px',
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C2537A',
        }}>
          ⚠ {errorMsg}
        </div>
      )}

      {/* Fund button */}
      {!isConfirmed && (
        <button
          disabled={isWorking || !form.token}
          onClick={handleFund}
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: 12,
            border: 'none',
            cursor: isWorking || !form.token ? 'not-allowed' : 'pointer',
            background: isWorking ? '#C4C3F0' : fundState === 'error' ? '#C2537A' : '#3A5CE8',
            color: '#fff',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 15, fontWeight: 700,
            transition: 'background 200ms',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {isWorking && (
            <span style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              animation: 'spin 0.7s linear infinite',
              display: 'inline-block',
            }} />
          )}
          {FUND_LABELS[fundState]}
        </button>
      )}

      {/* Step states */}
      {isWorking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { key: 'creating',        label: 'Create campaign record',  done: ['approving','waiting_approve','funding','waiting_fund'].includes(fundState) },
            { key: 'approving',       label: 'Approve token spend',     done: ['waiting_approve','funding','waiting_fund'].includes(fundState) },
            { key: 'waiting_approve', label: 'Approval confirmed',      done: ['funding','waiting_fund'].includes(fundState) },
            { key: 'funding',         label: 'Deposit to contract',     done: fundState === 'waiting_fund' },
            { key: 'waiting_fund',    label: 'On-chain confirmation',   done: false },
          ].map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: s.done ? '#2A9E8A' : 'rgba(58,92,232,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10,
              }}>
                {s.done ? '✓' : '·'}
              </div>
              <span style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12,
                color: s.done ? '#2A9E8A' : '#8A8C9E',
              }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
