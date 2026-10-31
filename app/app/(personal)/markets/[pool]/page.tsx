import { AppContainer } from '@/components/web2/AppShell'
import { V1PoolDetail } from '@/components/web2/v1/V1PoolDetail'

export const metadata = { title: 'Mintware — Market' }

export default async function MarketDetailPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params
  return (
    <AppContainer>
      <V1PoolDetail slug={pool} />
    </AppContainer>
  )
}
