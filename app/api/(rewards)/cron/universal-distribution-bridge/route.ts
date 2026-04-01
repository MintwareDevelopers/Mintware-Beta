import { NextRequest, NextResponse } from 'next/server'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

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

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 25)

  try {
    const result = await bridgeUniversalEpochsToDistributor(limit)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/universal-distribution-bridge] bridge failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
