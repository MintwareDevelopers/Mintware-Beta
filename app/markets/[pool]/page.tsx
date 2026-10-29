import { V1PoolDetail } from '@/components/web2/v1/V1PoolDetail'
export default async function MarketDetailPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params
  return <V1PoolDetail slug={pool} />
}
