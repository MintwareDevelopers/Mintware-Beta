'use client'

// =============================================================================
// components/swap/SlippageControl.tsx
//
// Three pill buttons: 0.5% | 1% | Custom
// Active pill: solid #3A5CE8 background, white text
// Custom: reveals inline input when selected
// =============================================================================

import { useState, useRef } from 'react'

const PRESET_OPTIONS = [0.005, 0.01, 0.03] // 0.5%, 1%, 3%
const PRESET_LABELS  = ['0.5%', '1%', '3%']

interface SlippageControlProps {
  value: number           // decimal (e.g. 0.01 = 1%)
  onChange: (v: number) => void
}

export function SlippageControl({ value, onChange }: SlippageControlProps) {
  const presetIndex = PRESET_OPTIONS.indexOf(value)
  const isCustom    = presetIndex === -1
  const [customRaw, setCustomRaw]   = useState(isCustom ? String(value * 100) : '')
  const [customErr, setCustomErr]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function selectPreset(v: number) {
    setCustomErr(false)
    onChange(v)
  }

  function selectCustom() {
    onChange(-1 as unknown as number) // signal custom mode without changing actual value
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleCustomInput(raw: string) {
    setCustomRaw(raw)
    const num = parseFloat(raw)
    if (isNaN(num) || num <= 0 || num > 50) {
      setCustomErr(true)
      return
    }
    setCustomErr(false)
    onChange(num / 100)
  }

  return (
    <div>
      <div className="flex items-center gap-[6px]">
        <span className="font-sans text-[11px] font-semibold text-mw-ink-4 tracking-[0.4px] uppercase mr-[4px] whitespace-nowrap">
          Slippage
        </span>
        {PRESET_OPTIONS.map((opt, i) => (
          <button
            key={opt}
            className={`font-mono text-[12px] font-medium border-[1.5px] border-[#E0DFFF] rounded-xl px-[10px] py-[3px] cursor-pointer whitespace-nowrap transition-all duration-150 hover:border-mw-brand-deep hover:text-mw-brand-deep${!isCustom && value === opt ? ' bg-mw-brand-deep border-mw-brand-deep text-white' : ' bg-white text-[#3A3C52]'}`}
            onClick={() => selectPreset(opt)}
            type="button"
          >
            {PRESET_LABELS[i]}
          </button>
        ))}
        {/* Custom pill/input */}
        {isCustom ? (
          <div className="relative">
            <input
              ref={inputRef}
              className={`font-mono text-[12px] font-medium w-[56px] border-[1.5px] rounded-xl px-[8px] py-[3px] pr-[20px] outline-none bg-[#F0F3FF] text-mw-ink transition-colors duration-150 border-mw-brand-deep${customErr ? ' border-mw-pink' : ''}`}
              type="number"
              min="0.01"
              max="50"
              step="0.1"
              value={customRaw}
              onChange={(e) => handleCustomInput(e.target.value)}
              placeholder="0.5"
            />
            <span className="absolute right-[8px] top-1/2 -translate-y-1/2 font-mono text-[11px] text-mw-ink-4 pointer-events-none">%</span>
          </div>
        ) : (
          <button
            className="font-mono text-[12px] font-medium border-[1.5px] border-[#E0DFFF] rounded-xl px-[10px] py-[3px] cursor-pointer whitespace-nowrap bg-white text-[#3A3C52] transition-all duration-150 hover:border-mw-brand-deep hover:text-mw-brand-deep"
            onClick={selectCustom}
            type="button"
          >
            Custom
          </button>
        )}
      </div>
      {customErr && (
        <div className="font-sans text-[10px] text-mw-pink mt-[2px] ml-[2px]">
          Enter a value between 0.01% and 50%
        </div>
      )}
    </div>
  )
}
