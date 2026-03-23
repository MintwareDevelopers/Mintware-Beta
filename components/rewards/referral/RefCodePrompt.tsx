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
      // Server-side referral apply — enforces time-gate and performs the insert.
      // Never insert directly from the browser client (bypasses time-gate protection).
      const res = await fetch('/api/referral/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ referred: wallet.toLowerCase(), ref_code: code }),
      })

      const data = await res.json() as { applied?: boolean; skip_reason?: string }

      if (!res.ok) {
        setErrorMsg('Something went wrong. Please try again.')
        setPromptState('error')
        return
      }

      if (!data.applied) {
        const skipReason = data.skip_reason
        if (skipReason === 'ref_code_not_found') {
          setErrorMsg('Code not found — check and try again')
        } else if (skipReason === 'self_referral') {
          setErrorMsg('You cannot use your own referral code')
        } else if (skipReason === 'referrer_too_new') {
          setErrorMsg('This code isn\'t eligible yet — try again later')
        } else {
          setErrorMsg('Code could not be applied — try again')
        }
        setPromptState('error')
        return
      }

      setPromptState('success')
      localStorage.setItem(`mw_ref_dismissed_${wallet}`, 'true')

      // Auto-dismiss after 2s
      setTimeout(() => dismiss(false), 2000)
    } catch (err) {
      console.error('[RefCodePrompt] error:', err)
      setErrorMsg('Something went wrong. Please try again.')
      setPromptState('error')
    }
  }, [isValid, promptState, code, wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className={`fixed inset-0 bg-[rgba(0,0,0,0.4)] z-[1099] flex items-center justify-center p-6 transition-opacity duration-[250ms] ease-out ${animIn ? 'opacity-100' : 'opacity-0'}`}
      onClick={() => dismiss(true)}
    >
      <div
        className={`bg-white rounded-[20px] shadow-[0_8px_48px_rgba(58,92,232,0.18)] z-[1100] p-[36px_28px_28px] w-full max-w-[400px] transition-[transform,opacity] duration-[250ms] ease-out font-sans relative ${animIn ? 'scale-100 translate-y-0 opacity-100' : 'scale-[0.94] translate-y-2 opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-[36px] h-[4px] bg-[rgba(26,26,46,0.12)] rounded-[2px] mx-auto mb-6" />

        {promptState === 'success' ? (
          /* Success state */
          <div className="text-center py-3">
            <div className="w-[52px] h-[52px] rounded-full bg-[rgba(42,158,138,0.1)] flex items-center justify-center mx-auto mb-4 text-[24px] text-mw-teal">
              ✓
            </div>
            <div className="font-sans text-[18px] font-bold text-mw-teal">
              Referral applied
            </div>
          </div>
        ) : (
          /* Input state */
          <>
            <div className="font-sans text-[20px] font-bold text-[#1A1A2E] mb-[6px] text-center">
              Do you have a referral code?
            </div>
            <div className="font-sans text-[13px] text-mw-ink-4 text-center mb-6">
              Enter a code to credit your referrer
            </div>

            <input
              className="w-full box-border bg-mw-surface-purple border-[1.5px] border-[#E0DFFF] rounded-[10px] p-[14px_16px] font-mono text-[18px] text-[#1A1A2E] outline-none transition-[border-color] duration-150 tracking-[0.5px] placeholder:text-[#C4C3F0] focus:border-[#3A5CE8]"
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
              <div className="font-sans text-[12px] text-mw-pink mt-2 pl-[2px]">
                {errorMsg}
              </div>
            )}

            <button
              className="w-full p-[14px] bg-mw-brand-deep text-white border-none rounded-[10px] font-sans text-[15px] font-semibold cursor-pointer transition-opacity duration-150 mt-3 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:opacity-90"
              disabled={!isValid || promptState === 'submitting'}
              onClick={handleApply}
            >
              {promptState === 'submitting' ? 'Applying…' : 'Apply Code'}
            </button>

            <button
              className="w-full p-3 bg-transparent border-none text-mw-ink-4 font-sans text-[13px] cursor-pointer mt-[6px] hover:text-[#3A3C52]"
              onClick={() => dismiss(true)}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  )
}
