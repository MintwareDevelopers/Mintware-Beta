import { describe, it, expect } from 'vitest'
import {
  AVATAR_MAX_BYTES, avatarObjectPath, avatarPathFromPublicUrl, buildProfileAvatarMessage, sniffImageMime, validateAvatarBytes,
} from './avatarUpload'

const png = (n = 64) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b }
const jpeg = (n = 64) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b }
const webp = (n = 64) => { const b = new Uint8Array(n); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b }

describe('sniffImageMime — magic bytes, never the declared type', () => {
  it('detects png / jpeg / webp', () => {
    expect(sniffImageMime(png())).toBe('image/png')
    expect(sniffImageMime(jpeg())).toBe('image/jpeg')
    expect(sniffImageMime(webp())).toBe('image/webp')
  })
  it('rejects svg / gif / html / too-short', () => {
    expect(sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffImageMime(new TextEncoder().encode('GIF89a' + ' '.repeat(20)))).toBeNull()
    expect(sniffImageMime(new TextEncoder().encode('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull()
  })
  it('RIFF without WEBP tag (e.g. WAV) is not webp', () => {
    const b = webp(); b.set([0x57, 0x41, 0x56, 0x45], 8) // "WAVE"
    expect(sniffImageMime(b)).toBeNull()
  })
})

describe('validateAvatarBytes', () => {
  it('accepts a small png with the right ext', () => {
    expect(validateAvatarBytes(png())).toEqual({ ok: true, mime: 'image/png', ext: 'png', size: 64 })
  })
  it('rejects empty, oversized, and unsupported', () => {
    expect(validateAvatarBytes(new Uint8Array(0))).toEqual({ ok: false, error: 'empty' })
    expect(validateAvatarBytes(png(AVATAR_MAX_BYTES + 1))).toEqual({ ok: false, error: 'too_large' })
    expect(validateAvatarBytes(new TextEncoder().encode('not an image at all, really'))).toEqual({ ok: false, error: 'unsupported_type' })
  })
  it('accepts exactly the max size', () => {
    expect(validateAvatarBytes(png(AVATAR_MAX_BYTES)).ok).toBe(true)
  })
})

describe('buildProfileAvatarMessage — canonical, content-bound', () => {
  it('lowercases wallet + hash and embeds action/issuedAt/size', () => {
    const m = buildProfileAvatarMessage({ wallet: '0xABCDEF0000000000000000000000000000000001', issuedAt: 123, sha256: 'ABC', size: 9 })
    expect(JSON.parse(m)).toEqual({ action: 'mintware-profile-avatar', wallet: '0xabcdef0000000000000000000000000000000001', issuedAt: 123, sha256: 'abc', size: 9 })
  })
  it('a different file (hash or size) yields a different message', () => {
    const a = buildProfileAvatarMessage({ wallet: '0x1', issuedAt: 1, sha256: 'aa', size: 1 })
    expect(buildProfileAvatarMessage({ wallet: '0x1', issuedAt: 1, sha256: 'bb', size: 1 })).not.toBe(a)
    expect(buildProfileAvatarMessage({ wallet: '0x1', issuedAt: 1, sha256: 'aa', size: 2 })).not.toBe(a)
  })
})

describe('object paths + public-url parsing', () => {
  const W = '0x' + 'a'.repeat(40)
  const U = '11111111-2222-3333-4444-555555555555'
  it('builds <wallet>/<uuid>.<ext>', () => {
    expect(avatarObjectPath(W.toUpperCase(), U, 'png')).toBe(`${W}/${U}.png`)
  })
  it('recognises only our bucket URLs with a well-formed path', () => {
    const base = 'https://proj.supabase.co'
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/avatars/${W}/${U}.webp`, base)).toBe(`${W}/${U}.webp`)
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/avatars/${W}/${U}.webp?x=1`, `${base}/`)).toBe(`${W}/${U}.webp`)
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/other/${W}/${U}.webp`, base)).toBeNull()
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/avatars/../${U}.webp`, base)).toBeNull()
    expect(avatarPathFromPublicUrl('https://evil.example/storage/v1/object/public/avatars/x', base)).toBeNull()
    expect(avatarPathFromPublicUrl(null, base)).toBeNull()
    expect(avatarPathFromPublicUrl(`${base}/x`, undefined)).toBeNull()
  })
})
