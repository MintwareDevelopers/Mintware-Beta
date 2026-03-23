'use client'

// =============================================================================
// Step5Review.tsx — Campaign summary + Fund Campaign button
//
// Shows full config, guardrail warnings, funding breakdown.
// Fund flow: create Supabase record → approve() → wait → depositCampaign() → wait → redirect
// States: idle → creating → approving → waiting_approve → funding → waiting_fund → confirmed
// Uses wagmi writeContract + useWaitForTransactionReceipt
// =============================================================================

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import type { CreatorFormState } from '@/lib/rewards/creator'
import {
  computeWarnings, fmtUSDShort, fmtPct,
  ERC20_APPROVE_ABI, DISTRIBUTOR_ABI, DISTRIBUTOR_ADDRESS,
} from '@/lib/rewards/creator'
import { GuardrailWarning } from '@/components/rewards/creator/GuardrailWarning'

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
    <div className="flex justify-between items-center py-[9px] border-b border-[#F0EFFF]">
      <span className="font-sans text-[13px] text-mw-ink-4">
        {label}
      </span>
      <span
        className={`text-[13px] font-semibold text-[#1A1A2E] ${mono ? 'font-mono' : 'font-sans'}`}
      >
        {value}
      </span>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E0DFFF] rounded-[14px] p-[16px_18px]">
      <div className="font-sans text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-4 mb-1">
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
    <>
      <div className="flex flex-col gap-5">

        {/* Guardrail warnings */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-[6px]">
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
          <div className="mt-[10px] font-sans text-[12px] text-mw-ink-4">
            {form.token
              ? `Deposits ${fmtUSDShort(form.poolUsd)} worth of ${form.token.symbol} to MintwareDistributor contract`
              : 'Select a token to see deposit amount'
            }
          </div>
        </SectionCard>

        {/* Error */}
        {errorMsg && (
          <div className="bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.2)] rounded-[10px] p-[12px_16px] font-sans text-[13px] text-mw-pink">
            ⚠ {errorMsg}
          </div>
        )}

        {/* Fund button */}
        {!isConfirmed && (
          <button
            disabled={isWorking || !form.token}
            onClick={handleFund}
            className="w-full py-[14px] px-6 rounded-[12px] border-none text-white font-sans text-[15px] font-bold transition-[background] duration-200 flex items-center justify-center gap-[10px] disabled:cursor-not-allowed"
            style={{
              background: isWorking ? '#C4C3F0' : fundState === 'error' ? '#C2537A' : '#3A5CE8',
            }}
          >
            {isWorking && (
              <span
                className="w-4 h-4 rounded-full border-2 border-[rgba(255,255,255,0.3)] border-t-white inline-block"
                style={{ animation: 'spin 0.7s linear infinite' }}
              />
            )}
            {FUND_LABELS[fundState]}
          </button>
        )}

        {/* Step states */}
        {isWorking && (
          <div className="flex flex-col gap-2">
            {[
              { key: 'creating',        label: 'Create campaign record',  done: ['approving','waiting_approve','funding','waiting_fund'].includes(fundState) },
              { key: 'approving',       label: 'Approve token spend',     done: ['waiting_approve','funding','waiting_fund'].includes(fundState) },
              { key: 'waiting_approve', label: 'Approval confirmed',      done: ['funding','waiting_fund'].includes(fundState) },
              { key: 'funding',         label: 'Deposit to contract',     done: fundState === 'waiting_fund' },
              { key: 'waiting_fund',    label: 'On-chain confirmation',   done: false },
            ].map(s => (
              <div key={s.key} className="flex items-center gap-[10px]">
                <div
                  className={`w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center text-[10px] ${s.done ? 'bg-mw-teal' : 'bg-[rgba(58,92,232,0.15)]'}`}
                >
                  {s.done ? '✓' : '·'}
                </div>
                <span
                  className={`font-sans text-[12px] ${s.done ? 'text-mw-teal' : 'text-mw-ink-4'}`}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
