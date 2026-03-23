'use client'

// =============================================================================
// Step4Schedule.tsx — Start Now vs Schedule
//
// Start Now:   campaign goes live once funded
// Schedule:    date + time picker (UTC, min 1h from now, max 30d)
//              Shows local time + UTC side by side
// =============================================================================

import { useState } from 'react'
import type { CreatorFormState } from '@/lib/rewards/creator'

interface Step4ScheduleProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function pad(n: number) { return String(n).padStart(2, '0') }

function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toUTCString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function Step4Schedule({ form, onChange }: Step4ScheduleProps) {
  const now     = new Date()
  const minDate = new Date(now.getTime() + 60 * 60 * 1000)        // +1h
  const maxDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // +30d

  const [focused, setFocused] = useState(false)

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (!v) { onChange({ startAt: null }); return }
    const d = new Date(v)
    if (!isNaN(d.getTime())) onChange({ startAt: d })
  }

  const isNow       = form.schedule === 'now'
  const isScheduled = form.schedule === 'scheduled'
  const startAt     = form.startAt

  const tooSoon = startAt && startAt < minDate
  const tooFar  = startAt && startAt > maxDate

  return (
    <div className="flex flex-col gap-7">

      {/* Option cards */}
      <div className="flex gap-4 flex-wrap">
        <div
          className={`flex-1 border-[1.5px] rounded-[14px] p-5 cursor-pointer transition-all duration-200 bg-white flex flex-col gap-2${isNow ? ' border-[#3A5CE8] bg-[rgba(58,92,232,0.03)] shadow-[0_0_0_3px_rgba(58,92,232,0.08)]' : ' border-[#E0DFFF] hover:border-[#C4C3F0] hover:bg-mw-surface-purple'}`}
          onClick={() => onChange({ schedule: 'now', startAt: null })}
        >
          <div className="flex items-center gap-[10px]">
            <div
              className={`w-5 h-5 rounded-full shrink-0 border-2 flex items-center justify-center ${isNow ? 'border-[#3A5CE8] bg-[#3A5CE8]' : 'border-[#E0DFFF] bg-transparent'}`}
            >
              {isNow && <div className="w-[7px] h-[7px] rounded-full bg-white" />}
            </div>
            <span
              className={`font-sans text-[15px] font-bold ${isNow ? 'text-mw-brand-deep' : 'text-[#1A1A2E]'}`}
            >
              Start Now
            </span>
          </div>
          <p className="font-sans text-[13px] text-mw-ink-4 m-0 pl-[30px]">
            Campaign goes live immediately after funding is confirmed.
          </p>
        </div>

        <div
          className={`flex-1 border-[1.5px] rounded-[14px] p-5 cursor-pointer transition-all duration-200 bg-white flex flex-col gap-2${isScheduled ? ' border-[#3A5CE8] bg-[rgba(58,92,232,0.03)] shadow-[0_0_0_3px_rgba(58,92,232,0.08)]' : ' border-[#E0DFFF] hover:border-[#C4C3F0] hover:bg-mw-surface-purple'}`}
          onClick={() => onChange({ schedule: 'scheduled' })}
        >
          <div className="flex items-center gap-[10px]">
            <div
              className={`w-5 h-5 rounded-full shrink-0 border-2 flex items-center justify-center ${isScheduled ? 'border-[#3A5CE8] bg-[#3A5CE8]' : 'border-[#E0DFFF] bg-transparent'}`}
            >
              {isScheduled && <div className="w-[7px] h-[7px] rounded-full bg-white" />}
            </div>
            <span
              className={`font-sans text-[15px] font-bold ${isScheduled ? 'text-mw-brand-deep' : 'text-[#1A1A2E]'}`}
            >
              Schedule
            </span>
          </div>
          <p className="font-sans text-[13px] text-mw-ink-4 m-0 pl-[30px]">
            Pick a future date. Campaign appears as &quot;Coming Soon&quot; and starts automatically.
          </p>
        </div>
      </div>

      {/* Date/time picker */}
      {isScheduled && (
        <div>
          <div className="font-sans text-[12px] font-bold text-mw-ink-4 tracking-[0.5px] uppercase mb-[10px]">
            Start date & time (your local time)
          </div>
          <input
            type="datetime-local"
            min={toDatetimeLocal(minDate)}
            max={toDatetimeLocal(maxDate)}
            value={startAt ? toDatetimeLocal(startAt) : ''}
            className="w-full box-border font-mono text-[13px] p-[11px_14px] rounded-[10px] bg-white text-[#1A1A2E] outline-none transition-[border-color] duration-150 border-[1.5px]"
            style={{
              borderColor: focused ? '#3A5CE8' : (tooSoon || tooFar) ? '#C2537A' : '#E0DFFF',
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={handleDateChange}
          />

          {tooSoon && (
            <div className="font-sans text-[12px] text-mw-pink mt-[6px]">
              Start time must be at least 1 hour from now.
            </div>
          )}
          {tooFar && (
            <div className="font-sans text-[12px] text-mw-pink mt-[6px]">
              Start time cannot be more than 30 days from now.
            </div>
          )}

          {startAt && !tooSoon && !tooFar && (
            <div className="mt-[10px] bg-mw-surface-purple border border-[#E0DFFF] rounded-[10px] p-[10px_14px] flex gap-4 flex-wrap">
              <div>
                <div className="font-mono text-[13px] font-bold text-[#1A1A2E]">
                  {toUTCString(startAt)}
                </div>
                <div className="font-sans text-[10px] text-mw-ink-4 mt-[2px]">
                  UTC
                </div>
              </div>
              <div>
                <div className="font-mono text-[13px] font-bold text-[#1A1A2E]">
                  {startAt.toLocaleString()}
                </div>
                <div className="font-sans text-[10px] text-mw-ink-4 mt-[2px]">
                  Your local time
                </div>
              </div>
            </div>
          )}

          <div className="mt-[14px] font-sans text-[12px] text-mw-ink-4 flex flex-col gap-1">
            <div>◷ Appears on dashboard as &quot;Coming Soon&quot; until launch</div>
            <div>🔗 You can share the campaign link before it goes live</div>
          </div>
        </div>
      )}

      {isNow && (
        <div className="bg-[rgba(42,158,138,0.06)] border border-[rgba(42,158,138,0.15)] rounded-[10px] p-[12px_16px] font-sans text-[13px] text-mw-teal">
          ✓ Campaign will go live as soon as your funding transaction is confirmed on-chain.
        </div>
      )}
    </div>
  )
}
