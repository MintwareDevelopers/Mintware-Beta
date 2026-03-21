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
    <>
      <style>{`
        .slippage-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .slippage-label {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #8A8C9E;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          margin-right: 4px;
          white-space: nowrap;
        }
        .slippage-pill {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          border: 1.5px solid #E0DFFF;
          border-radius: 20px;
          padding: 3px 10px;
          cursor: pointer;
          background: #fff;
          color: #3A3C52;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .slippage-pill:hover {
          border-color: #3A5CE8;
          color: #3A5CE8;
        }
        .slippage-pill.active {
          background: #3A5CE8;
          border-color: #3A5CE8;
          color: #fff;
        }
        .slippage-custom-wrap {
          position: relative;
        }
        .slippage-custom-input {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          width: 56px;
          border: 1.5px solid #E0DFFF;
          border-radius: 20px;
          padding: 3px 20px 3px 8px;
          outline: none;
          background: #fff;
          color: #1A1A2E;
          transition: border-color 0.15s;
        }
        .slippage-custom-input:focus {
          border-color: #3A5CE8;
        }
        .slippage-custom-input.err {
          border-color: #C2537A;
        }
        .slippage-custom-input.active-custom {
          border-color: #3A5CE8;
          background: #F0F3FF;
        }
        .slippage-pct-suffix {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #8A8C9E;
          pointer-events: none;
        }
        .slippage-err-msg {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          color: #C2537A;
          margin-top: 2px;
          margin-left: 2px;
        }
      `}</style>

      <div>
        <div className="slippage-row">
          <span className="slippage-label">Slippage</span>
          {PRESET_OPTIONS.map((opt, i) => (
            <button
              key={opt}
              className={`slippage-pill${!isCustom && value === opt ? ' active' : ''}`}
              onClick={() => selectPreset(opt)}
              type="button"
            >
              {PRESET_LABELS[i]}
            </button>
          ))}
          {/* Custom pill/input */}
          {isCustom ? (
            <div className="slippage-custom-wrap">
              <input
                ref={inputRef}
                className={`slippage-custom-input active-custom${customErr ? ' err' : ''}`}
                type="number"
                min="0.01"
                max="50"
                step="0.1"
                value={customRaw}
                onChange={(e) => handleCustomInput(e.target.value)}
                placeholder="0.5"
              />
              <span className="slippage-pct-suffix">%</span>
            </div>
          ) : (
            <button
              className="slippage-pill"
              onClick={selectCustom}
              type="button"
            >
              Custom
            </button>
          )}
        </div>
        {customErr && (
          <div className="slippage-err-msg">Enter a value between 0.01% and 50%</div>
        )}
      </div>
    </>
  )
}
