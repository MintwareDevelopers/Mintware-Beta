// Retired permit activation endpoint. Card holders now register their own Bridge funding destination
// through the Gateway's proposeBuffer / acceptBuffer flow, with the contract enforced 48 hour delay.

export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({
    error: 'standing_spend_permit_retired',
    replacement: 'Propose your Bridge funding wallet on the card funding Gateway, then accept after 48 hours.',
  }, { status: 410 })
}
