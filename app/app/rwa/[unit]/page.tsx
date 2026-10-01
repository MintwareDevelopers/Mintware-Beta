import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { MwNav } from '@/components/web2/MwNav'
import { RwaMarket } from '@/components/rwa/RwaMarket'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible } from '@/lib/v2/rwaGate'
import { RWA_DEMO } from '@/lib/rwa/demo'

// /app/rwa/[unit] — V2-RWAs live market for one RWA liquidity unit. SERVER-gated: 404 unless the V2-RWAs
// flag is on and the visitor passes the V2 gate, so nothing about the vertical ships to anyone else.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'RWA liquidity · Mintware', robots: { index: false, follow: false } }

export default async function RwaUnitPage({ params }: { params: Promise<{ unit: string }> }) {
  if (!isV2RwaVisible((await cookies()).get(V2_COOKIE)?.value)) notFound()
  const { unit } = await params
  if (unit.toLowerCase() !== RWA_DEMO.property.symbol.toLowerCase()) notFound()
  return (
    <>
      <MwNav />
      <RwaMarket />
    </>
  )
}
