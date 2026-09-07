import { use } from 'react'
import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1PoolDetail } from '@/components/web2/v1/V1PoolDetail'

// /earn/[pool] — dark pool detail + deposit (V1 app mode). Reached from Discover; single-sided USDG
// deposit, the signature allocation/range visual, and the position panel. See V1PoolDetail.
export const metadata = { title: 'Mintware — Pool' }

export default function EarnPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = use(params)
  return (
    <V1Shell>
      <V1PoolDetail slug={pool} />
    </V1Shell>
  )
}
