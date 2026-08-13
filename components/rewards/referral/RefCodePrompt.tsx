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
      className={`fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[1099] flex items-center justify-center p-6 transition-opacity duration-[250ms] ease-out ${animIn ? 'opacity-100' : 'opacity-0'}`}
      onClick={() => dismiss(true)}
    >
      <div
        className={`rounded-[var(--radius-panel)] bg-white border border-hair shadow-lift z-[1100] p-[36px_28px_28px] w-full max-w-[400px] transition-[transform,opacity] duration-[250ms] ease-out font-atx-display relative ${animIn ? 'scale-100 translate-y-0 opacity-100' : 'scale-[0.94] translate-y-2 opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-[40px] h-[4px] rounded-full bg-hair mx-auto mb-6" />

        {promptState === 'success' ? (
          /* Success state */
          <div className="text-center py-3">
            <div className="w-[52px] h-[52px] rounded-2xl grid place-items-center mx-auto mb-4 text-white text-[20px]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}>
              ✓
            </div>
            <div className="text-[18px] font-medium text-coral2-deep">
              Referral applied
            </div>
          </div>
        ) : (
          /* Input state */
          <>
            <div className="text-[20px] font-medium text-ink mb-[6px] text-center tracking-[-0.02em]">
              Do you have a referral code?
            </div>
            <div className="text-[13px] text-ink-mid text-center mb-6">
              Enter a code to credit your referrer
            </div>

            <input
              className="w-full box-border rounded-xl bg-ground-cool border border-hair p-[14px_16px] font-mono text-[18px] text-ink outline-none transition-[border-color] duration-150 tracking-[0.5px] placeholder:text-ink-soft focus:border-[rgba(108,108,240,0.5)]"
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
              <div className="text-[12px] text-[#D14343] mt-2 pl-[2px]">
                {errorMsg}
              </div>
            )}

            <button
              className="w-full p-[14px] rounded-full bg-peri text-white text-[14px] font-semibold cursor-pointer transition-colors duration-150 mt-3 disabled:opacity-50 disabled:cursor-not-allowed hover:not-disabled:bg-peri-deep"
              disabled={!isValid || promptState === 'submitting'}
              onClick={handleApply}
            >
              {promptState === 'submitting' ? 'Applying…' : 'Apply Code'}
            </button>

            <button
              className="w-full p-3 bg-transparent border-none text-ink-soft text-[12px] cursor-pointer mt-[6px] hover:text-ink"
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
