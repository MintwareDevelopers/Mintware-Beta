'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { ReferralStats, ReferralRecord } from '@/lib/referral/types'

export interface UseReferralReturn {
  stats:                ReferralStats | null
  referralRecords:      ReferralRecord[]
  refCode:              string | null     // null while loading on first connect
  isFirstConnect:       boolean
  isLoading:            boolean
  refetch:              () => void
  showRefCodePrompt:    boolean
  setShowRefCodePrompt: (v: boolean) => void
}

// Capture ?ref= param immediately on module load (before wallet connects)
// This still handles legacy links like /?ref=mw_3f9a12
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  if (ref) {
    sessionStorage.setItem('mw_pending_ref', ref)
  }
}

export function useReferral(address: string | undefined): UseReferralReturn {
  const [stats, setStats]                         = useState<ReferralStats | null>(null)
  const [referralRecords, setReferralRecords]     = useState<ReferralRecord[]>([])
  const [refCode, setRefCode]                     = useState<string | null>(null)
  const [isFirstConnect, setIsFirstConnect]       = useState(false)
  const [isLoading, setIsLoading]                 = useState(false)
  const [showRefCodePrompt, setShowRefCodePrompt] = useState(false)
  const initialized                               = useRef(false)

  const supabase = createSupabaseBrowserClient()

  const fetchStats = useCallback(async (addr: string) => {
    const { data, error } = await supabase
      .from('referral_stats')
      .select('*')
      .eq('address', addr)
      .single()
    // PGRST116 = no rows found (not an error if wallet has no stats yet)
    if (error && error.code !== 'PGRST116') {
      console.error('[useReferral] referral_stats error:', error.code, error.message, error.details)
    }
    if (data) setStats(data as ReferralStats)

    const { data: records, error: recErr } = await supabase
      .from('referral_records')
      .select('*')
      .eq('referrer', addr)
      .order('status', { ascending: true })
      .limit(10)
    if (recErr) console.error('[useReferral] referral_records error:', recErr.code, recErr.message, recErr.details)
    if (records) setReferralRecords(records as ReferralRecord[])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const init = useCallback(async (addr: string) => {
    setIsLoading(true)
    try {
      // ── Call /api/auth/connect — generates or retrieves permanent ref code ──
      const connectRes = await fetch('/api/auth/connect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: addr }),
      })

      let storedRefCode: string | null = null
      let isNew = false

      if (connectRes.ok) {
        const connectData = await connectRes.json() as { ref_code: string; is_new: boolean }
        storedRefCode = connectData.ref_code
        isNew         = connectData.is_new
        setRefCode(storedRefCode)
        setIsFirstConnect(isNew)
      } else {
        console.error('[useReferral] connect API error:', connectRes.status)
      }

      // ── Handle pending referral attribution from ?ref= URL param ────────────
      // Covers both new-style (/ref/jake via sessionStorage) and
      // legacy (?ref=mw_3f9a12 captured above on module load)
      const pendingRef    = sessionStorage.getItem('mw_pending_ref')
      let   refWasApplied = false

      if (pendingRef && isNew) {
        try {
          const res = await fetch('/api/referral/apply', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ referred: addr, ref_code: pendingRef }),
          })
          const data = await res.json() as { applied?: boolean; skip_reason?: string }
          if (data.applied) refWasApplied = true
          if (data.skip_reason) {
            console.info('[useReferral] referral not applied:', data.skip_reason)
          }
        } catch (err) {
          console.error('[useReferral] referral/apply error:', err)
        }
        sessionStorage.removeItem('mw_pending_ref')
      }

      // ── If first connect, no URL ref was applied, check if prompt should show ─
      if (isNew && !refWasApplied) {
        const dismissedKey = `mw_ref_dismissed_${addr}`
        const dismissed    = typeof window !== 'undefined' && localStorage.getItem(dismissedKey)

        if (!dismissed) {
          const { data: existingRef } = await supabase
            .from('referral_records')
            .select('referred')
            .eq('referred', addr)
            .maybeSingle()

          if (!existingRef) {
            setShowRefCodePrompt(true)
          }
        }
      }

      // ── Fetch stats for display ──────────────────────────────────────────────
      await fetchStats(addr)
    } finally {
      setIsLoading(false)
    }
  }, [fetchStats]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    console.log('[useReferral] effect fired, address:', address, 'initialized:', initialized.current)
    if (!address || initialized.current) return
    initialized.current = true
    console.log('[useReferral] calling init for', address)
    init(address)

    // Realtime subscription — refetch when referral_records changes for this referrer
    const channel = supabase
      .channel(`referrals:${address}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'referral_records',
          filter: `referrer=eq.${address}`,
        },
        () => fetchStats(address)
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [address, init, fetchStats]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    if (address) fetchStats(address)
  }, [address, fetchStats])

  return {
    stats, referralRecords, refCode, isFirstConnect, isLoading, refetch,
    showRefCodePrompt, setShowRefCodePrompt,
  }
}
