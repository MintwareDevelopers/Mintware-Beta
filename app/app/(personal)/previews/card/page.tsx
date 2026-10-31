import { AppContainer } from '@/components/web2/AppShell'
import { V1Card } from '@/components/web2/v1/V1Card'

export const metadata = { title: 'Mintware — Card' }

export default function V1CardPage() {
  return (
    <AppContainer>
      <V1Card />
    </AppContainer>
  )
}
