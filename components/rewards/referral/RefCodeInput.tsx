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
        className="flex-1 bg-mw-surface-purple border-[1.5px] border-mw-border rounded-md py-[9px] px-[13px] font-mono text-[12px] text-mw-ink-2 outline-none whitespace-nowrap overflow-hidden text-ellipsis cursor-default select-all"
        readOnly
        value={value}
        onClick={copy}
      />
      <button
        className={`py-[9px] px-[16px] rounded-md text-[12px] font-semibold font-sans cursor-pointer border-[1.5px] border-transparent transition-opacity duration-150 whitespace-nowrap shrink-0 active:opacity-75 ${
          copied
            ? 'bg-mw-teal border-mw-teal text-white'
            : ghost
            ? 'bg-transparent text-mw-brand-deep border-[rgba(58,92,232,0.3)]'
            : 'bg-mw-brand-deep text-white border-mw-brand-deep'
        }`}
        onClick={copy}
      >
        {copied ? 'Copied!' : buttonLabel}
      </button>
    </div>
  )
}
