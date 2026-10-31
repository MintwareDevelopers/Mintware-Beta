'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface RefCodeInputProps {
  value:        string
  buttonLabel?: string
  ghost?:       boolean
}

export function RefCodeInput({ value, buttonLabel = 'Copy', ghost = false }: RefCodeInputProps) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success(buttonLabel === 'Copy Link' ? 'Referral link copied' : 'Referral code copied')
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 min-w-0 rounded-[12px] border-0 min-h-[44px] px-[14px] font-geist-mono text-[13px] text-ink-mid outline-none whitespace-nowrap overflow-hidden text-ellipsis cursor-default select-all"
        style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}
        readOnly
        aria-label={buttonLabel === 'Copy Link' ? 'Referral link' : 'Referral code'}
        value={value}
        onClick={copy}
      />
      <button
        className={`${ghost && !copied ? 'mw-btn-quiet' : 'mw-btn'} !min-h-[44px] !px-4 text-[13.5px] whitespace-nowrap shrink-0`}
        style={copied ? { background: '#0F7A43', boxShadow: 'none' } : undefined}
        onClick={copy}
      >
        {copied ? 'Copied' : buttonLabel}
      </button>
    </div>
  )
}
