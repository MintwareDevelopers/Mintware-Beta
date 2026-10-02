import { notFound } from 'next/navigation'
import { RwaMarket } from '@/components/rwa/RwaMarket'
import { getUnit } from '@/lib/rwa/demo'

// /app/rwa/[unit] — the live market for one RWA liquidity unit (`wcp7` on Base Sepolia, `wcp7-xrpl` on XRPL EVM
// testnet). Gating lives in ../layout.tsx (flag + V2 unlock).
export default async function RwaUnitPage({ params }: { params: Promise<{ unit: string }> }) {
  const { unit } = await params
  const u = getUnit(unit)
  if (!u) notFound()
  return <RwaMarket slug={u.slug} />
}
