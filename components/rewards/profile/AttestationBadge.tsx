'use client'

// Profile 2.0 · Slice 5 — EAS attestation badge (honesty pass).
//
// The score is signed as a GASLESS EAS *offchain* attestation by the Mintware
// oracle (lib/rewards/eas.ts → signOffchainAttestation). It is a real EIP-712
// attestation, but it is NOT written on-chain and is NOT indexed by EASScan, so
// we do NOT link there (a bare offchain UID 404s on EASScan). The badge is an
// honest "attested" signal; the copy says "attested", not "on-chain".
//
// TODO(follow-up): to restore a clickable public proof, store the full signed
// attestation package and build EASScan's offchain share URL
// (base.easscan.org/offchain/url/#attestation=<compressed-package>), or serve a
// self-hosted /attestation/[uid] verification view.

import { useState } from 'react'

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

  // Already attested → honest, non-clickable chip.
  if (attestationUid) {
    return (
      <span
        title="This Attribution score is cryptographically attested by the Mintware oracle — a gasless EAS (offchain) signature."
        className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border border-atx-mesquite text-atx-mesquite bg-atx-mesquite/[0.06] font-atx-mono"
      >
        ✦ Score attested
      </span>
    )
  }

  if (!isOwner) return null

  async function attest() {
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
      onClick={attest}
      disabled={busy}
      title="Sign a gasless EAS attestation of your Attribution score — no transaction, no gas."
      className="inline-flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-semibold border border-atx-blue text-atx-blue bg-atx-blue/[0.06] font-atx-mono cursor-pointer hover:bg-atx-blue/[0.12] transition-colors disabled:opacity-60"
    >
      {busy ? 'Attesting…' : err ? 'Retry' : '✦ Attest my score'}
    </button>
  )
}
