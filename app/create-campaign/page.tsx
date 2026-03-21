'use client'

// =============================================================================
// app/create-campaign/page.tsx — Campaign creator page
//
// Phase 0: CampaignTypeSelect (full screen type picker)
// Phase 1: 5-step flow with StepIndicator
//
// Layout: centered card, max-width 660px
// Auth: MwAuthGuard (wallet required)
// Inline styles only — no Tailwind.
// =============================================================================

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { CampaignTypeSelect } from '@/components/creator/CampaignTypeSelect'
import { StepIndicator }      from '@/components/creator/StepIndicator'
import { Step1Token }         from '@/components/creator/Step1Token'
import { Step2Pool }          from '@/components/creator/Step2Pool'
import { Step3Actions }       from '@/components/creator/Step3Actions'
import { Step4Schedule }      from '@/components/creator/Step4Schedule'
import { Step5Review }        from '@/components/creator/Step5Review'
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
    <>
      <style>{`
        .creator-page {
          min-height: 100vh;
          background: #F7F6FF;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .creator-main {
          max-width: 660px;
          margin: 0 auto;
          padding: 32px 16px 80px;
        }
        .creator-card {
          background: #fff;
          border: 1px solid #E0DFFF;
          border-radius: 20px;
          padding: 32px;
          box-shadow: 0 2px 12px rgba(26,26,46,0.04);
        }
        .creator-mode-toggle {
          display: inline-flex;
          border: 1.5px solid #E0DFFF;
          border-radius: 20px;
          overflow: hidden;
          background: #fff;
        }
        .creator-mode-btn {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 600;
          padding: 6px 14px;
          border: none; cursor: pointer;
          transition: all 150ms; background: transparent; color: #8A8C9E;
        }
        .creator-mode-btn.active { background: #3A5CE8; color: #fff; }
        .nav-btn {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; font-weight: 600;
          padding: 11px 24px; border-radius: 10px;
          cursor: pointer; border: none;
          transition: all 150ms;
        }
        .nav-btn-back {
          background: #fff; color: #8A8C9E;
          border: 1.5px solid #E0DFFF;
        }
        .nav-btn-back:hover { border-color: #C4C3F0; color: #3A3C52; }
        .nav-btn-next {
          background: #3A5CE8; color: #fff; flex: 1;
        }
        .nav-btn-next:hover { background: #2a4cd8; }
        .nav-btn-next:disabled { background: #C4C3F0; cursor: not-allowed; }
        @media (max-width: 640px) {
          .creator-card { padding: 20px 16px; }
        }
      `}</style>

      <div className="creator-page">
        <MwNav />

        <main className="creator-main">

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
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  <button
                    onClick={() => { setStep(0); setStepErr(null) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontSize: 13, color: '#8A8C9E', padding: 0,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    ← Campaign type
                  </button>
                  <span style={{ color: '#E0DFFF' }}>·</span>
                  <span style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontSize: 13, fontWeight: 600,
                    color: form.type === 'token_reward' ? '#3A5CE8' : '#C2537A',
                  }}>
                    {form.type === 'token_reward' ? 'Token Reward Pool' : 'Points Campaign'}
                  </span>
                </div>
                <h1 style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontSize: 24, fontWeight: 800, color: '#1A1A2E',
                  margin: 0,
                }}>
                  Create Campaign
                </h1>
              </div>

              {/* Step indicator */}
              <div style={{ marginBottom: 28 }}>
                <StepIndicator currentStep={step} labels={STEP_LABELS} />
              </div>

              {/* Step card */}
              <div className="creator-card">
                {/* Card header: step name + mode toggle */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 24,
                }}>
                  <div>
                    <div style={{
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontSize: 11, fontWeight: 700, color: '#8A8C9E',
                      letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 3,
                    }}>
                      Step {step} of 5
                    </div>
                    <div style={{
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontSize: 18, fontWeight: 800, color: '#1A1A2E',
                    }}>
                      {STEP_LABELS[step - 1]}
                    </div>
                  </div>

                  {/* Simple / Advanced toggle (not shown on Review step) */}
                  {step < 5 && (
                    <div className="creator-mode-toggle">
                      <button
                        className={`creator-mode-btn${!form.advancedMode ? ' active' : ''}`}
                        onClick={() => onChange({ advancedMode: false })}
                      >
                        Simple
                      </button>
                      <button
                        className={`creator-mode-btn${form.advancedMode ? ' active' : ''}`}
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
                  <div style={{
                    marginTop: 16,
                    fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C2537A',
                    background: 'rgba(194,83,122,0.06)', border: '1px solid rgba(194,83,122,0.15)',
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    {stepErr}
                  </div>
                )}
              </div>

              {/* Nav buttons (not shown on step 5 — Step5Review has its own Fund button) */}
              {step < 5 && (
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button className="nav-btn nav-btn-back" onClick={handleBack}>
                    ← Back
                  </button>
                  <button
                    className="nav-btn nav-btn-next"
                    onClick={handleNext}
                    disabled={step === 1 && !form.token}
                  >
                    {step === 4 ? 'Review →' : 'Next →'}
                  </button>
                </div>
              )}

              {/* Back button on step 5 */}
              {step === 5 && (
                <div style={{ marginTop: 16 }}>
                  <button className="nav-btn nav-btn-back" onClick={handleBack}>
                    ← Edit
                  </button>
                </div>
              )}
            </>
          )}

        </main>
      </div>
    </>
  )
}

export default function CreateCampaignPage() {
  return (
    <MwAuthGuard>
      <CreatorContent />
    </MwAuthGuard>
  )
}
