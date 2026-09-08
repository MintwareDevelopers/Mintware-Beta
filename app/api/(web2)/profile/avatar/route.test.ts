import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createHash } from 'node:crypto'
import { buildProfileAvatarMessage } from '@/lib/profile/avatarUpload'

// ── fake storage + profile table ──
const upload = vi.fn()
const remove = vi.fn(async (_paths: string[]) => ({ data: null, error: null }))
let EXISTING: { address: string; avatar_ref: string | null } | null = null
const update = vi.fn()
const insert = vi.fn()
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
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: EXISTING, error: null }),
        update: (fields: unknown) => { update(fields); return { eq: async () => ({ error: null }) } },
        insert: async (row: unknown) => { insert(row); return { error: null } },
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/rewards/referral-code', () => ({ generateRefCodeForWallet: async () => 'mw_test' }))

import { POST } from '@/app/api/(web2)/profile/avatar/route'

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const other = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')
const WALLET = owner.address.toLowerCase()

const png = (n = 128) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b }
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function post(opts: {
  bytes: Uint8Array
  account?: typeof owner
  address?: string
  issuedAt?: number
  message?: string
  declaredType?: string
  omitFile?: boolean
  sigOverride?: string
  contentLength?: string
}) {
  const account = opts.account ?? owner
  const address = opts.address ?? account.address
  const issuedAt = opts.issuedAt ?? Date.now()
  const authMessage = opts.message ?? buildProfileAvatarMessage({ wallet: address, issuedAt, sha256: sha(opts.bytes), size: opts.bytes.length })
  const authSignature = opts.sigOverride ?? (await account.signMessage({ message: authMessage }))
  const form = new FormData()
  form.set('address', address)
  form.set('authMessage', authMessage)
  form.set('authSignature', authSignature)
  form.set('issuedAt', String(issuedAt))
  if (!opts.omitFile) form.set('file', new Blob([opts.bytes as BlobPart], { type: opts.declaredType ?? 'image/png' }), 'pfp.png')
  const headers = new Headers()
  if (opts.contentLength) headers.set('content-length', opts.contentLength)
  return POST(new NextRequest('http://localhost/api/profile/avatar', { method: 'POST', body: form, headers }))
}

