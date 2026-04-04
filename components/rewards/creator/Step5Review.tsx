'use client'

// =============================================================================
// Step5Review.tsx — Campaign summary + Fund Campaign button
//
// Shows full config, guardrail warnings, funding breakdown.
// Fund flow: create Supabase record → approve() → wait → depositCampaign() → wait → redirect
//
// UX improvements (ethereum-ux-adoption-report.md):
//   - Allowance pre-check: skip the approval step if allowance is already sufficient.
//   - Plain-language explanation of what will happen before the user clicks Fund.
//   - Distinct framing: "Give permission" (approve) vs "Transfer funds" (deposit).
//   - Better step labels and button copy.
//
// States: idle → creating → approving → waiting_approve → funding → waiting_fund → confirmed
// Uses wagmi writeContract + useWaitForTransactionReceipt
// =============================================================================

import { useState, useEffect } from 'react'
import { useAccount, useReadContract, usePublicClient, useSignMessage } from 'wagmi'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import type { CreatorFormState } from '@/lib/rewards/creator'
import {
  computeWarnings, fmtUSDShort, fmtPct,
  ERC20_APPROVE_ABI, DISTRIBUTOR_ABI, DISTRIBUTOR_ADDRESS,
} from '@/lib/rewards/creator'
import { GuardrailWarning } from '@/components/rewards/creator/GuardrailWarning'
import { buildCampaignCreateMessage } from '@/lib/web3/signedActionMessages'

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

// Button labels keyed to state. Uses plain language where possible.
const FUND_LABELS: Record<FundState, string> = {
  idle:            'Fund Campaign',
  creating:        'Setting up campaign…',
  approving:       'Give permission to use tokens…',
  waiting_approve: 'Waiting for permission…',
  funding:         'Transferring funds…',
  waiting_fund:    'Confirming on-chain…',
  confirmed:       '✓ Campaign funded!',
  error:           'Transaction failed — retry',
}

