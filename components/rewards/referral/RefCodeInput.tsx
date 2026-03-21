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
          background: var(--color-mw-surface-purple);
          border: 1.5px solid var(--color-mw-border);
          border-radius: var(--radius-md);
          padding: 9px 13px;
          font-family: var(--font-mono, 'DM Mono', monospace);
          font-size: 12px;
          color: var(--color-mw-ink-2);
          outline: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: default;
          user-select: all;
        }
        .ref-copy-btn {
          padding: 9px 16px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          cursor: pointer;
          border: 1.5px solid transparent;
          transition: opacity var(--transition-fast);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ref-copy-btn:active { opacity: 0.75; }
        .ref-copy-btn.solid {
          background: var(--color-mw-brand-deep);
          color: #fff;
          border-color: var(--color-mw-brand-deep);
        }
        .ref-copy-btn.ghost {
          background: transparent;
          color: var(--color-mw-brand-deep);
          border-color: rgba(58,92,232,0.3);
        }
        .ref-copy-btn.copied {
          background: var(--color-mw-teal);
          border-color: var(--color-mw-teal);
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
