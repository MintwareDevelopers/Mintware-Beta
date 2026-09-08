'use client'

// V1EditProfile — the dark, in-app profile editor (so editing never bounces you to the light V2 page).
// Reuses the EXACT proven pipeline: the shared idempotent sanitizers, the signed buildProfileUpdateMessage
// (EIP-191), and POST /api/profile. Only the skin is new.
//
// Avatar: a TRUE file upload (PNG/JPEG/WebP ≤ 2 MB) → POST /api/profile/avatar. The client hashes the bytes
// (sha256), signs `buildProfileAvatarMessage` (wallet + issuedAt + sha256 + size — one signature per exact
// file), streams the multipart body via XHR so we get real upload progress, and drops the returned public
// URL into the URL field so the ordinary "Save profile" signature re-affirms it. The image-URL field stays
// as the fallback for anyone who'd rather link a hosted picture.

import { useEffect, useRef, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { buildProfileUpdateMessage } from '@/lib/web3/signedActionMessages'
import { cleanProfileField, cleanProfileHandle, cleanProfileUrl, cleanProfileImageUrl } from '@/lib/rewards/profileSanitize'
import { AVATAR_ALLOWED_MIMES, AVATAR_MAX_BYTES, buildProfileAvatarMessage, sniffImageMime } from '@/lib/profile/avatarUpload'
import type { ProfileMeta } from '@/lib/rewards/useProfileMeta'

const INPUT = 'w-full rounded-[10px] px-3 py-2.5 text-[13.5px] font-atx-display outline-none transition-colors'
const inputStyle = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.1)', color: '#F4F4FA' } as const
const ACCEPT = AVATAR_ALLOWED_MIMES.join(',')

