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
import { cleanProfileField, cleanProfileHandle, cleanProfileUrl } from '@/lib/rewards/profileSanitize'
import type { ProfileMeta } from '@/lib/rewards/useProfileMeta'

const LABEL = 'font-atx-mono uppercase tracking-[0.12em] text-[10px] text-atx-ink/55 mb-1.5 block'
const FIELD =
  'w-full bg-atx-bone border border-atx-ink/25 px-3 py-2 text-[13px] font-atx-display text-atx-ink outline-none focus:border-atx-blue transition-colors'

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
        avatarRef:   cleanProfileField(avatarUrl, 300),
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
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-atx-ink/40 backdrop-blur-[3px] py-[6vh] px-4 font-atx-display [&_*]:rounded-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[460px] bg-atx-bone border border-atx-ink" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-atx-ink">
          <span className="font-atx-mono uppercase tracking-[0.12em] text-[12px] text-atx-ink">Edit profile</span>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center border border-atx-ink bg-atx-bone text-atx-ink text-[14px] cursor-pointer hover:bg-atx-ink hover:text-atx-bone transition-colors">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className={LABEL}>Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} placeholder="Your name or handle" className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>Bio <span className="text-atx-ink/35 normal-case tracking-normal">· {bio.length}/200</span></label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={3} placeholder="A line about you." className={`${FIELD} resize-none leading-[1.5]`} />
          </div>
          <div>
            <label className={LABEL}>Avatar image URL</label>
            <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} maxLength={300} placeholder="https://…/avatar.png" className={FIELD} />
            <p className="font-atx-mono text-[10px] text-atx-ink/40 mt-1.5">Paste an image URL. NFT picker coming soon. Leave blank for the default.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>X / Twitter</label>
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Farcaster</label>
              <input value={farcaster} onChange={(e) => setFarcaster(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Telegram</label>
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={40} placeholder="handle" className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Website</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} placeholder="yoursite.xyz" className={FIELD} />
            </div>
          </div>

          {error && <div className="font-atx-mono text-[11px] text-atx-clay border border-atx-clay/40 bg-atx-clay/[0.05] px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2.5 pt-1">
            <button onClick={onClose} className="font-atx-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2.5 border border-atx-ink/30 bg-atx-bone text-atx-ink cursor-pointer hover:border-atx-ink transition-colors">Cancel</button>
            <button onClick={save} disabled={busy} className="ml-auto font-atx-mono text-[12px] uppercase tracking-[0.06em] px-5 py-2.5 border border-atx-blue bg-atx-blue text-white cursor-pointer hover:bg-atx-blue/90 transition-colors disabled:opacity-60">
              {busy ? 'Sign & save…' : 'Sign & save'}
            </button>
          </div>
          <p className="font-atx-mono text-[10px] text-atx-ink/40 -mt-1">You’ll sign a message to prove ownership. No gas, no transaction.</p>
        </div>
      </div>
    </div>
  )
}
