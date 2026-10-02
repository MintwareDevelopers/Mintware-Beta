import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { MwNav } from '@/components/web2/MwNav'
import { RwaMarket } from '@/components/rwa/RwaMarket'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible } from '@/lib/v2/rwaGate'
import { getUnit } from '@/lib/rwa/demo'

// /app/rwa/[unit] — V2-RWAs live market for one RWA liquidity unit (`wcp7` on Base Sepolia, `wcp7-xrpl` on XRPL
// EVM testnet). SERVER-gated: 404 unless the V2-RWAs flag is on and the visitor passes the V2 gate.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'RWA liquidity · Mintware', robots: { index: false, follow: false } }

export default async function RwaUnitPage({ params }: { params: Promise<{ unit: string }> }) {
  if (!isV2RwaVisible((await cookies()).get(V2_COOKIE)?.value)) notFound()
  const { unit } = await params
  const u = getUnit(unit)
  if (!u) notFound()
  return (
    <>
      <MwNav />
      <RwaMarket slug={u.slug} />
    </>
  )
}
