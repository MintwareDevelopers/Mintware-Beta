import { AppContainer } from '@/components/web2/AppShell'
import { V1Discover } from '@/components/web2/v1/V1Discover'

// Markets — the app's home: live MarketEngine markets plus the screened watchlist. Every "Launch app" lands here.
export const metadata = { title: 'Mintware — Markets' }

export default function MarketsPage() {
  return (
    <AppContainer>
      <V1Discover />
    </AppContainer>
  )
}