type UploadState =
  | { phase: 'idle' }
  | { phase: 'hashing' }
  | { phase: 'signing' }
  | { phase: 'uploading'; pct: number }
  | { phase: 'done'; url: string }
  | { phase: 'error'; message: string }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function xhrUpload(form: FormData, onProgress: (pct: number) => void): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/profile/avatar')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onerror = () => reject(new Error('Network error during upload.'))
    xhr.onload = () => {
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* non-JSON error body */ }
      resolve({ status: xhr.status, body })
    }
    xhr.send(form)
  })
}

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

  // ── file upload state ──
  const fileRef = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' })
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview) }, [localPreview])
  const uploading = upload.phase === 'hashing' || upload.phase === 'signing' || upload.phase === 'uploading'

  async function pickFile(file: File | null) {
    if (!file || uploading) return
    setError(null)
    // client-side pre-checks (the server re-derives both from the bytes; these only save a round trip)
    if (file.size > AVATAR_MAX_BYTES) { setUpload({ phase: 'error', message: 'That image is over 2 MB. Pick a smaller one.' }); return }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!sniffImageMime(bytes)) { setUpload({ phase: 'error', message: 'Only PNG, JPEG or WebP images are supported.' }); return }
    if (localPreview) URL.revokeObjectURL(localPreview)
    setLocalPreview(URL.createObjectURL(file))

    try {
      setUpload({ phase: 'hashing' })
      const sha256 = await sha256Hex(bytes)
      const issuedAt = Date.now()
      const authMessage = buildProfileAvatarMessage({ wallet, issuedAt, sha256, size: bytes.length })

      setUpload({ phase: 'signing' })
      let authSignature: `0x${string}`
      try { authSignature = await signMessageAsync({ message: authMessage }) } catch { setUpload({ phase: 'error', message: 'Signature cancelled — your picture was not uploaded.' }); return }

      setUpload({ phase: 'uploading', pct: 0 })
      const form = new FormData()
      form.set('address', wallet)
      form.set('authMessage', authMessage)
      form.set('authSignature', authSignature)
      form.set('issuedAt', String(issuedAt))
      form.set('file', new Blob([bytes], { type: file.type }), file.name || 'avatar')
      const { status, body } = await xhrUpload(form, (pct) => setUpload({ phase: 'uploading', pct }))
      if (status !== 200 || !body?.success || typeof body.url !== 'string') {
        throw new Error(typeof body?.error === 'string' ? body.error : `Upload failed (${status})`)
      }
      setAvatarUrl(body.url)
      setUpload({ phase: 'done', url: body.url })
      onSaved() // the row already carries the new URL — refresh the header immediately
    } catch (e) {
      setUpload({ phase: 'error', message: e instanceof Error ? e.message : 'Upload failed.' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (busy || uploading) return
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

  const shownAvatar = localPreview ?? (avatarUrl || null)
  const statusLine =
    upload.phase === 'hashing' ? 'Preparing image…'
    : upload.phase === 'signing' ? 'Sign to confirm this picture is yours…'
    : upload.phase === 'uploading' ? `Uploading… ${upload.pct}%`
    : upload.phase === 'done' ? 'Uploaded — saved to your profile.'
    : null

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto py-[6vh] px-4 font-atx-display" style={{ background: 'rgba(6,6,12,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[440px] rounded-[18px] p-6" style={{ background: '#12121C', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[18px]">Edit profile</h2>
          <button onClick={onClose} className="text-[18px] cursor-pointer" style={{ color: '#63636F' }} aria-label="Close">×</button>
        </div>

        {/* avatar: picker + preview + progress */}
        <div className="flex items-center gap-4 mt-5">
          <button
            type="button"
            onClick={() => !uploading && fileRef.current?.click()}
            disabled={uploading}
            aria-label="Choose a profile picture"
            className="relative w-[64px] h-[64px] rounded-full overflow-hidden flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-default"
            style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', border: '2px solid rgba(255,255,255,0.1)' }}
          >
            {shownAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownAvatar} alt="" width={64} height={64} style={{ objectFit: 'cover', width: '100%', height: '100%', opacity: uploading ? 0.5 : 1 }} />
            ) : (
              <span className="font-bold text-[22px] text-white">{wallet.charAt(2).toUpperCase()}</span>
            )}
            {upload.phase === 'uploading' && (
              <span className="absolute inset-x-0 bottom-0 h-[4px]" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <span className="block h-full transition-[width]" style={{ width: `${upload.pct}%`, background: '#C9C6FF' }} />
              </span>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <Label>Profile picture</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-[12.5px] font-semibold px-3 py-1.5 rounded-[9px] cursor-pointer disabled:cursor-default"
                style={uploading ? { background: 'rgba(255,255,255,0.06)', color: '#63636F' } : { background: 'rgba(138,130,244,0.14)', color: '#C9C6FF', border: '1px solid rgba(138,130,244,0.25)' }}
              >
                {uploading ? 'Working…' : avatarUrl ? 'Replace image' : 'Upload image'}
              </button>
              <span className="text-[11px]" style={{ color: '#63636F' }}>PNG · JPEG · WebP · up to 2 MB</span>
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
            {statusLine && <div className="text-[12px] mt-1.5" style={{ color: upload.phase === 'done' ? '#7FD6A8' : '#9B9BAD' }}>{statusLine}</div>}
            {upload.phase === 'error' && <div className="text-[12px] mt-1.5" style={{ color: '#F0736E' }}>{upload.message}</div>}
          </div>
        </div>

        <div className="mt-3">
          <Label>Or an image URL</Label>
          <input className={INPUT} style={inputStyle} placeholder="https://…/pfp.png" value={avatarUrl} onChange={(e) => { setAvatarUrl(e.target.value); if (localPreview) { URL.revokeObjectURL(localPreview); setLocalPreview(null) } if (upload.phase === 'done' || upload.phase === 'error') setUpload({ phase: 'idle' }) }} />
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
          <button onClick={save} disabled={busy || uploading} className="flex-1 text-[14px] font-semibold py-3 rounded-[12px] text-white cursor-pointer disabled:cursor-default" style={busy || uploading ? { background: 'rgba(255,255,255,0.08)', color: '#9B9BAD' } : { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>{busy ? 'Sign to save…' : uploading ? 'Finishing upload…' : 'Save profile'}</button>
          <button onClick={onClose} className="text-[14px] font-semibold px-5 py-3 rounded-[12px] cursor-pointer" style={{ color: '#9B9BAD', border: '1px solid rgba(255,255,255,0.12)' }}>Cancel</button>
        </div>
        <div className="text-[11px] mt-3 leading-[1.5]" style={{ color: '#63636F' }}>Saved on-chain-adjacent: you sign a message to prove this wallet is yours — no gas. Uploads are signed per image, so no one can swap your picture.</div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.06em] font-semibold mb-1.5" style={{ color: '#63636F' }}>{children}</div>
}
