// Retired: Gateway standing-permit registrations are no longer supported.
export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({ error: 'standing_gateway_permits_retired', replacement: 'x402 DIRECT payment authorization' }, { status: 410 })
}

export async function GET() {
  return Response.json({ error: 'standing_gateway_permits_retired' }, { status: 410 })
}
