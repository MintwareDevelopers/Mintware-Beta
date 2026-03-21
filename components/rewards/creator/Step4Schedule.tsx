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
    <>
      <style>{`
        .sched-option {
          flex: 1;
          border: 1.5px solid #E0DFFF;
          border-radius: 14px;
          padding: 20px;
          cursor: pointer;
          transition: all 200ms;
          background: #fff;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sched-option.active {
          border-color: #3A5CE8;
          background: rgba(58,92,232,0.03);
          box-shadow: 0 0 0 3px rgba(58,92,232,0.08);
        }
        .sched-option:hover:not(.active) {
          border-color: #C4C3F0;
          background: #F7F6FF;
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Option cards */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div
            className={`sched-option${isNow ? ' active' : ''}`}
            onClick={() => onChange({ schedule: 'now', startAt: null })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${isNow ? '#3A5CE8' : '#E0DFFF'}`,
                background: isNow ? '#3A5CE8' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isNow && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 700, color: isNow ? '#3A5CE8' : '#1A1A2E' }}>
                Start Now
              </span>
            </div>
            <p style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', margin: 0, paddingLeft: 30 }}>
              Campaign goes live immediately after funding is confirmed.
            </p>
          </div>

          <div
            className={`sched-option${isScheduled ? ' active' : ''}`}
            onClick={() => onChange({ schedule: 'scheduled' })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${isScheduled ? '#3A5CE8' : '#E0DFFF'}`,
                background: isScheduled ? '#3A5CE8' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isScheduled && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 700, color: isScheduled ? '#3A5CE8' : '#1A1A2E' }}>
                Schedule
              </span>
            </div>
            <p style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', margin: 0, paddingLeft: 30 }}>
              Pick a future date. Campaign appears as "Coming Soon" and starts automatically.
            </p>
          </div>
        </div>

        {/* Date/time picker */}
        {isScheduled && (
          <div>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 12, fontWeight: 700, color: '#8A8C9E',
              letterSpacing: '0.5px', textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Start date & time (your local time)
            </div>
            <input
              type="datetime-local"
              min={toDatetimeLocal(minDate)}
              max={toDatetimeLocal(maxDate)}
              value={startAt ? toDatetimeLocal(startAt) : ''}
              style={{
                width: '100%', boxSizing: 'border-box',
                fontFamily: 'DM Mono, monospace', fontSize: 13,
                padding: '11px 14px', borderRadius: 10,
                border: `1.5px solid ${focused ? '#3A5CE8' : tooSoon || tooFar ? '#C2537A' : '#E0DFFF'}`,
                background: '#fff', color: '#1A1A2E', outline: 'none',
                transition: 'border-color 150ms',
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={handleDateChange}
            />

            {tooSoon && (
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#C2537A', marginTop: 6 }}>
                Start time must be at least 1 hour from now.
              </div>
            )}
            {tooFar && (
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#C2537A', marginTop: 6 }}>
                Start time cannot be more than 30 days from now.
              </div>
            )}

            {startAt && !tooSoon && !tooFar && (
              <div style={{
                marginTop: 10,
                background: '#F7F6FF', border: '1px solid #E0DFFF',
                borderRadius: 10, padding: '10px 14px',
                display: 'flex', gap: 16, flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
                    {toUTCString(startAt)}
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 2 }}>
                    UTC
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
                    {startAt.toLocaleString()}
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 2 }}>
                    Your local time
                  </div>
                </div>
              </div>
            )}

            <div style={{
              marginTop: 14,
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#8A8C9E',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div>◷ Appears on dashboard as "Coming Soon" until launch</div>
              <div>🔗 You can share the campaign link before it goes live</div>
            </div>
          </div>
        )}

        {isNow && (
          <div style={{
            background: 'rgba(42,158,138,0.06)', border: '1px solid rgba(42,158,138,0.15)',
            borderRadius: 10, padding: '12px 16px',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#2A9E8A',
          }}>
            ✓ Campaign will go live as soon as your funding transaction is confirmed on-chain.
          </div>
        )}
      </div>
    </>
  )
}
