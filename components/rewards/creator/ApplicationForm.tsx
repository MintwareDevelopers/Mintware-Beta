'use client'

// =============================================================================
// ApplicationForm.tsx — Points campaign access application
//
// Shown when a non-whitelisted wallet selects Points Campaign.
// States:
//   idle      — form ready to fill
//   submitting — POST in flight
//   pending    — already applied (or just submitted)
//   success    — just submitted successfully
// =============================================================================

import { useState, useCallback } from 'react'

interface ApplicationFormProps {
  wallet:        string
  onBack:        () => void   // back to type select
  onTokenReward: () => void   // redirect to token reward flow
}

type SubmitState = 'idle' | 'submitting' | 'pending' | 'success'

const POOL_OPTIONS = [
  { value: '',               label: 'Select expected pool size' },
  { value: 'Under $5,000',   label: 'Under $5,000' },
  { value: '$5,000 – $10,000', label: '$5,000 – $10,000' },
  { value: '$10,000 – $25,000', label: '$10,000 – $25,000' },
  { value: '$25,000+',       label: '$25,000+' },
]

// Shared input class
const inputCls = 'w-full box-border border-[1.5px] border-[#E0DFFF] rounded-[10px] p-[11px_14px] font-sans text-[14px] text-[#1A1A2E] bg-white outline-none transition-[border-color] duration-150 focus:border-[#3A5CE8] placeholder:text-[#C4C3F0]'

