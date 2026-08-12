'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/web2/supabase'
import type { ReferralStats, ReferralRecord } from '@/lib/rewards/referral/types'
import { useSignMessage } from 'wagmi'
import { buildReferralApplyMessage, buildWalletConnectMessage } from '@/lib/web3/signedActionMessages'

type ConnectResult = {
  refCode: string | null
  isNew: boolean
  refWasApplied: boolean
}

const connectInFlight = new Map<string, Promise<ConnectResult>>()

// Supabase Realtime live-updates the referral tree, but it requires Realtime to be
// enabled on the project AND `referral_records` added to the publication. It's off
// server-side today, so opening the socket just fails and spams the browser console
// (the WS error can't be caught/suppressed in JS). Gated off by default — set
// NEXT_PUBLIC_SUPABASE_REALTIME=1 once Realtime is enabled to restore live updates.
const REALTIME_ENABLED = process.env.NEXT_PUBLIC_SUPABASE_REALTIME === '1'

function connectSessionKey(address: string) {
  return `mw_connect_verified_${address.toLowerCase()}`
}

function refCodeSessionKey(address: string) {
  return `mw_ref_code_${address.toLowerCase()}`
}

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
  const { signMessageAsync } = useSignMessage()
  const [stats, setStats]                         = useState<ReferralStats | null>(null)
  const [referralRecords, setReferralRecords]     = useState<ReferralRecord[]>([])
  const [refCode, setRefCode]                     = useState<string | null>(null)
  const [isFirstConnect, setIsFirstConnect]       = useState(false)
  const [isLoading, setIsLoading]                 = useState(false)
  const [showRefCodePrompt, setShowRefCodePrompt] = useState(false)
  const initialized                               = useRef(false)

  // useRef ensures the same client instance is used across renders.
  // createSupabaseBrowserClient() creates a new object on every call — a ref
  // prevents stale-closure issues in fetchStats/init useCallbacks.
  const supabaseRef = useRef(createSupabaseBrowserClient())
  const supabase    = supabaseRef.current

  const persistConnectSession = useCallback((addr: string, refCodeValue: string | null) => {
    if (typeof window === 'undefined') return
    // localStorage persists across tabs and browser sessions — prevents
    // re-prompting when the user opens a new tab or returns after closing the browser.
    try {
      localStorage.setItem(connectSessionKey(addr), '1')
      if (refCodeValue) {
        localStorage.setItem(refCodeSessionKey(addr), refCodeValue)
      }
    } catch { /* localStorage blocked in some private/hardened browsers */ }
  }, [])

  const loadCachedConnectSession = useCallback((addr: string): ConnectResult | null => {
    if (typeof window === 'undefined') return null
    try {
      const verified = localStorage.getItem(connectSessionKey(addr))
      if (!verified) return null
      return {
        refCode: localStorage.getItem(refCodeSessionKey(addr)),
        isNew: false,
        refWasApplied: false,
      }
    } catch {
      return null
    }
  }, [])

  const runConnectFlow = useCallback(async (addr: string): Promise<ConnectResult> => {
    const cached = loadCachedConnectSession(addr)
    if (cached) return cached

    const existing = connectInFlight.get(addr)
    if (existing) return existing

    const task = (async () => {
      let storedRefCode: string | null = null
      let isNew = false

      try {
        const issuedAt = Date.now()
        const authMessage = buildWalletConnectMessage({ address: addr, issuedAt })
        const authSignature = await signMessageAsync({ message: authMessage })
        const connectRes = await fetch('/api/auth/connect', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ address: addr, issuedAt, authMessage, authSignature }),
        })

        if (connectRes.ok) {
          const connectData = await connectRes.json() as { ref_code: string; is_new: boolean }
          storedRefCode = connectData.ref_code
          isNew         = connectData.is_new
        } else {
          console.error('[useReferral] connect API error:', connectRes.status)
          // API failed — fall back to deterministic ref code so profile still works
          storedRefCode = 'mw_' + addr.slice(2, 8).toLowerCase()
        }
      } catch {
        // User rejected the sign request (WalletConnect dismiss, Privy cancel, etc.)
        // Fall back to the deterministic ref code and persist the cache so we don't
        // prompt again. The wallet profile upsert will happen next time they sign.
        console.warn('[useReferral] connect sign rejected, using deterministic ref code')
        storedRefCode = 'mw_' + addr.slice(2, 8).toLowerCase()
      }

      let refWasApplied = false
      const pendingRef = typeof window !== 'undefined'
        ? sessionStorage.getItem('mw_pending_ref')
        : null

      if (pendingRef) {
        try {
          const referralIssuedAt = Date.now()
          const referralAuthMessage = buildReferralApplyMessage({
            referred: addr,
            refCode: pendingRef,
            issuedAt: referralIssuedAt,
          })
          const referralAuthSignature = await signMessageAsync({ message: referralAuthMessage })

          const res = await fetch('/api/referral/apply', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              referred: addr,
              ref_code: pendingRef,
              issuedAt: referralIssuedAt,
              authMessage: referralAuthMessage,
              authSignature: referralAuthSignature,
            }),
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

      persistConnectSession(addr, storedRefCode)
      return { refCode: storedRefCode, isNew, refWasApplied }
    })()

    connectInFlight.set(addr, task)

    try {
      return await task
    } finally {
      connectInFlight.delete(addr)
    }
  }, [loadCachedConnectSession, persistConnectSession, signMessageAsync])

  // Reads go through the server route (service-role): the browser anon key
  // cannot read referral_stats / referral_records client-side. Returns the
  // parsed payload so init() can reuse referred_by for the prompt check.
  const fetchStats = useCallback(async (addr: string) => {
    try {
      const res = await fetch(`/api/referral?address=${addr}`)
      if (!res.ok) return null
      const data = await res.json() as ReferralStats & { records?: ReferralRecord[]; referred_by?: string | null }
      setStats(data)
      setReferralRecords(data.records ?? [])
      return data
    } catch (err) {
      console.error('[useReferral] stats fetch error:', err)
      return null
    }
  }, [])

  const init = useCallback(async (addr: string) => {
    setIsLoading(true)
    try {
      const { refCode: storedRefCode, isNew, refWasApplied } = await runConnectFlow(addr)
      setRefCode(storedRefCode)
      setIsFirstConnect(isNew)

      // ── Fetch stats for display (also gives us referred_by for the prompt) ──
      const data = await fetchStats(addr)

      // ── If first connect, no URL ref was applied, and nobody referred them,
      //    offer the manual ref-code prompt ────────────────────────────────────
      if (isNew && !refWasApplied) {
        const dismissedKey = `mw_ref_dismissed_${addr}`
        const dismissed    = typeof window !== 'undefined' && localStorage.getItem(dismissedKey)
        if (!dismissed && !data?.referred_by) {
          setShowRefCodePrompt(true)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [fetchStats, runConnectFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!address || initialized.current) return
    initialized.current = true
    init(address)

    // Realtime subscription — refetch when referral_records changes for this referrer.
    // Skipped unless explicitly enabled (see REALTIME_ENABLED) so we don't open a
    // WebSocket that fails and spams the console when Realtime is off server-side.
    if (!REALTIME_ENABLED) return

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
