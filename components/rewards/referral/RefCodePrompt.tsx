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
import { useSignMessage } from 'wagmi'
import { buildReferralApplyMessage } from '@/lib/web3/signedActionMessages'

interface RefCodePromptProps {
  wallet: string
  onDismiss: () => void
}

type PromptState = 'idle' | 'submitting' | 'success' | 'error'

const CODE_PATTERN = /^(?:mw_[0-9a-z]{6}|[A-Za-z0-9][A-Za-z0-9-]{1,31})$/

export function RefCodePrompt({ wallet, onDismiss }: RefCodePromptProps) {
  const { signMessageAsync } = useSignMessage()
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
      const issuedAt = Date.now()
      const authMessage = buildReferralApplyMessage({
        referred: wallet,
        refCode: code,
        issuedAt,
      })
      const authSignature = await signMessageAsync({ message: authMessage })

      // Server-side referral apply — enforces time-gate and performs the insert.
      // Never insert directly from the browser client (bypasses time-gate protection).
      const res = await fetch('/api/referral/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          referred: wallet.toLowerCase(),
          ref_code: code,
          issuedAt,
          authMessage,
          authSignature,
        }),
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
      className={`fixed inset-0 bg-[rgba(21,21,29,.32)] backdrop-blur-[4px] z-[1099] flex items-center justify-center p-6 transition-opacity duration-[250ms] ease-out ${animIn ? 'opacity-100' : 'opacity-0'}`}
      onClick={() => dismiss(true)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Referral code"
        className={`mw-raise-lg rounded-[26px] z-[1100] p-[32px_28px_26px] w-full max-w-[400px] transition-[transform,opacity] duration-[250ms] ease-out font-geist relative overflow-hidden ${animIn ? 'scale-100 translate-y-0 opacity-100' : 'scale-[0.94] translate-y-2 opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div aria-hidden="true" className="absolute -right-20 -top-24 w-64 h-64 rounded-full opacity-25 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />

        {promptState === 'success' ? (
          /* Success state */
          <div className="relative text-center py-3" role="status">
            <div className="w-[52px] h-[52px] rounded-full grid place-items-center mx-auto mb-4 text-white" style={{ background: '#0F7A43', boxShadow: '0 0 0 6px rgba(15,122,67,.12)' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
            </div>
            <div className="text-[19px] font-semibold tracking-[-0.02em]">
              Referral applied
            </div>
          </div>
        ) : (
          /* Input state */
          <>
            <div className="relative text-[21px] font-semibold text-ink mb-[6px] text-center tracking-[-0.03em]">
              Do you have a referral code?
            </div>
            <div className="relative text-[14px] text-ink-mid text-center mb-6">
              Enter a code to credit the person who invited you
            </div>

            <input
              aria-label="Referral code"
              className="relative w-full box-border rounded-[14px] border-0 p-[14px_16px] font-geist-mono text-[18px] text-ink outline-none tracking-[0.5px] placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
              style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}
              type="text"
              placeholder="mw_xxxxxx or jake"
              value={code}
              maxLength={32}
              spellCheck={false}
              autoComplete="off"
              onChange={e => {
                setErrorMsg(null)
                if (promptState === 'error') setPromptState('idle')
                setCode(e.target.value.trim())
              }}
              onKeyDown={e => { if (e.key === 'Enter' && isValid) handleApply() }}
            />

            {/* Error message */}
            {errorMsg && (
              <div role="alert" className="relative text-[13px] text-[#B42318] mt-2 pl-[2px]">
                {errorMsg}
              </div>
            )}

            <button
              className="mw-btn relative w-full !min-h-[50px] !rounded-[14px] text-[15px] mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!isValid || promptState === 'submitting'}
              onClick={handleApply}
            >
              {promptState === 'submitting' ? 'Applying…' : 'Apply Code'}
            </button>

            <button
              className="relative w-full min-h-[44px] bg-transparent border-none text-ink-mid text-[14px] cursor-pointer mt-[4px] hover:text-ink"
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