describe('POST /api/profile/avatar', () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ data: { path: 'x' }, error: null })
    remove.mockClear(); update.mockClear(); insert.mockClear()
    EXISTING = { address: WALLET, avatar_ref: null }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  })

  it('uploads a valid signed png, writes the profile row, returns the public URL', async () => {
    const res = await post({ bytes: png() })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.mime).toBe('image/png')
    expect(body.url).toMatch(new RegExp(`^https://proj\\.supabase\\.co/storage/v1/object/public/avatars/${WALLET}/[0-9a-f-]{36}\\.png$`))
    expect(upload).toHaveBeenCalledTimes(1)
    const [bucket, path, , opts] = upload.mock.calls[0] as [string, string, unknown, { contentType: string; upsert: boolean }]
    expect(bucket).toBe('avatars')
    expect(path.startsWith(`${WALLET}/`)).toBe(true)
    expect(opts).toMatchObject({ contentType: 'image/png', upsert: false })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ avatar_type: 'upload', avatar_ref: body.url }))
    expect(insert).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('creates the profile row when absent', async () => {
    EXISTING = null
    const res = await post({ bytes: png() })
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ address: WALLET, ref_code: 'mw_test', avatar_type: 'upload' }))
  })

  it('removes the replaced object when the previous avatar was ours (and this wallet\'s)', async () => {
    const oldPath = `${WALLET}/11111111-2222-3333-4444-555555555555.png`
    EXISTING = { address: WALLET, avatar_ref: `https://proj.supabase.co/storage/v1/object/public/avatars/${oldPath}` }
    await post({ bytes: png() })
    expect(remove).toHaveBeenCalledWith([oldPath])
  })

  it('never removes a foreign or external previous avatar', async () => {
    EXISTING = { address: WALLET, avatar_ref: 'https://example.com/pfp.png' }
    await post({ bytes: png() })
    expect(remove).not.toHaveBeenCalled()
    EXISTING = { address: WALLET, avatar_ref: `https://proj.supabase.co/storage/v1/object/public/avatars/${other.address.toLowerCase()}/11111111-2222-3333-4444-555555555555.png` }
    await post({ bytes: png() })
    expect(remove).not.toHaveBeenCalled()
  })

  // ── MIME / size ──
  it('415s a non-image even when the declared content-type says png (magic bytes win)', async () => {
    const res = await post({ bytes: new TextEncoder().encode('<svg onload="alert(1)"></svg>'.padEnd(64, ' ')), declaredType: 'image/png' })
    expect(res.status).toBe(415)
    expect((await res.json()).code).toBe('UNSUPPORTED_TYPE')
    expect(upload).not.toHaveBeenCalled()
  })
  it('413s an oversized image (> 2 MB) before touching storage', async () => {
    const res = await post({ bytes: png(2 * 1024 * 1024 + 1) })
    expect(res.status).toBe(413)
    expect(upload).not.toHaveBeenCalled()
  })
  it('413s early on an oversized Content-Length without reading the body', async () => {
    const res = await post({ bytes: png(), contentLength: String(3 * 1024 * 1024) })
    expect(res.status).toBe(413)
  })
  it('400s when the file is missing', async () => {
    const res = await post({ bytes: png(), omitFile: true })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('FILE_REQUIRED')
  })
  it('400s a non-multipart body', async () => {
    const res = await POST(new NextRequest('http://localhost/api/profile/avatar', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(400)
  })

  // ── auth ──
  it('401s when the signer is not the claimed wallet', async () => {
    const bytes = png()
    const issuedAt = Date.now()
    const message = buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(bytes), size: bytes.length })
    const res = await post({ bytes, address: owner.address, issuedAt, message, sigOverride: await other.signMessage({ message }) })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('INVALID_SIG')
    expect(upload).not.toHaveBeenCalled()
  })
  it('401s when the signed hash does not match the uploaded bytes (content binding)', async () => {
    const signedFor = png()
    const swapped = png(); swapped[20] = 0x42
    const issuedAt = Date.now()
    const message = buildProfileAvatarMessage({ wallet: owner.address, issuedAt, sha256: sha(signedFor), size: signedFor.length })
    const res = await post({ bytes: swapped, issuedAt, message })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('AUTH_MISMATCH')
  })
  it('401s an expired authorization (issuedAt older than 15 min)', async () => {
    const res = await post({ bytes: png(), issuedAt: Date.now() - 16 * 60 * 1000 })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('AUTH_EXPIRED')
  })
  it('401s a signature for a different action (cross-route replay)', async () => {
    const bytes = png()
    const issuedAt = Date.now()
    const message = JSON.stringify({ action: 'mintware-profile-update', wallet: WALLET, issuedAt, sha256: sha(bytes), size: bytes.length }, null, 2)
    const res = await post({ bytes, issuedAt, message })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('AUTH_MISMATCH')
  })
  it('401s a malformed signed message and a missing envelope', async () => {
    const res = await post({ bytes: png(), message: 'not json', sigOverride: '0x' + 'ab'.repeat(65) })
    expect(res.status).toBe(401)
    const form = new FormData(); form.set('address', WALLET); form.set('file', new Blob([png()]), 'a.png')
    const res2 = await POST(new NextRequest('http://localhost/api/profile/avatar', { method: 'POST', body: form }))
    expect(res2.status).toBe(401)
    expect((await res2.json()).code).toBe('AUTH_REQUIRED')
  })
  it('400s an invalid address', async () => {
    const res = await post({ bytes: png(), address: '0x123' })
    expect(res.status).toBe(400)
  })

  // ── storage failure ──
  it('502s when storage rejects the upload; the profile row is untouched', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'bucket missing' } })
    const res = await post({ bytes: png() })
    expect(res.status).toBe(502)
    expect(update).not.toHaveBeenCalled()
  })
})
