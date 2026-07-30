'use client'

// Profile 2.0 · Slice 3 — client hook to read custom identity from /api/profile.
// Public (no auth). Returns null while absent/loading; never throws.

import { useEffect, useState } from 'react'

export interface ProfileSocials {
  twitter:   string | null
  farcaster: string | null
  telegram:  string | null
  website:   string | null
}
export interface ProfileMeta {
  address:        string
  name:           string | null   // display_name -> basename -> null (client shortens address)
  displayName:    string | null
  basename:       string | null
  bio:            string | null
  avatar:         { type: string; ref: string | null }
  socials:        ProfileSocials
  attestationUid: string | null
}

export function useProfileMeta(address?: string | null): { meta: ProfileMeta | null; loading: boolean } {
  const [meta, setMeta] = useState<ProfileMeta | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) { setMeta(null); return }
    let alive = true
    setLoading(true)
    fetch(`/api/profile?address=${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setMeta(d ? {
          address:        d.address ?? address.toLowerCase(),
          name:           d.name ?? null,
          displayName:    d.display_name ?? null,
          basename:       d.basename ?? null,
          bio:            d.bio ?? null,
          avatar:         d.avatar ?? { type: 'default', ref: null },
          socials:        d.socials ?? { twitter: null, farcaster: null, telegram: null, website: null },
          attestationUid: d.attestationUid ?? null,
        } : null)
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [address])

  return { meta, loading }
}
