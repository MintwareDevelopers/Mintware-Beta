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
    <div className="min-h-screen bg-atx-bone font-atx-display text-atx-ink [&_*]:rounded-none">
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
                  className="bg-transparent border-none cursor-pointer font-atx-mono uppercase tracking-[0.06em] text-[12px] text-atx-ink/45 p-0 flex items-center gap-1 transition-colors duration-150 hover:text-atx-blue"
                >
                  ← Campaign type
                </button>
                <span className="text-atx-ink/25">·</span>
                <span className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] ${form.type === 'token_reward' ? 'text-atx-blue' : 'text-atx-coral'}`}>
                  {form.type === 'token_reward' ? 'Token Reward Pool' : 'Points Campaign'}
                </span>
              </div>
              <h1 className="font-atx-display text-[24px] font-extrabold text-atx-ink m-0">
                Create Campaign
              </h1>
            </div>

            {/* Step indicator */}
            <div className="mb-7">
              <StepIndicator currentStep={step} labels={STEP_LABELS} />
            </div>

            {/* Step card */}
            <div className="bg-atx-panel border border-atx-ink p-8">
              {/* Card header: step name + mode toggle */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <div className="font-atx-mono text-[10px] font-bold text-atx-ink/55 tracking-[0.1em] uppercase mb-[3px]">
                    Step {step} of 5
                  </div>
                  <div className="font-atx-display text-[18px] font-extrabold text-atx-ink">
                    {STEP_LABELS[step - 1]}
                  </div>
                </div>

                {/* Simple / Advanced toggle (not shown on Review step) */}
                {step < 5 && (
                  <div className="inline-flex border border-atx-ink overflow-hidden bg-atx-panel">
                    <button
                      className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] px-[14px] py-[6px] border-none cursor-pointer transition-colors duration-150 ${!form.advancedMode ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink/55'}`}
                      onClick={() => onChange({ advancedMode: false })}
                    >
                      Simple
                    </button>
                    <button
                      className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] px-[14px] py-[6px] border-l border-atx-ink cursor-pointer transition-colors duration-150 ${form.advancedMode ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink/55'}`}
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
                <div className="mt-4 font-atx-mono text-[13px] text-atx-clay bg-atx-panel border border-atx-clay px-[14px] py-[10px]">
                  {stepErr}
                </div>
              )}
            </div>

            {/* Nav buttons (not shown on step 5 — Step5Review has its own Fund button) */}
            {step < 5 && (
              <div className="flex gap-[10px] mt-4">
                <button
                  onClick={handleBack}
                  className="font-atx-mono text-[13px] font-semibold uppercase tracking-[0.06em] px-6 py-[11px] cursor-pointer border border-atx-ink bg-atx-panel text-atx-ink transition-colors duration-150 hover:bg-atx-bone"
                >
                  ← Back
                </button>
                <button
                  className="font-atx-mono text-[13px] font-semibold uppercase tracking-[0.06em] px-6 py-[11px] cursor-pointer border border-atx-ink bg-atx-blue text-white flex-1 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="font-atx-mono text-[13px] font-semibold uppercase tracking-[0.06em] px-6 py-[11px] cursor-pointer border border-atx-ink bg-atx-panel text-atx-ink transition-colors duration-150 hover:bg-atx-bone"
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
