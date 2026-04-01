import { NextRequest, NextResponse } from 'next/server'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorize(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return null
  }

  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — refusing to run outside local development' },
      { status: 500 }
    )
  }

  return null
}

export async function GET(req: NextRequest) {
  const authFailure = authorize(req)
  if (authFailure) return authFailure

  try {
    const result = await settleUniversalEpochs()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/universal-epoch-close] settlement failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
