import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Portfolio } from '@/components/web2/v1/V1Portfolio'

// V1 Portfolio — the account surface (working LP position value + net P&L). Dark app-mode shell.
export const metadata = { title: 'Mintware — Portfolio' }

export default function V1PortfolioPage() {
  return (
    <V1Shell>
      <V1Portfolio />
    </V1Shell>
  )
}
