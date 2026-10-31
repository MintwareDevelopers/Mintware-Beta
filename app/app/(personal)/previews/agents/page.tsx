import { AppContainer } from '@/components/web2/AppShell'
import { V1Agents } from '@/components/web2/v1/V1Agents'

export const metadata = { title: 'Mintware — Agents' }

export default function V1AgentsPage() {
  return (
    <AppContainer>
      <V1Agents />
    </AppContainer>
  )
}
