import { NextResponse, type NextRequest } from 'next/server'
import { DATAROOM_PASSWORD, DATAROOM_COOKIE, dataroomToken } from '@/lib/deck/gate'

// Server-side gate for the investor data room: validate the password against DATAROOM_PASSWORD
// and, on success, set an http-only cookie holding the derived token. The data-room HTML is never
// sent to a caller without a valid cookie (the /dataroom server component checks it). Fail-closed
// if unset. Separate from the /deck gate — its own password and cookie.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!DATAROOM_PASSWORD) return NextResponse.json({ ok: false, error: 'gate_not_configured' }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { password?: string }
  if (String(body.password ?? '') !== DATAROOM_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'wrong_password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(DATAROOM_COOKIE, dataroomToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
