import { notFound } from 'next/navigation'
import { RwaMarket } from '@/components/rwa/RwaMarket'
import { getUnit } from '@/lib/rwa/demo'

// /app/rwas/[unit] — the live market for one RWA liquidity unit (`wcp7` on Base Sepolia).
export default async function RwaUnitPage({ params }: { params: Promise<{ unit: string }> }) {
  const { unit } = await params
  const u = getUnit(unit)
  if (!u) notFound()
  return <RwaMarket slug={u.slug} />
}
