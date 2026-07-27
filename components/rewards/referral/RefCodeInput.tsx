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
        className="flex-1 bg-atx-bone border border-atx-ink/25 py-[9px] px-[13px] font-atx-mono text-[12px] text-atx-ink/70 outline-none whitespace-nowrap overflow-hidden text-ellipsis cursor-default select-all"
        readOnly
        value={value}
        onClick={copy}
      />
      <button
        className={`py-[9px] px-[16px] text-[12px] font-semibold font-atx-mono uppercase tracking-[0.05em] cursor-pointer border transition-opacity duration-150 whitespace-nowrap shrink-0 active:opacity-75 ${
          copied
            ? 'bg-atx-mesquite border-atx-ink text-white'
            : ghost
            ? 'bg-transparent text-atx-blue border-atx-blue'
            : 'bg-atx-blue text-white border-atx-ink'
        }`}
        onClick={copy}
      >
        {copied ? 'Copied' : buttonLabel}
      </button>
    </div>
  )
}
