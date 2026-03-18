'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { ReferralStats, ReferralRecord } from '@/lib/referral/types'

export interface UseReferralReturn {
  stats:           ReferralStats | null
  referralRecords: ReferralRecord[]
  isFirstConnect:  boolean
  isLoading:       boolean
  refetch:         () => void
}

// Capture ?ref= param immediately on module load (before wallet connects)
if (typeof window !== 'undefined') {
  const ref = new URLSearchParams(window.location.search).get('ref')
  if (ref) sessionStorage.setItem('mw_pending_ref', ref)
}

export function useReferral(address: string | undefined): UseReferralReturn {
  const [stats, setStats]                     = useState<ReferralStats | null>(null)
  const [referralRecords, setReferralRecords] = useState<ReferralRecord[]>([])
  const [isFirstConnect, setIsFirstConnect]   = useState(false)
  const [isLoading, setIsLoading]             = useState(false)
  const [tick, setTick]                       = useState(0)   // increment to force refetch

  useEffect(() => {
    if (!address) return
    const addr = address  // narrow string | undefined → string for closures

    // Reads use the browser client (anon key — SELECT is allowed by RLS)
    // Writes go through /api/referral (service role key — bypasses RLS)
    const supabase = createSupabaseBrowserClient()
    let cancelled  = false

    async function run() {
      setIsLoading(true)
      try {
        const pendingRef = sessionStorage.getItem('mw_pending_ref')

        // Server handles: upsert wallet_profiles + referral attribution
        const res = await fetch('/api/referral', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ address: addr, pendingRef }),
        })

        // Clear pending ref regardless of outcome
        if (pendingRef) sessionStorage.removeItem('mw_pending_ref')

        if (res.ok) {
          const payload = await res.json() as { isNew: boolean; stats: ReferralStats | null }
          if (!cancelled) {
            setIsFirstConnect(payload.isNew)
            if (payload.stats) setStats(payload.stats)
          }
        } else {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          console.error('[useReferral] init error:', err.error)
        }

        // Fetch referral records (client-side read — anon key works)
        const { data: records, error: recErr } = await supabase
          .from('referral_records')
          .select('*')
          .eq('referrer', addr)
          .order('status', { ascending: true })
          .limit(10)
        if (recErr) console.error('[useReferral] referral_records error:', recErr.code, recErr.message, recErr.details)
        if (records && !cancelled) setReferralRecords(records as ReferralRecord[])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    run()

    // Realtime: refetch stats via API when referral_records changes for this referrer
    const channel = supabase
      .channel(`referrals:${addr}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referral_records', filter: `referrer=eq.${addr}` },
        async () => {
          const res = await fetch(`/api/referral?address=${addr}`)
          if (res.ok) {
            const updated = await res.json()
            if (!cancelled) setStats(updated as ReferralStats)
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [address, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = () => setTick(t => t + 1)

  return { stats, referralRecords, isFirstConnect, isLoading, refetch }
}
