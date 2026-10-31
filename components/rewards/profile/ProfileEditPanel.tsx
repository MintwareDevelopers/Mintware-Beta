'use client'

// Profile 2.0 · Slice 4 — owner-only identity editor.
// Collects name / bio / avatar-URL / socials, sanitizes with the SAME shared
// functions the server uses, builds + signs buildProfileUpdateMessage (EIP-191),
// and POSTs to /api/profile. On success, refetches via onSaved().
//
// Avatar (Slice 6-lite): an image-URL field → avatarType 'upload'. The full NFT
// gallery picker is a fast-follow (needs an NFT-metadata API key).

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { buildProfileUpdateMessage } from '@/lib/web3/signedActionMessages'
import { cleanProfileField, cleanProfileHandle, cleanProfileUrl, cleanProfileImageUrl } from '@/lib/rewards/profileSanitize'
import type { ProfileMeta } from '@/lib/rewards/useProfileMeta'

// Mineral: fields are inset wells; the one action (Sign & save) is the solid button.
const LABEL = 'text-[13px] font-medium text-ink-mid mb-1.5 block'
const FIELD =
  'w-full rounded-[12px] border-0 px-3.5 min-h-[44px] py-2.5 text-[14.5px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)] placeholder:text-ink-soft'
const WELL = { background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }

export function ProfileEditPanel({
  wallet,
  meta,
  onClose,
  onSaved,
}: {
  wallet: string
  meta: ProfileMeta | null
  onClose: () => void
  onSaved: () => void
}) {
  const { signMessageAsync } = useSignMessage()
  const [displayName, setDisplayName] = useState(meta?.displayName ?? '')
  const [bio, setBio] = useState(meta?.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState(meta?.avatar?.type === 'upload' ? (meta?.avatar?.ref ?? '') : '')
  const [twitter, setTwitter] = useState(meta?.socials?.twitter ?? '')
  const [farcaster, setFarcaster] = useState(meta?.socials?.farcaster ?? '')
  const [telegram, setTelegram] = useState(meta?.socials?.telegram ?? '')
  const [website, setWebsite] = useState(meta?.socials?.website ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const issuedAt = Date.now()
      const sanitized = {
        displayName: cleanProfileField(displayName, 40),
        bio:         cleanProfileField(bio, 200),
        twitter:     cleanProfileHandle(twitter),
        farcaster:   cleanProfileHandle(farcaster),
        telegram:    cleanProfileHandle(telegram),
        website:     cleanProfileUrl(website),
        avatarRef:   cleanProfileImageUrl(avatarUrl),
      }
      const avatarType = sanitized.avatarRef ? 'upload' : 'default'
      const authMessage = buildProfileUpdateMessage({ wallet, issuedAt, ...sanitized, avatarType })

      let authSignature: `0x${string}`
      try {
        authSignature = await signMessageAsync({ message: authMessage })
      } catch { setError('Signature cancelled.'); setBusy(false); return }

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, ...sanitized, avatarType, authMessage, authSignature, issuedAt }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.error ?? `Save failed (${res.status})`)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-[rgba(21,21,29,.32)] backdrop-blur-[4px] py-[6vh] px-4 font-geist"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="mw-raise-lg w-full max-w-[480px] rounded-[26px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <span className="text-[19px] font-semibold tracking-[-0.02em]">Edit profile</span>
          <button onClick={onClose} aria-label="Close" className="mw-btn-quiet !w-9 !h-9 !min-h-0 !px-0 !text-ink-mid">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div>
            <label className={LABEL}>Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} placeholder="Your name or handle" className={FIELD} style={WELL} />
          </div>
          <div>
            <label className={LABEL}>Bio <span className="text-ink-soft font-geist-mono text-[12px]">· {bio.length}/200</span></label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={3} placeholder="A line about you." className={`${FIELD} resize-none leading-[1.5]`} style={WELL} />
          </div>
          <div>
            <label className={LABEL}>Avatar image URL</label>
            <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} maxLength={300} placeholder="https://…/avatar.png" className={FIELD} style={WELL} />
            <p className="text-[12.5px] text-ink-soft mt-1.5 mb-0">Paste an image URL. NFT picker coming soon. Leave blank for the default.</p>
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>X / Twitter</label>
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} style={WELL} />
            </div>
            <div>
              <label className={LABEL}>Farcaster</label>
              <input value={farcaster} onChange={(e) => setFarcaster(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} style={WELL} />
            </div>
            <div>
              <label className={LABEL}>Telegram</label>
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} style={WELL} />
            </div>
            <div>
              <label className={LABEL}>Website</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} placeholder="yoursite.xyz" className={FIELD} style={WELL} />
            </div>
          </div>

          {error && <div role="alert" className="text-[13px] text-[#B42318] rounded-[12px] px-3.5 py-2.5" style={{ background: '#FDF1EF', boxShadow: 'inset 0 0 0 1px rgba(180,35,24,.18)' }}>{error}</div>}

          <div className="flex items-center gap-2.5 pt-1">
            <button onClick={onClose} className="mw-btn-quiet">Cancel</button>
            <button onClick={save} disabled={busy} className="ml-auto mw-btn disabled:opacity-60">
              {busy ? 'Waiting for signature…' : 'Sign & save'}
            </button>
          </div>
          <p className="text-[12.5px] text-ink-soft -mt-1 mb-0">You’ll sign a message to prove ownership. No gas, no transaction.</p>
        </div>
      </div>
    </div>
  )
}