export function Step5Review({ form, onConfirmed }: Step5ReviewProps) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { signMessageAsync } = useSignMessage()
  const [fundState,   setFundState]   = useState<FundState>('idle')
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)
  const [campaignId,  setCampaignId]  = useState<string | null>(null)

  const warnings = computeWarnings(form)

  // ── Allowance pre-check ─────────────────────────────────────────────────
  // Read the current ERC-20 allowance granted to the distributor contract.
  // If it already covers the full deposit amount, we skip the approve step.
  const { data: allowanceRaw } = useReadContract({
    address: form.token?.address as `0x${string}` | undefined,
    abi: [{
      name: 'allowance',
      type: 'function',
      inputs: [
        { name: 'owner',   type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    }] as const,
    functionName: 'allowance',
    args: address && form.token ? [address, DISTRIBUTOR_ADDRESS] : undefined,
    query: { enabled: !!address && !!form.token },
  })

  const requiredAmount = form.token && form.poolUsd
    ? parseUnits(String(form.poolUsd), form.token.decimals)
    : 0n

  // True when the contract already has enough allowance to skip the approve tx
  const hasEnoughAllowance =
    allowanceRaw !== undefined && allowanceRaw >= requiredAmount

  // ── wagmi write hooks ───────────────────────────────────────────────────
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
  } = useWaitForTransactionReceipt({ hash: fundTxHash })

  // Approval confirmed → send depositCampaign tx
  useEffect(() => {
    if (!approveConfirmed || fundState !== 'waiting_approve') return
    if (!form.token || !campaignId || !address || !publicClient) return
    const tokenAddress = form.token.address as `0x${string}`
    setFundState('funding')
    const amount = parseUnits(String(form.poolUsd), form.token.decimals)
    publicClient.simulateContract({
      address:      DISTRIBUTOR_ADDRESS,
      abi:          DISTRIBUTOR_ABI,
      functionName: 'depositCampaign',
      args:         [campaignId, tokenAddress, amount],
      account:      address,
    }).then(() => {
      writeFund({
        address:      DISTRIBUTOR_ADDRESS,
        abi:          DISTRIBUTOR_ABI,
        functionName: 'depositCampaign',
        args: [campaignId, tokenAddress, amount],
      })
      setFundState('waiting_fund')
    }).catch((err: unknown) => {
      setErrorMsg((err as Error).message.split('\n')[0] ?? 'Unable to preflight campaign funding.')
      setFundState('error')
    })
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
      const campaignType = form.type ?? 'token_reward'
      const issuedAt = Date.now()
      const authMessage = buildCampaignCreateMessage({
        wallet: walletAddr,
        issuedAt,
        form: {
          type: campaignType,
          chainId: form.chainId,
          durationDays: form.durationDays,
          schedule: form.schedule,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          poolUsd: form.poolUsd,
          buyerRewardPct: form.buyerRewardPct,
          referralRewardPct: form.referralRewardPct,
          useScoreMultiplier: form.useScoreMultiplier,
          dailyWalletCapUsd: form.dailyWalletCapUsd,
          dailyPoolCapUsd: form.dailyPoolCapUsd,
          token: {
            address: form.token.address,
            symbol: form.token.symbol,
            name: form.token.name,
            decimals: form.token.decimals,
          },
        },
      })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res  = await fetch('/api/campaigns/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ form, wallet: walletAddr, issuedAt, authMessage, authSignature }),
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

    const amount = parseUnits(String(form.poolUsd), form.token.decimals)

    if (hasEnoughAllowance) {
      // ── Allowance already sufficient — skip the approve step ──────────
      if (!address || !publicClient) {
        setErrorMsg('Network client unavailable')
        setFundState('error')
        return
      }
      setFundState('funding')
      try {
        await publicClient.simulateContract({
          address:      DISTRIBUTOR_ADDRESS,
          abi:          DISTRIBUTOR_ABI,
          functionName: 'depositCampaign',
          args:         [newCampaignId, form.token.address as `0x${string}`, amount],
          account:      address,
        })
        writeFund({
          address:      DISTRIBUTOR_ADDRESS,
          abi:          DISTRIBUTOR_ABI,
          functionName: 'depositCampaign',
          args: [newCampaignId, form.token.address as `0x${string}`, amount],
        })
        setFundState('waiting_fund')
      } catch (err) {
        setErrorMsg((err as Error).message.split('\n')[0] ?? 'Unable to preflight campaign funding.')
        setFundState('error')
      }
    } else {
      // ── Need permission first — request approval ───────────────────────
      setFundState('approving')
      writeApprove({
        address:      form.token.address as `0x${string}`,
        abi:          ERC20_APPROVE_ABI,
        functionName: 'approve',
        args:         [DISTRIBUTOR_ADDRESS, amount],
      })
      if (approveIsPending) setFundState('waiting_approve')
    }
  }

  // Transition approving → waiting after tx is submitted
  useEffect(() => {
    if (approveIsPending && fundState === 'approving') setFundState('waiting_approve')
  }, [approveIsPending]) // eslint-disable-line react-hooks/exhaustive-deps

  const isWorking  = ['creating', 'approving', 'waiting_approve', 'funding', 'waiting_fund'].includes(fundState)
  const isConfirmed = fundState === 'confirmed'
  const spenderLabel = DISTRIBUTOR_ADDRESS === '0x0000000000000000000000000000000000000000'
    ? 'MintwareDistributor'
    : `${DISTRIBUTOR_ADDRESS.slice(0, 6)}…${DISTRIBUTOR_ADDRESS.slice(-4)}`
  const looksLikeZeroFirstToken =
    form.token
      ? form.token.symbol.toUpperCase() === 'USDT' || form.token.name.toLowerCase().includes('tether')
      : false

  // Build config summary for points
  const isPoints = form.type === 'points'
  const isToken  = form.type === 'token_reward'

  // Step definitions — adjust to skip approve step when allowance already exists
  const steps = hasEnoughAllowance
    ? [
        { key: 'creating',     label: 'Set up campaign record',         done: ['funding','waiting_fund'].includes(fundState) },
        { key: 'funding',      label: 'Transfer tokens to campaign',    done: fundState === 'waiting_fund' },
        { key: 'waiting_fund', label: 'Waiting for on-chain confirmation', done: false },
      ]
    : [
        { key: 'creating',        label: 'Set up campaign record',         done: ['approving','waiting_approve','funding','waiting_fund'].includes(fundState) },
        { key: 'approving',       label: 'Give permission to use tokens',  done: ['waiting_approve','funding','waiting_fund'].includes(fundState) },
        { key: 'waiting_approve', label: 'Permission confirmed',           done: ['funding','waiting_fund'].includes(fundState) },
        { key: 'funding',         label: 'Transfer tokens to campaign',    done: fundState === 'waiting_fund' },
        { key: 'waiting_fund',    label: 'Waiting for on-chain confirmation', done: false },
      ]

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
          <ReviewRow label="Spender"   value={spenderLabel} mono={false} />
          <div className="mt-[10px] font-sans text-[12px] text-mw-ink-4">
            {form.token
              ? `Deposits ${fmtUSDShort(form.poolUsd)} worth of ${form.token.symbol} to MintwareDistributor contract`
              : 'Select a token to see deposit amount'
            }
          </div>
        </SectionCard>

        {/* Plain-language "what will happen" — shown before the user clicks Fund */}
        {(fundState === 'idle' || fundState === 'error') && form.token && (
          <div className="bg-[rgba(79,126,247,0.04)] border border-[rgba(79,126,247,0.14)] rounded-[12px] px-[16px] py-[14px]">
            <div className="font-sans text-[11px] font-bold uppercase tracking-[0.8px] text-mw-ink-4 mb-[8px]">
              What will happen
            </div>
            {hasEnoughAllowance ? (
              <ol className="font-sans text-[12px] text-mw-ink-3 leading-[1.6] m-0 pl-[18px] flex flex-col gap-[4px]">
                <li>Your wallet will ask you to <strong>transfer {fmtUSDShort(form.poolUsd)} of {form.token.symbol}</strong> to the campaign contract.</li>
                <li>Once confirmed on-chain, your campaign goes live.</li>
              </ol>
            ) : (
              <ol className="font-sans text-[12px] text-mw-ink-3 leading-[1.6] m-0 pl-[18px] flex flex-col gap-[4px]">
                <li>Your wallet will ask you to <strong>give permission</strong> for the campaign contract to use your {form.token.symbol}. This is not a transfer.</li>
                <li>Then your wallet will ask you to <strong>transfer {fmtUSDShort(form.poolUsd)} of {form.token.symbol}</strong> to fund the campaign.</li>
                <li>Once confirmed on-chain, your campaign goes live.</li>
              </ol>
            )}
          </div>
        )}

        {looksLikeZeroFirstToken && !hasEnoughAllowance && allowanceRaw !== undefined && allowanceRaw > 0n && (
          <div className="bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.22)] rounded-[12px] px-[16px] py-[14px]">
            <div className="font-sans text-[11px] font-bold uppercase tracking-[0.8px] text-[#a16207] mb-[6px]">
              Token approval note
            </div>
            <p className="font-sans text-[12px] text-[#92400e] leading-[1.55] m-0">
              {form.token?.symbol ?? 'This token'} may ask for an extra wallet confirmation before the final funding step if it requires resetting an older approval first.
            </p>
          </div>
        )}

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

        {/* Step progress — shown while working */}
        {isWorking && (
          <div className="flex flex-col gap-2">
            {steps.map(s => (
              <div key={s.key} className="flex items-center gap-[10px]">
                <div
                  className={`w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${s.done ? 'bg-mw-teal text-white' : 'bg-[rgba(58,92,232,0.15)] text-mw-ink-4'}`}
                >
                  {s.done ? '✓' : '·'}
                </div>
                <span className={`font-sans text-[12px] ${s.done ? 'text-mw-teal' : 'text-mw-ink-4'}`}>
                  {s.label}
                </span>
              </div>
            ))}
            {/* Context for the current active step */}
            {(fundState === 'approving' || fundState === 'waiting_approve') && (
              <div className="mt-[4px] px-[12px] py-[10px] bg-[rgba(79,126,247,0.04)] border border-[rgba(79,126,247,0.12)] rounded-[10px]">
                <p className="font-sans text-[11px] text-mw-ink-4 leading-[1.5] m-0">
                  Your wallet will ask for <strong>permission</strong> to use {form.token?.symbol}.
                  This is a standard token approval — no funds are transferred at this step.
                </p>
              </div>
            )}
            {(fundState === 'funding' || fundState === 'waiting_fund') && (
              <div className="mt-[4px] px-[12px] py-[10px] bg-[rgba(42,158,138,0.05)] border border-[rgba(42,158,138,0.15)] rounded-[10px]">
                <p className="font-sans text-[11px] text-mw-ink-4 leading-[1.5] m-0">
                  Your wallet will ask you to transfer <strong>{fmtUSDShort(form.poolUsd)} of {form.token?.symbol}</strong> to the campaign. Confirm to launch.
                </p>
              </div>
            )}
            <div className="mt-[4px] px-[12px] py-[10px] bg-[rgba(26,26,46,0.03)] border border-[rgba(26,26,46,0.08)] rounded-[10px]">
              <p className="font-sans text-[11px] text-mw-ink-4 leading-[1.5] m-0">
                If your wallet does not appear right away, open your wallet app or extension and look for a pending request.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
