import { AppContainer } from '@/components/web2/AppShell'
import { V1Issuers } from '@/components/web2/v1/V1Issuers'

export const metadata = { title: 'Mintware — Issuers' }

export default function V1IssuersPage() {
  return (
    <AppContainer>
      <V1Issuers />
    </AppContainer>
  )
}
