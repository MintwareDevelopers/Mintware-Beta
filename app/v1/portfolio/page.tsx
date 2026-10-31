import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Portfolio } from '@/components/web2/v1/V1Portfolio'

export const metadata = { title: 'Mintware — Portfolio' }

export default function V1PortfolioPage() {
  return (
    <V1Shell>
      <V1Portfolio />
    </V1Shell>
  )
}
