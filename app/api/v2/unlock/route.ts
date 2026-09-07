import { NextResponse } from 'next/server'
import { V2_PASSWORD, V2_COOKIE, v2Token } from '@/lib/v2/gate'

export const dynamic = 'force-dynamic'

// Investor unlock for the V2 vision. Validates the password server-side and sets an http-only cookie
// holding the derived token. Fail-closed: 503 while V2_PASSWORD is unset.
export async function POST(req: Request) {
  if (!V2_PASSWORD) return NextResponse.json({ ok: false, error: 'gate_not_configured' }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { password?: string }
  if (String(body.password ?? '') !== V2_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'wrong_password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(V2_COOKIE, v2Token(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}

// Lock back to V1 (clear the cookie).
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(V2_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
