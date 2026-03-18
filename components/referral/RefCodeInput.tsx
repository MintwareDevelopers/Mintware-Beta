'use client'

import { useState } from 'react'

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
  }

  return (
    <>
      <style>{`
        .ref-input-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ref-input {
          flex: 1;
          background: #F7F6FF;
          border: 1.5px solid rgba(26,26,46,0.10);
          border-radius: 10px;
          padding: 9px 13px;
          font-family: var(--font-mono, 'DM Mono', monospace);
          font-size: 12px;
          color: #3A3C52;
          outline: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: default;
          user-select: all;
        }
        .ref-copy-btn {
          padding: 9px 16px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          cursor: pointer;
          border: 1.5px solid transparent;
          transition: opacity 0.15s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ref-copy-btn:active { opacity: 0.75; }
        .ref-copy-btn.solid {
          background: #3A5CE8;
          color: #fff;
          border-color: #3A5CE8;
        }
        .ref-copy-btn.ghost {
          background: transparent;
          color: #3A5CE8;
          border-color: rgba(58,92,232,0.3);
        }
        .ref-copy-btn.copied {
          background: #2A9E8A;
          border-color: #2A9E8A;
          color: #fff;
        }
      `}</style>
      <div className="ref-input-wrap">
        <input
          className="ref-input"
          readOnly
          value={value}
          onClick={copy}
        />
        <button
          className={`ref-copy-btn ${copied ? 'copied' : ghost ? 'ghost' : 'solid'}`}
          onClick={copy}
        >
          {copied ? 'Copied!' : buttonLabel}
        </button>
      </div>
    </>
  )
}
