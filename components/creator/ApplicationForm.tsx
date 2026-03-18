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
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <style>{`
          .af-back-btn {
            background: none; border: none; cursor: pointer;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 13px; color: #8A8C9E; padding: 0;
            display: flex; align-items: center; gap: 4px;
            margin-bottom: 28px;
          }
          .af-back-btn:hover { color: #3A3C52; }
        `}</style>

        <button className="af-back-btn" onClick={onBack}>← Back to campaign type</button>

        <div style={{
          background: '#fff', border: '1px solid #E0DFFF',
          borderRadius: 20, padding: 36,
          boxShadow: '0 2px 12px rgba(26,26,46,0.04)',
        }}>
          {/* Amber banner */}
          <div style={{
            background: 'rgba(194,122,0,0.06)',
            border: '1px solid rgba(194,122,0,0.2)',
            borderRadius: 12, padding: '16px 20px',
            marginBottom: 28,
          }}>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 14, fontWeight: 700, color: '#C27A00', marginBottom: 4,
            }}>
              Your application is under review
            </div>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 13, color: '#8A8C9E',
            }}>
              We&apos;ll reach out to you within 2 business days.
            </div>
          </div>

          <button
            onClick={onTokenReward}
            style={{
              width: '100%', background: '#F7F6FF',
              border: '1.5px solid #E0DFFF', borderRadius: 12,
              padding: '14px 20px', cursor: 'pointer',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 14, fontWeight: 700, color: '#3A5CE8',
              textAlign: 'center',
            }}
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
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <style>{`
          .af-back-btn {
            background: none; border: none; cursor: pointer;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 13px; color: #8A8C9E; padding: 0;
            display: flex; align-items: center; gap: 4px;
            margin-bottom: 28px;
          }
          .af-back-btn:hover { color: #3A3C52; }
        `}</style>

        <button className="af-back-btn" onClick={onBack}>← Back to campaign type</button>

        <div style={{
          background: '#fff', border: '1px solid #E0DFFF',
          borderRadius: 20, padding: 36, textAlign: 'center',
          boxShadow: '0 2px 12px rgba(26,26,46,0.04)',
        }}>
          {/* Check icon */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(42,158,138,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <span style={{ fontSize: 26, color: '#2A9E8A' }}>✓</span>
          </div>

          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 20, fontWeight: 800, color: '#1A1A2E', marginBottom: 10,
          }}>
            Application submitted
          </div>

          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 14, color: '#8A8C9E', lineHeight: 1.6,
            maxWidth: 380, margin: '0 auto 8px',
          }}>
            We&apos;ll review your application and reach out to{' '}
            <strong style={{ color: '#3A3C52' }}>{submittedEmail}</strong>{' '}
            within 2 business days.
          </div>

          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 13, color: '#8A8C9E', marginBottom: 28,
          }}>
            In the meantime, you can create a Token Reward Pool campaign.
          </div>

          <button
            onClick={onTokenReward}
            style={{
              background: '#3A5CE8', color: '#fff',
              border: 'none', borderRadius: 12,
              padding: '14px 28px', cursor: 'pointer',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 14, fontWeight: 700,
            }}
          >
            Create Token Reward Pool →
          </button>
        </div>
      </div>
    )
  }

  // ── Idle / submitting state — the form ─────────────────────────────────────
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <style>{`
        .af-back-btn {
          background: none; border: none; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; color: #8A8C9E; padding: 0;
          display: flex; align-items: center; gap: 4px;
          margin-bottom: 28px;
        }
        .af-back-btn:hover { color: #3A3C52; }
        .af-label {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 700; color: #3A3C52;
          letter-spacing: 0.3px; text-transform: uppercase;
          margin-bottom: 6px; display: block;
        }
        .af-input {
          width: 100%; box-sizing: border-box;
          border: 1.5px solid #E0DFFF; border-radius: 10px;
          padding: 11px 14px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; color: #1A1A2E; background: #fff;
          outline: none; transition: border-color 150ms;
        }
        .af-input:focus { border-color: #3A5CE8; }
        .af-input::placeholder { color: #C4C3F0; }
        .af-select {
          width: 100%; box-sizing: border-box;
          border: 1.5px solid #E0DFFF; border-radius: 10px;
          padding: 11px 14px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; color: #1A1A2E; background: #fff;
          outline: none; cursor: pointer; appearance: none;
          transition: border-color 150ms;
        }
        .af-select:focus { border-color: #3A5CE8; }
        .af-textarea {
          width: 100%; box-sizing: border-box;
          border: 1.5px solid #E0DFFF; border-radius: 10px;
          padding: 11px 14px; resize: vertical; min-height: 100px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; color: #1A1A2E; background: #fff;
          outline: none; transition: border-color 150ms;
        }
        .af-textarea:focus { border-color: #3A5CE8; }
        .af-textarea::placeholder { color: #C4C3F0; }
        .af-submit-btn {
          width: 100%; padding: 14px;
          background: #3A5CE8; color: #fff;
          border: none; border-radius: 12px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px; font-weight: 700;
          cursor: pointer; transition: background 150ms;
        }
        .af-submit-btn:hover:not(:disabled) { background: #2a4cd8; }
        .af-submit-btn:disabled { background: #C4C3F0; cursor: not-allowed; }
      `}</style>

      <button className="af-back-btn" onClick={onBack}>← Back to campaign type</button>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(194,83,122,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#C2537A',
          }}>
            ◈
          </div>
          <span style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 11, fontWeight: 700, color: '#C2537A',
            background: 'rgba(194,83,122,0.08)',
            border: '1px solid rgba(194,83,122,0.2)',
            borderRadius: 20, padding: '3px 10px',
            letterSpacing: '0.3px',
          }}>
            CURATED · WHITELISTED TEAMS
          </span>
        </div>
        <h2 style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 22, fontWeight: 800, color: '#1A1A2E',
          margin: 0, marginBottom: 6,
        }}>
          Apply for Points Campaign Access
        </h2>
        <p style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 13, color: '#8A8C9E', margin: 0, lineHeight: 1.55,
        }}>
          Points campaigns are curated. Tell us about your protocol and we&apos;ll be in touch.
        </p>
      </div>

      {/* Form card */}
      <div style={{
        background: '#fff', border: '1px solid #E0DFFF',
        borderRadius: 20, padding: 28,
        boxShadow: '0 2px 12px rgba(26,26,46,0.04)',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>

        {/* Protocol Name */}
        <div>
          <label className="af-label">Protocol Name *</label>
          <input
            className="af-input"
            type="text"
            placeholder="e.g. Uniswap, Aave, Curve"
            value={protocolName}
            onChange={e => setProtocolName(e.target.value)}
          />
        </div>

        {/* Website */}
        <div>
          <label className="af-label">Website <span style={{ color: '#C4C3F0', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="af-input"
            type="text"
            placeholder="https://yourprotocol.xyz"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />
        </div>

        {/* Contact Email */}
        <div>
          <label className="af-label">Contact Email *</label>
          <input
            className="af-input"
            type="email"
            placeholder="you@yourprotocol.xyz"
            value={contactEmail}
            onChange={e => setContactEmail(e.target.value)}
          />
        </div>

        {/* Pool Size */}
        <div>
          <label className="af-label">Expected Pool Size <span style={{ color: '#C4C3F0', fontWeight: 400 }}>(optional)</span></label>
          <div style={{ position: 'relative' }}>
            <select
              className="af-select"
              value={poolSize}
              onChange={e => setPoolSize(e.target.value)}
              style={{ color: poolSize ? '#1A1A2E' : '#C4C3F0' }}
            >
              {POOL_OPTIONS.map(o => (
                <option key={o.value} value={o.value} disabled={o.value === ''}>
                  {o.label}
                </option>
              ))}
            </select>
            <span style={{
              position: 'absolute', right: 14, top: '50%',
              transform: 'translateY(-50%)', pointerEvents: 'none',
              color: '#8A8C9E', fontSize: 12,
            }}>▾</span>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="af-label">
            Tell us about your campaign *
            <span style={{ float: 'right', color: '#C4C3F0', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {description.length}/500
            </span>
          </label>
          <textarea
            className="af-textarea"
            placeholder="What are your goals? Who is your community? What token will you use?"
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 500))}
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(194,83,122,0.06)',
            border: '1px solid rgba(194,83,122,0.15)',
            borderRadius: 10,
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 13, color: '#C2537A',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Submit */}
        <button
          className="af-submit-btn"
          onClick={handleSubmit}
          disabled={!canSubmit || submitState === 'submitting'}
        >
          {submitState === 'submitting' ? 'Submitting…' : 'Apply for Access →'}
        </button>
      </div>
    </div>
  )
}
