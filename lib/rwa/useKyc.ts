'use client'

// useKyc — reads GET /api/kyc/status for the connected wallet so RWA surfaces can gate the
// "trade vRWA" action on real verification state (WS1, three-role trader gate). On-chain
// SPVBeneficiaryRegistry is the true gate; this is a UX read so a Reg D trader sees a
// verification-required state instead of bouncing off an on-chain revert.

import { useEffect, useState } from 'react'

export interface KycState {
  loading: boolean
  verified: boolean
  status: string   // none | pending | verified | declined | revoked
  onchain: string  // none | pending | written | failed | skipped
}

const IDLE: KycState = { loading: false, verified: false, status: 'none', onchain: 'none' }

export function useKyc(address?: string): KycState {
  const [state, setState] = useState<KycState>(address ? { ...IDLE, loading: true } : IDLE)

  useEffect(() => {
    if (!address) { setState(IDLE); return }
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fetch(`/api/kyc/status?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setState({ loading: false, verified: !!d.verified, status: d.status ?? 'none', onchain: d.onchain ?? 'none' })
      })
      .catch(() => { if (alive) setState(IDLE) })
    return () => { alive = false }
  }, [address])

  return state
}
