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
          className={`flex-1 border p-5 cursor-pointer transition-colors duration-200 bg-atx-panel flex flex-col gap-2${isNow ? ' border-atx-ink border-l-[3px] border-l-atx-blue bg-atx-bone' : ' border-atx-ink/25 hover:border-atx-ink'}`}
          onClick={() => onChange({ schedule: 'now', startAt: null })}
        >
          <div className="flex items-center gap-[10px]">
            <div
              className={`w-5 h-5 shrink-0 border flex items-center justify-center ${isNow ? 'border-atx-ink bg-atx-panel' : 'border-atx-ink/30 bg-transparent'}`}
            >
              {isNow && <div className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />}
            </div>
            <span
              className={`font-atx-display text-[15px] font-bold ${isNow ? 'text-atx-blue' : 'text-atx-ink'}`}
            >
              Start Now
            </span>
          </div>
          <p className="font-atx-display text-[13px] text-atx-ink/55 m-0 pl-[30px]">
            Campaign goes live immediately after funding is confirmed.
          </p>
        </div>

        <div
          className={`flex-1 border p-5 cursor-pointer transition-colors duration-200 bg-atx-panel flex flex-col gap-2${isScheduled ? ' border-atx-ink border-l-[3px] border-l-atx-blue bg-atx-bone' : ' border-atx-ink/25 hover:border-atx-ink'}`}
          onClick={() => onChange({ schedule: 'scheduled' })}
        >
          <div className="flex items-center gap-[10px]">
            <div
              className={`w-5 h-5 shrink-0 border flex items-center justify-center ${isScheduled ? 'border-atx-ink bg-atx-panel' : 'border-atx-ink/30 bg-transparent'}`}
            >
              {isScheduled && <div className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />}
            </div>
            <span
              className={`font-atx-display text-[15px] font-bold ${isScheduled ? 'text-atx-blue' : 'text-atx-ink'}`}
            >
              Schedule
            </span>
          </div>
          <p className="font-atx-display text-[13px] text-atx-ink/55 m-0 pl-[30px]">
            Pick a future date. Campaign appears as &quot;Coming Soon&quot; and starts automatically.
          </p>
        </div>
      </div>

      {/* Date/time picker */}
      {isScheduled && (
        <div>
          <div className="font-atx-mono text-[10px] font-semibold text-atx-ink/55 tracking-[0.08em] uppercase mb-[10px]">
            Start date & time (your local time)
          </div>
          <input
            type="datetime-local"
            min={toDatetimeLocal(minDate)}
            max={toDatetimeLocal(maxDate)}
            value={startAt ? toDatetimeLocal(startAt) : ''}
            className="w-full box-border font-atx-mono text-[13px] px-[14px] py-[11px] bg-atx-panel text-atx-ink outline-none transition-[border-color] duration-150 border"
            style={{
              borderColor: focused ? '#006FCC' : (tooSoon || tooFar) ? '#C95E43' : 'rgba(17,17,17,0.30)',
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={handleDateChange}
          />

          {tooSoon && (
            <div className="font-atx-mono text-[12px] text-atx-clay mt-[6px]">
              Start time must be at least 1 hour from now.
            </div>
          )}
          {tooFar && (
            <div className="font-atx-mono text-[12px] text-atx-clay mt-[6px]">
              Start time cannot be more than 30 days from now.
            </div>
          )}

          {startAt && !tooSoon && !tooFar && (
            <div className="mt-[10px] bg-atx-bone border border-atx-ink/25 px-[14px] py-[10px] flex gap-4 flex-wrap">
              <div>
                <div className="font-atx-mono text-[13px] font-bold text-atx-ink">
                  {toUTCString(startAt)}
                </div>
                <div className="font-atx-mono text-[10px] uppercase tracking-[0.06em] text-atx-ink/55 mt-[2px]">
                  UTC
                </div>
              </div>
              <div>
                <div className="font-atx-mono text-[13px] font-bold text-atx-ink">
                  {startAt.toLocaleString()}
                </div>
                <div className="font-atx-mono text-[10px] uppercase tracking-[0.06em] text-atx-ink/55 mt-[2px]">
                  Your local time
                </div>
              </div>
            </div>
          )}

          <div className="mt-[14px] font-atx-mono text-[12px] text-atx-ink/55 flex flex-col gap-1">
            <div>Appears on dashboard as &quot;Coming Soon&quot; until launch</div>
            <div>You can share the campaign link before it goes live</div>
          </div>
        </div>
      )}

      {isNow && (
        <div className="bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-mesquite px-4 py-3 font-atx-mono text-[13px] text-atx-mesquite flex items-center gap-2">
          <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block shrink-0" />
          Campaign will go live as soon as your funding transaction is confirmed on-chain.
        </div>
      )}
    </div>
  )
}
