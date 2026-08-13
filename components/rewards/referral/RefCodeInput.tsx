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
        className="flex-1 rounded-full bg-ground-cool border border-hair py-[9px] px-[14px] font-mono text-[12px] text-ink-mid outline-none whitespace-nowrap overflow-hidden text-ellipsis cursor-default select-all"
        readOnly
        value={value}
        onClick={copy}
      />
      <button
        className={`py-[9px] px-[16px] rounded-full text-[12px] font-semibold cursor-pointer border transition-colors duration-150 whitespace-nowrap shrink-0 active:opacity-75 ${
          copied
            ? 'bg-coral2 border-transparent text-white'
            : ghost
            ? 'bg-white text-peri-deep border-[rgba(108,108,240,0.4)]'
            : 'bg-peri text-white border-transparent hover:bg-peri-deep'
        }`}
        onClick={copy}
      >
        {copied ? 'Copied' : buttonLabel}
      </button>
    </div>
  )
}