export function ApplicationForm({ wallet, onBack, onTokenReward }: ApplicationFormProps) {
  const [protocolName,  setProtocolName]  = useState('')
  const [website,       setWebsite]       = useState('')
  const [contactEmail,  setContactEmail]  = useState('')
  const [poolSize,      setPoolSize]      = useState('')
  const [description,   setDescription]  = useState('')
  const [submitState,   setSubmitState]   = useState<SubmitState>('idle')
  const [errorMsg,      setErrorMsg]      = useState<string | null>(null)
  const [submittedEmail, setSubmittedEmail] = useState('')

  const canSubmit = protocolName.trim().length > 0 && contactEmail.trim().length > 0

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitState === 'submitting') return
    setSubmitState('submitting')
    setErrorMsg(null)

    try {
      const res  = await fetch('/api/teams/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet,
          protocol_name: protocolName,
          website,
          contact_email: contactEmail,
          pool_size_usd: poolSize,
          description,
        }),
      })
      const data = await res.json() as Record<string, string>

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
        setSubmitState('idle')
        return
      }

      if (data.status === 'pending') {
        // Could be already pending or just submitted
        setSubmittedEmail(contactEmail)
        setSubmitState(data.success ? 'success' : 'pending')
      } else if (data.status === 'approved') {
        // Already whitelisted — shouldn't normally reach this state but handle gracefully
        onTokenReward() // redirect to token reward as fallback; creator flow will check whitelist
      } else {
        setSubmittedEmail(contactEmail)
        setSubmitState('success')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setSubmitState('idle')
    }
  }, [canSubmit, submitState, wallet, protocolName, website, contactEmail, poolSize, description, onTokenReward])

  // ── Pending state (already applied) ────────────────────────────────────────
  if (submitState === 'pending') {
    return (
      <div className="max-w-[560px] mx-auto">
        <button
          className="bg-transparent border-none cursor-pointer font-sans text-[13px] text-mw-ink-4 p-0 flex items-center gap-1 mb-7 hover:text-[#3A3C52]"
          onClick={onBack}
        >
          ← Back to campaign type
        </button>

        <div className="bg-white border border-[#E0DFFF] rounded-[20px] p-9 shadow-[0_2px_12px_rgba(26,26,46,0.04)]">
          {/* Amber banner */}
          <div className="bg-[rgba(194,122,0,0.06)] border border-[rgba(194,122,0,0.2)] rounded-[12px] p-[16px_20px] mb-7">
            <div className="font-sans text-[14px] font-bold text-mw-amber mb-1">
              Your application is under review
            </div>
            <div className="font-sans text-[13px] text-mw-ink-4">
              We&apos;ll reach out to you within 2 business days.
            </div>
          </div>

          <button
            onClick={onTokenReward}
            className="w-full bg-mw-surface-purple border-[1.5px] border-[#E0DFFF] rounded-[12px] p-[14px_20px] cursor-pointer font-sans text-[14px] font-bold text-mw-brand-deep text-center"
          >
            Create Token Reward Pool →
          </button>
        </div>
      </div>
    )
  }

  // ── Success state (just submitted) ──────────────────────────────────────────
  if (submitState === 'success') {
    return (
      <div className="max-w-[560px] mx-auto">
        <button
          className="bg-transparent border-none cursor-pointer font-sans text-[13px] text-mw-ink-4 p-0 flex items-center gap-1 mb-7 hover:text-[#3A3C52]"
          onClick={onBack}
        >
          ← Back to campaign type
        </button>

        <div className="bg-white border border-[#E0DFFF] rounded-[20px] p-9 text-center shadow-[0_2px_12px_rgba(26,26,46,0.04)]">
          {/* Check icon */}
          <div className="w-[56px] h-[56px] rounded-full bg-[rgba(42,158,138,0.1)] flex items-center justify-center mx-auto mb-5">
            <span className="text-[26px] text-mw-teal">✓</span>
          </div>

          <div className="font-sans text-[20px] font-extrabold text-[#1A1A2E] mb-[10px]">
            Application submitted
          </div>

          <div className="font-sans text-[14px] text-mw-ink-4 leading-[1.6] max-w-[380px] mx-auto mb-2">
            We&apos;ll review your application and reach out to{' '}
            <strong className="text-[#3A3C52]">{submittedEmail}</strong>{' '}
            within 2 business days.
          </div>

          <div className="font-sans text-[13px] text-mw-ink-4 mb-7">
            In the meantime, you can create a Token Reward Pool campaign.
          </div>

          <button
            onClick={onTokenReward}
            className="bg-mw-brand-deep text-white border-none rounded-[12px] p-[14px_28px] cursor-pointer font-sans text-[14px] font-bold"
          >
            Create Token Reward Pool →
          </button>
        </div>
      </div>
    )
  }

  // ── Idle / submitting state — the form ─────────────────────────────────────
  return (
    <div className="max-w-[560px] mx-auto">
      <button
        className="bg-transparent border-none cursor-pointer font-sans text-[13px] text-mw-ink-4 p-0 flex items-center gap-1 mb-7 hover:text-[#3A3C52]"
        onClick={onBack}
      >
        ← Back to campaign type
      </button>

      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-[10px] mb-2">
          <div className="w-9 h-9 rounded-[10px] bg-[rgba(194,83,122,0.08)] flex items-center justify-center text-[18px] text-mw-pink">
            ◈
          </div>
          <span className="font-sans text-[11px] font-bold text-mw-pink bg-[rgba(194,83,122,0.08)] border border-[rgba(194,83,122,0.2)] rounded-[20px] px-[10px] py-[3px] tracking-[0.3px]">
            CURATED · WHITELISTED TEAMS
          </span>
        </div>
        <h2 className="font-sans text-[22px] font-extrabold text-[#1A1A2E] m-0 mb-[6px]">
          Apply for Points Campaign Access
        </h2>
        <p className="font-sans text-[13px] text-mw-ink-4 m-0 leading-[1.55]">
          Points campaigns are curated. Tell us about your protocol and we&apos;ll be in touch.
        </p>
      </div>

      {/* Form card */}
      <div className="bg-white border border-[#E0DFFF] rounded-[20px] p-7 shadow-[0_2px_12px_rgba(26,26,46,0.04)] flex flex-col gap-5">

        {/* Protocol Name */}
        <div>
          <label className="font-sans text-[12px] font-bold text-[#3A3C52] tracking-[0.3px] uppercase mb-[6px] block">Protocol Name *</label>
          <input
            className={inputCls}
            type="text"
            placeholder="e.g. Uniswap, Aave, Curve"
            value={protocolName}
            onChange={e => setProtocolName(e.target.value)}
          />
        </div>

        {/* Website */}
        <div>
          <label className="font-sans text-[12px] font-bold text-[#3A3C52] tracking-[0.3px] uppercase mb-[6px] block">
            Website <span className="text-[#C4C3F0] font-normal">(optional)</span>
          </label>
          <input
            className={inputCls}
            type="text"
            placeholder="https://yourprotocol.xyz"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />
        </div>

        {/* Contact Email */}
        <div>
          <label className="font-sans text-[12px] font-bold text-[#3A3C52] tracking-[0.3px] uppercase mb-[6px] block">Contact Email *</label>
          <input
            className={inputCls}
            type="email"
            placeholder="you@yourprotocol.xyz"
            value={contactEmail}
            onChange={e => setContactEmail(e.target.value)}
          />
        </div>

        {/* Pool Size */}
        <div>
          <label className="font-sans text-[12px] font-bold text-[#3A3C52] tracking-[0.3px] uppercase mb-[6px] block">
            Expected Pool Size <span className="text-[#C4C3F0] font-normal">(optional)</span>
          </label>
          <div className="relative">
            <select
              className={`${inputCls} cursor-pointer appearance-none ${poolSize ? 'text-[#1A1A2E]' : 'text-[#C4C3F0]'}`}
              value={poolSize}
              onChange={e => setPoolSize(e.target.value)}
            >
              {POOL_OPTIONS.map(o => (
                <option key={o.value} value={o.value} disabled={o.value === ''}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="absolute right-[14px] top-1/2 -translate-y-1/2 pointer-events-none text-mw-ink-3 text-[12px]">▾</span>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="font-sans text-[12px] font-bold text-[#3A3C52] tracking-[0.3px] uppercase mb-[6px] block">
            Tell us about your campaign *
            <span className="float-right text-[#C4C3F0] font-normal normal-case tracking-normal">
              {description.length}/500
            </span>
          </label>
          <textarea
            className={`${inputCls} resize-y min-h-[100px]`}
            placeholder="What are your goals? Who is your community? What token will you use?"
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 500))}
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="p-[12px_16px] bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-[10px] font-sans text-[13px] text-mw-pink">
            {errorMsg}
          </div>
        )}

        {/* Submit */}
        <button
          className="w-full p-[14px] bg-mw-brand-deep text-white border-none rounded-[12px] font-sans text-[15px] font-bold cursor-pointer transition-[background] duration-150 hover:bg-[#2a4cd8] disabled:bg-[#C4C3F0] disabled:cursor-not-allowed"
          onClick={handleSubmit}
          disabled={!canSubmit || submitState === 'submitting'}
        >
          {submitState === 'submitting' ? 'Submitting…' : 'Apply for Access →'}
        </button>
      </div>
    </div>
  )
}
