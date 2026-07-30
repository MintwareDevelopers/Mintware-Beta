'use client'

// Profile 2.0 · Slice 5 — EAS attestation badge.
// If the wallet has an AttributionScore attestation, show a chip linking to
// EASScan. If not and the viewer owns the profile, offer a one-click "Verify
// on-chain" that signs an offchain attestation (GET /api/eas/attest-score) and
// refetches. Reads meta.attestationUid (merged from eas_attestations in the API).

import { useState } from 'react'

const EAS_CHAIN_ID = process.env.NEXT_PUBLIC_EAS_CHAIN_ID ?? '8453'
const EAS_BASE = EAS_CHAIN_ID === '84532' ? 'https://base-sepolia.easscan.org' : 'https://base.easscan.org'
const easUrl = (uid: string) => `${EAS_BASE}/offchain/attestation/view/${uid}`

export function AttestationBadge({
  attestationUid,
  address,
  isOwner,
  onAttested,
}: {
  attestationUid: string | null
  address?: string | null
  isOwner: boolean
  onAttested?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  if (attestationUid) {
    return (
      <a
        href={easUrl(attestationUid)}
        target="_blank"
        rel="noopener noreferrer"
        title="View the on-chain Attribution attestation on EASScan"
        className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border border-atx-mesquite text-atx-mesquite bg-atx-mesquite/[0.06] font-atx-mono no-underline hover:bg-atx-mesquite/[0.12] transition-colors"
      >
        ✦ Attested ↗
      </a>
    )
  }

  if (!isOwner) return null

  async function verify() {
    if (!address || busy) return
    setBusy(true); setErr(false)
    try {
      const res = await fetch(`/api/eas/attest-score?address=${address}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (!d?.uid) throw new Error('no uid')
      onAttested?.()
    } catch { setErr(true) } finally { setBusy(false) }
  }

  return (
    <button
      onClick={verify}
      disabled={busy}
      title="Sign an on-chain attestation of your Attribution score"
      className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border border-atx-blue text-atx-blue bg-atx-blue/[0.06] font-atx-mono cursor-pointer hover:bg-atx-blue/[0.12] transition-colors disabled:opacity-60"
    >
      {busy ? 'Attesting…' : err ? 'Retry verify' : '✦ Verify on-chain'}
    </button>
  )
}
