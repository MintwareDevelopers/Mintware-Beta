'use client'

// =============================================================================
// app/create-campaign/page.tsx — Campaign creator page
//
// Phase 0: CampaignTypeSelect (full screen type picker)
// Phase 1: 5-step flow with StepIndicator
//
// Layout: centered card, max-width 660px
// Auth: MwAuthGuard (wallet required)
// =============================================================================

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { CampaignTypeSelect } from '@/components/rewards/creator/CampaignTypeSelect'
import { StepIndicator }      from '@/components/rewards/creator/StepIndicator'
import { Step1Token }         from '@/components/rewards/creator/Step1Token'
import { Step2Pool }          from '@/components/rewards/creator/Step2Pool'
import { Step3Actions }       from '@/components/rewards/creator/Step3Actions'
import { Step4Schedule }      from '@/components/rewards/creator/Step4Schedule'
import { Step5Review }        from '@/components/rewards/creator/Step5Review'
import type { CampaignType, CreatorFormState } from '@/lib/rewards/creator'
import { DEFAULT_FORM, validateStep } from '@/lib/rewards/creator'

const STEP_LABELS = ['Token', 'Pool', 'Actions', 'Schedule', 'Review']

function CreatorContent() {
  const router = useRouter()

  const [form, setForm]     = useState<CreatorFormState>(DEFAULT_FORM)
  const [step, setStep]     = useState(0)           // 0 = type select, 1–5 = steps
  const [stepErr, setStepErr] = useState<string | null>(null)

  const onChange = useCallback((partial: Partial<CreatorFormState>) => {
    setForm(prev => ({ ...prev, ...partial }))
  }, [])

  function handleTypeSelect(type: CampaignType) {
    onChange({ type })
    setStep(1)
  }

  function handleNext() {
    const err = validateStep(step, form)
    if (err) { setStepErr(err); return }
    setStepErr(null)
    setStep(s => Math.min(5, s + 1))
  }

  function handleBack() {
    setStepErr(null)
    if (step === 1) {
      setStep(0)
    } else {
      setStep(s => Math.max(1, s - 1))
    }
  }

  function handleConfirmed(campaignId?: string) {
    if (form.schedule === 'now' && campaignId) {
      router.push(`/campaign/${campaignId}`)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F6FF] font-sans">
      <MwNav />

      <main className="max-w-[660px] mx-auto px-4 pt-8 pb-20">

        {/* ── Type select (step 0) ── */}
        {step === 0 && (
          <>
            <CampaignTypeSelect onSelect={handleTypeSelect} />
          </>
        )}

        {/* ── 5-step flow (steps 1–5) ── */}
        {step >= 1 && step <= 5 && (
          <>
            {/* Page header */}
            <div className="mb-7">
              <div className="flex items-center gap-3 mb-1">
                <button
                  onClick={() => { setStep(0); setStepErr(null) }}
                  className="bg-transparent border-none cursor-pointer font-sans text-[13px] text-mw-ink-4 p-0 flex items-center gap-1"
                >
                  ← Campaign type
                </button>
                <span className="text-[#E0DFFF]">·</span>
                <span className={`font-sans text-[13px] font-semibold ${form.type === 'token_reward' ? 'text-mw-brand-deep' : 'text-mw-pink'}`}>
                  {form.type === 'token_reward' ? 'Token Reward Pool' : 'Points Campaign'}
                </span>
              </div>
              <h1 className="font-sans text-[24px] font-extrabold text-[#1A1A2E] m-0">
                Create Campaign
              </h1>
            </div>

            {/* Step indicator */}
            <div className="mb-7">
              <StepIndicator currentStep={step} labels={STEP_LABELS} />
            </div>

            {/* Step card */}
            <div className="bg-white border border-[#E0DFFF] rounded-xl p-8 shadow-[0_2px_12px_rgba(26,26,46,0.04)]">
              {/* Card header: step name + mode toggle */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <div className="font-sans text-[11px] font-bold text-mw-ink-4 tracking-[1px] uppercase mb-[3px]">
                    Step {step} of 5
                  </div>
                  <div className="font-sans text-[18px] font-extrabold text-[#1A1A2E]">
                    {STEP_LABELS[step - 1]}
                  </div>
                </div>

                {/* Simple / Advanced toggle (not shown on Review step) */}
                {step < 5 && (
                  <div className="inline-flex border-[1.5px] border-[#E0DFFF] rounded-xl overflow-hidden bg-white">
                    <button
                      className={`font-sans text-[12px] font-semibold px-[14px] py-[6px] border-none cursor-pointer transition-all duration-150 ${!form.advancedMode ? 'bg-mw-brand-deep text-white' : 'bg-transparent text-mw-ink-4'}`}
                      onClick={() => onChange({ advancedMode: false })}
                    >
                      Simple
                    </button>
                    <button
                      className={`font-sans text-[12px] font-semibold px-[14px] py-[6px] border-none cursor-pointer transition-all duration-150 ${form.advancedMode ? 'bg-mw-brand-deep text-white' : 'bg-transparent text-mw-ink-4'}`}
                      onClick={() => onChange({ advancedMode: true })}
                    >
                      Advanced
                    </button>
                  </div>
                )}
              </div>

              {/* Step content */}
              {step === 1 && <Step1Token    form={form} onChange={onChange} />}
              {step === 2 && <Step2Pool     form={form} onChange={onChange} />}
              {step === 3 && <Step3Actions  form={form} onChange={onChange} />}
              {step === 4 && <Step4Schedule form={form} onChange={onChange} />}
              {step === 5 && <Step5Review   form={form} onConfirmed={handleConfirmed} />}

              {/* Step validation error */}
              {stepErr && (
                <div className="mt-4 font-sans text-[13px] text-mw-pink bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-sm px-[14px] py-[10px]">
                  {stepErr}
                </div>
              )}
            </div>

            {/* Nav buttons (not shown on step 5 — Step5Review has its own Fund button) */}
            {step < 5 && (
              <div className="flex gap-[10px] mt-4">
                <button
                  onClick={handleBack}
                  className="font-sans text-[14px] font-semibold px-6 py-[11px] rounded-[10px] cursor-pointer border-[1.5px] border-[#E0DFFF] bg-white text-mw-ink-4 transition-all duration-150 hover:border-[#C4C3F0] hover:text-[#3A3C52]"
                >
                  ← Back
                </button>
                <button
                  className="font-sans text-[14px] font-semibold px-6 py-[11px] rounded-[10px] cursor-pointer border-none bg-mw-brand-deep text-white flex-1 transition-all duration-150 hover:bg-[#2a4cd8] disabled:bg-[#C4C3F0] disabled:cursor-not-allowed"
                  onClick={handleNext}
                  disabled={step === 1 && !form.token}
                >
                  {step === 4 ? 'Review →' : 'Next →'}
                </button>
              </div>
            )}

            {/* Back button on step 5 */}
            {step === 5 && (
              <div className="mt-4">
                <button
                  onClick={handleBack}
                  className="font-sans text-[14px] font-semibold px-6 py-[11px] rounded-[10px] cursor-pointer border-[1.5px] border-[#E0DFFF] bg-white text-mw-ink-4 transition-all duration-150 hover:border-[#C4C3F0] hover:text-[#3A3C52]"
                >
                  ← Edit
                </button>
              </div>
            )}
          </>
        )}

      </main>
    </div>
  )
}

export default function CreateCampaignPage() {
  return (
    <MwAuthGuard>
      <CreatorContent />
    </MwAuthGuard>
  )
}
