// Retired: the current Gateway has no card-spend settlement entrypoint. Bridge card spend is funded
// through the separate Earn vault and refill lifecycle.

export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({ error: 'legacy_card_settlement_retired', replacement: 'Bridge card buffer refill' }, { status: 410 })
}
