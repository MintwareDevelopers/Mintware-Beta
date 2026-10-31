'use client'

// One live read of an RWA liquidity unit (GET /api/rwa/unit, polled), shared by the overview, the market
// page and the proof page so they can never disagree about the numbers.

import { useCallback, useEffect, useRef, useState } from 'react'

import type { RwaUnitLive } from '@/lib/rwa/read'
export type { RwaUnitLive } from '@/lib/rwa/read'

export function useRwaUnit(slug: string, pollMs = 12_000, account?: string) {
  const [unit, setUnit] = useState<RwaUnitLive | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)

  const scope = `${slug}:${account ?? ''}`
  const request = useRef({ scope, version: 0 })
  if (request.current.scope !== scope) request.current = { scope, version: request.current.version + 1 }

  const unavailable = useCallback(() => {
    setFailed(true)
    setUnit((previous) => previous?.source === 'live' ? { ...previous, source: 'cached' } : previous)
  }, [])

  const load = useCallback(() => {
    const version = ++request.current.version
    const current = () => request.current.scope === scope && request.current.version === version
    return fetch(`/api/rwa/unit?unit=${slug}${account ? `&account=${account}` : ''}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('RWA read unavailable'); return r.json() })
      .then((d: RwaUnitLive) => { if (!current()) return; if (d.ok) { setUnit(d); setFailed(d.source === 'cached') } else unavailable() })
      .catch(() => { if (current()) unavailable() })
  }, [slug, account, scope, unavailable])

  useEffect(() => {
    setUnit(null)
    setFailed(false)
    load()
    const poll = setInterval(() => load(), pollMs)
    const tick = setInterval(() => setNow(Date.now() / 1000), 1_000)
    return () => { ++request.current.version; clearInterval(poll); clearInterval(tick) }
  }, [load, pollMs])

  return { unit, failed, now, reload: load }
}

export const usd = (n: number, d = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
export const ago = (secs: number) => {
  if (secs < 90) return `${Math.max(1, Math.round(secs))}s ago`
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`
  if (secs < 172800) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} days ago`
}

export type RwaStatus = { t: string; tone: 'good' | 'info' | 'warn' }
export function rwaStatus(unit: RwaUnitLive | null): RwaStatus | null {
  if (!unit) return null
  if (unit.source === 'undeployed') return { t: 'Not deployed yet', tone: 'info' }
  if (unit.source === 'cached') return { t: 'Current appraisal status unavailable — cached data', tone: 'warn' }
  if (!unit.engine?.activated) return { t: 'Engine inactive', tone: 'info' }
  if (!unit.hook) return { t: 'Appraisal unavailable', tone: 'warn' }
  if (unit.hook.paused || !unit.hook.permissions.swappingEnabled) return { t: 'Trading paused', tone: 'warn' }
  if (!unit.hook.fresh && unit.hook.oracleReady) return { t: 'Appraisal stale — trading halted, exit window open', tone: 'warn' }
  if (!unit.hook.fresh) return { t: 'Appraisal expired — awaiting a new appraisal', tone: 'warn' }
  if (unit.hook.inCore) return { t: 'Trading inside the core band', tone: 'good' }
  if (unit.hook.inSpec) return { t: 'Trading inside the band', tone: 'info' }
  return { t: 'Outside the band — gap-closing trades only', tone: 'warn' }
}
export const STATUS_CLS: Record<RwaStatus['tone'], string> = {
  good: 'text-[#0F7A43] bg-[#E3F4EA]',
  info: 'text-peri-deep bg-[#EDE9FB]',
  warn: 'text-[#9A3F1C] bg-[#FBEEE7]',
}
