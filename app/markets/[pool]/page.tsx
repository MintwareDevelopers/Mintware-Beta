import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1PoolDetail } from '@/components/web2/v1/V1PoolDetail'

export const metadata = { title: 'Mintware — Market' }

export default async function MarketDetailPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params
  return (
    <V1Shell>
      <V1PoolDetail slug={pool} />
    </V1Shell>
  )
}
