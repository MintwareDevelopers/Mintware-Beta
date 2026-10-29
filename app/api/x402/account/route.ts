// Retired: the YPN capital-parking account was specific to the removed x402 hold and settle flow.
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ error: 'x402_vault_account_retired', replacement: 'x402 DIRECT payments do not park funds' }, { status: 410 })
}
