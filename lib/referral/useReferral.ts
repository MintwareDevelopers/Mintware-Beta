'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { generateRefCode } from '@/lib/referral/utils'
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
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  if (ref) {
    sessionStorage.setItem('mw_pending_ref', ref)
  }
}

export function useReferral(address: string | undefined): UseReferralReturn {
  const [stats, setStats]                   = useState<ReferralStats | null>(null)
  const [referralRecords, setReferralRecords] = useState<ReferralRecord[]>([])
  const [isFirstConnect, setIsFirstConnect] = useState(false)
  const [isLoading, setIsLoading]           = useState(false)
  const initialized                         = useRef(false)

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
      const refCode = generateRefCode(addr)

      // 1. Upsert wallet_profiles — detect first connect via count before
      const { count, error: countErr } = await supabase
        .from('wallet_profiles')
        .select('address', { count: 'exact', head: true })
        .eq('address', addr)
      if (countErr) console.error('[useReferral] count error:', countErr)

      const isNew = count === 0
      setIsFirstConnect(isNew)

      const { error: upsertErr } = await supabase.from('wallet_profiles').upsert(
        { address: addr, ref_code: refCode, last_seen_at: new Date().toISOString() },
        { onConflict: 'address' }
      )
      if (upsertErr) console.error('[useReferral] upsert error:', upsertErr)

      // 2. Handle pending referral attribution
      const pendingRef = sessionStorage.getItem('mw_pending_ref')
      if (pendingRef && isNew) {
        // Look up referrer by ref_code
        const { data: referrerProfile } = await supabase
          .from('wallet_profiles')
          .select('address')
          .eq('ref_code', pendingRef)
          .single()

        if (referrerProfile && referrerProfile.address !== addr) {
          await supabase.from('referral_records').upsert(
            {
              referrer: referrerProfile.address,
              referred: addr,
              ref_code: pendingRef,
              status:   'pending',
            },
            { onConflict: 'referred', ignoreDuplicates: true }
          )
        }
        sessionStorage.removeItem('mw_pending_ref')
      }

      // 3. Fetch stats for display
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

  return { stats, referralRecords, isFirstConnect, isLoading, refetch }
}
