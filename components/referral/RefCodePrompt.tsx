'use client'

// =============================================================================
// RefCodePrompt.tsx — Manual referral code entry
//
// Slide-up sheet shown after first wallet connect when:
//   - No ?ref= URL param was present
//   - No existing referral_records row for this wallet
//   - Not previously dismissed
//
// States: idle → submitting → success | error
// Dismiss: auto after 2s on success, or immediately on skip
// Skip: stores mw_ref_dismissed_{wallet} in localStorage
// =============================================================================

import { useState, useCallback, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface RefCodePromptProps {
  wallet: string
  onDismiss: () => void
}

type PromptState = 'idle' | 'submitting' | 'success' | 'error'

const CODE_PATTERN = /^mw_[0-9a-z]{6}$/

export function RefCodePrompt({ wallet, onDismiss }: RefCodePromptProps) {
  const [animIn,      setAnimIn]      = useState(false)
  const [code,        setCode]        = useState('')
  const [promptState, setPromptState] = useState<PromptState>('idle')
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)

  const supabase = createSupabaseBrowserClient()

  // Slide in on mount
  useEffect(() => {
    const t = setTimeout(() => setAnimIn(true), 30)
    return () => clearTimeout(t)
  }, [])

  function dismiss(skip: boolean) {
    if (skip) {
      localStorage.setItem(`mw_ref_dismissed_${wallet}`, 'true')
    }
    setAnimIn(false)
    setTimeout(onDismiss, 300)
  }

  const isValid = CODE_PATTERN.test(code)

  const handleApply = useCallback(async () => {
    if (!isValid || promptState === 'submitting') return
    setPromptState('submitting')
    setErrorMsg(null)

    try {
      // Look up referrer by ref_code
      const { data: referrerProfile, error: lookupErr } = await supabase
        .from('wallet_profiles')
        .select('address')
        .eq('ref_code', code)
        .maybeSingle()

      if (lookupErr) throw lookupErr

      if (!referrerProfile) {
        setErrorMsg('Code not found — check and try again')
        setPromptState('error')
        return
      }

      if (referrerProfile.address === wallet.toLowerCase()) {
        setErrorMsg('You cannot use your own referral code')
        setPromptState('error')
        return
      }

      // Insert referral record
      const { error: insertErr } = await supabase
        .from('referral_records')
        .upsert(
          {
            referrer: referrerProfile.address,
            referred: wallet.toLowerCase(),
            ref_code: code,
            status:   'pending',
          },
          { onConflict: 'referred', ignoreDuplicates: true }
        )

      if (insertErr) throw insertErr

      setPromptState('success')
      localStorage.setItem(`mw_ref_dismissed_${wallet}`, 'true')

      // Auto-dismiss after 2s
      setTimeout(() => dismiss(false), 2000)
    } catch (err) {
      console.error('[RefCodePrompt] error:', err)
      setErrorMsg('Something went wrong. Please try again.')
      setPromptState('error')
    }
  }, [isValid, promptState, code, wallet, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{`
        .rcp-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.3);
          z-index: 1099;
          opacity: 0;
          transition: opacity 0.3s ease-out;
        }
        .rcp-backdrop.in { opacity: 1; }

        .rcp-sheet {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #fff;
          border-radius: 20px 20px 0 0;
          box-shadow: 0 -4px 40px rgba(58,92,232,0.12);
          z-index: 1100;
          padding: 32px 24px 44px;
          max-width: 520px;
          margin: 0 auto;
          transform: translateY(100%);
          transition: transform 0.3s ease-out;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .rcp-sheet.in { transform: translateY(0); }

        .rcp-handle {
          width: 36px; height: 4px;
          background: rgba(26,26,46,0.12);
          border-radius: 2px;
          margin: 0 auto 24px;
        }

        .rcp-input {
          width: 100%; box-sizing: border-box;
          background: #F7F6FF;
          border: 1.5px solid #E0DFFF;
          border-radius: 10px;
          padding: 14px 16px;
          font-family: var(--font-mono, 'DM Mono', monospace);
          font-size: 18px;
          color: #1A1A2E;
          outline: none;
          transition: border-color 150ms;
          letter-spacing: 0.5px;
        }
        .rcp-input:focus { border-color: #3A5CE8; }
        .rcp-input::placeholder {
          color: #C4C3F0;
          font-family: var(--font-mono, 'DM Mono', monospace);
        }

        .rcp-apply-btn {
          width: 100%;
          padding: 14px;
          background: #3A5CE8;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 150ms;
          margin-top: 12px;
        }
        .rcp-apply-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .rcp-apply-btn:not(:disabled):hover { opacity: 0.9; }

        .rcp-skip-btn {
          width: 100%;
          padding: 12px;
          background: transparent;
          border: none;
          color: #8A8C9E;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          font-size: 13px;
          cursor: pointer;
          margin-top: 6px;
        }
        .rcp-skip-btn:hover { color: #3A3C52; }
      `}</style>

      <div className={`rcp-backdrop${animIn ? ' in' : ''}`} onClick={() => dismiss(true)} />

      <div className={`rcp-sheet${animIn ? ' in' : ''}`}>
        <div className="rcp-handle" />

        {promptState === 'success' ? (
          /* ── Success state ── */
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(42,158,138,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 24, color: '#2A9E8A',
            }}>
              ✓
            </div>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 18, fontWeight: 700, color: '#2A9E8A',
            }}>
              Referral applied
            </div>
          </div>
        ) : (
          /* ── Input state ── */
          <>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 20, fontWeight: 700, color: '#1A1A2E',
              marginBottom: 6, textAlign: 'center',
            }}>
              Do you have a referral code?
            </div>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 13, color: '#8A8C9E',
              textAlign: 'center', marginBottom: 24,
            }}>
              Enter a code to credit your referrer
            </div>

            <input
              className="rcp-input"
              type="text"
              placeholder="mw_xxxxxx"
              value={code}
              maxLength={9}
              spellCheck={false}
              autoComplete="off"
              onChange={e => {
                setErrorMsg(null)
                if (promptState === 'error') setPromptState('idle')
                setCode(e.target.value.toLowerCase())
              }}
              onKeyDown={e => { if (e.key === 'Enter' && isValid) handleApply() }}
            />

            {/* Error message */}
            {errorMsg && (
              <div style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontSize: 12, color: '#C2537A',
                marginTop: 8, paddingLeft: 2,
              }}>
                {errorMsg}
              </div>
            )}

            <button
              className="rcp-apply-btn"
              disabled={!isValid || promptState === 'submitting'}
              onClick={handleApply}
            >
              {promptState === 'submitting' ? 'Applying…' : 'Apply Code'}
            </button>

            <button
              className="rcp-skip-btn"
              onClick={() => dismiss(true)}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </>
  )
}
