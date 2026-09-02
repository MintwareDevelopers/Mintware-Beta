import { NextResponse, type NextRequest } from 'next/server'
import { DECK_PASSWORD, DECK_COOKIE, deckToken } from '@/lib/deck/gate'

// Server-side gate: validate the password against DECK_PASSWORD and, on success, set an
// http-only cookie holding the derived token. The deck HTML is never sent to a caller
// without a valid cookie (the /deck server component checks it). Fail-closed if unset.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!DECK_PASSWORD) return NextResponse.json({ ok: false, error: 'gate_not_configured' }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { password?: string }
  if (String(body.password ?? '') !== DECK_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'wrong_password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(DECK_COOKIE, deckToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
