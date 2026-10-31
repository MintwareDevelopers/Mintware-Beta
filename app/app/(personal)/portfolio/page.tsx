import { AppContainer } from '@/components/web2/AppShell'
import { V1Portfolio } from '@/components/web2/v1/V1Portfolio'

export const metadata = { title: 'Mintware — Portfolio' }

export default function V1PortfolioPage() {
  return (
    <AppContainer>
      <V1Portfolio />
    </AppContainer>
  )
}
