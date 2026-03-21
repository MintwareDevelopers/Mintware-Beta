'use client'

// =============================================================================
// /ref/[code] — Referral landing page
//
// Captures the ref code into sessionStorage, then redirects to /.
// Handles both Basename-style codes ("jake") and legacy ("mw_3f9a12").
//
// Also supports legacy /?ref= links via the module-level capture in
// useReferral.ts — this page is only for the new /ref/{code} format.
// =============================================================================

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function RefLandingPage() {
  const params = useParams()
  const router = useRouter()
  const code   = params?.code

  useEffect(() => {
    if (typeof code === 'string' && code.length > 0) {
      try {
        sessionStorage.setItem('mw_pending_ref', code)
      } catch {
        // sessionStorage blocked (e.g. private browsing strict mode) — degrade silently
      }
    }
    router.replace('/')
  }, [code, router])

  // Brief blank while redirect fires — no flash of content needed
  return null
}
