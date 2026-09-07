'use client'

// V1EditProfile — the dark, in-app profile editor (so editing never bounces you to the light V2 page).
// Reuses the EXACT proven pipeline: the shared idempotent sanitizers, the signed buildProfileUpdateMessage
// (EIP-191), and POST /api/profile. Only the skin is new. Avatar is an image URL (Slice-6-lite, same as V2);
// true file-upload-to-storage is a separate follow-up.

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { buildProfileUpdateMessage } from '@/lib/web3/signedActionMessages'
import { cleanProfileField, cleanProfileHandle, cleanProfileUrl, cleanProfileImageUrl } from '@/lib/rewards/profileSanitize'
import type { ProfileMeta } from '@/lib/rewards/useProfileMeta'

const INPUT = 'w-full rounded-[10px] px-3 py-2.5 text-[13.5px] font-atx-display outline-none transition-colors'
const inputStyle = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.1)', color: '#F4F4FA' } as const

export function V1EditProfile({ wallet, meta, onClose, onSaved }: { wallet: string; meta: ProfileMeta | null; onClose: () => void; onSaved: () => void }) {
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
        bio: cleanProfileField(bio, 200),
        twitter: cleanProfileHandle(twitter),
        farcaster: cleanProfileHandle(farcaster),
        telegram: cleanProfileHandle(telegram),
        website: cleanProfileUrl(website),
        avatarRef: cleanProfileImageUrl(avatarUrl),
      }
      const avatarType = sanitized.avatarRef ? 'upload' : 'default'
      const authMessage = buildProfileUpdateMessage({ wallet, issuedAt, ...sanitized, avatarType })
      let authSignature: `0x${string}`
      try { authSignature = await signMessageAsync({ message: authMessage }) } catch { setError('Signature cancelled.'); setBusy(false); return }
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, ...sanitized, avatarType, authMessage, authSignature, issuedAt }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? `Save failed (${res.status})`) }
      onSaved(); onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto py-[6vh] px-4 font-atx-display" style={{ background: 'rgba(6,6,12,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[440px] rounded-[18px] p-6" style={{ background: '#12121C', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[18px]">Edit profile</h2>
          <button onClick={onClose} className="text-[18px] cursor-pointer" style={{ color: '#63636F' }} aria-label="Close">×</button>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <span className="w-[52px] h-[52px] rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" width={52} height={52} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
            ) : (
              <span className="font-bold text-[20px] text-white">{wallet.charAt(2).toUpperCase()}</span>
            )}
          </span>
          <div className="flex-1 min-w-0">
            <Label>Avatar image URL</Label>
            <input className={INPUT} style={inputStyle} placeholder="https://…/pfp.png" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
          </div>
        </div>

        <div className="mt-4"><Label>Display name</Label><input className={INPUT} style={inputStyle} placeholder="Your name" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
        <div className="mt-3"><Label>Bio</Label><textarea className={INPUT} style={{ ...inputStyle, resize: 'none', height: 64 }} placeholder="A line about you" maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} /></div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><Label>X / Twitter</Label><input className={INPUT} style={inputStyle} placeholder="handle" value={twitter} onChange={(e) => setTwitter(e.target.value)} /></div>
          <div><Label>Farcaster</Label><input className={INPUT} style={inputStyle} placeholder="handle" value={farcaster} onChange={(e) => setFarcaster(e.target.value)} /></div>
          <div><Label>Telegram</Label><input className={INPUT} style={inputStyle} placeholder="handle" value={telegram} onChange={(e) => setTelegram(e.target.value)} /></div>
          <div><Label>Website</Label><input className={INPUT} style={inputStyle} placeholder="you.xyz" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
        </div>

        {error && <div className="text-[12.5px] mt-3" style={{ color: '#F0736E' }}>{error}</div>}

        <div className="flex gap-2.5 mt-5">
          <button onClick={save} disabled={busy} className="flex-1 text-[14px] font-semibold py-3 rounded-[12px] text-white cursor-pointer disabled:cursor-default" style={busy ? { background: 'rgba(255,255,255,0.08)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>{busy ? 'Sign to save…' : 'Save profile'}</button>
          <button onClick={onClose} className="text-[14px] font-semibold px-5 py-3 rounded-[12px] cursor-pointer" style={{ color: '#9B9BAD', border: '1px solid rgba(255,255,255,0.12)' }}>Cancel</button>
        </div>
        <div className="text-[11px] mt-3 leading-[1.5]" style={{ color: '#63636F' }}>Saved on-chain-adjacent: you sign a message to prove this wallet is yours — no gas.</div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.06em] font-semibold mb-1.5" style={{ color: '#63636F' }}>{children}</div>
}
