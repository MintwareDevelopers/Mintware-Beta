import { V1Shell } from '@/components/web2/v1/V1Shell'
import { V1Swap } from '@/components/web2/v1/V1Swap'

// V1 Swap — USDG → a curated-pool token, routed through Mintware's Robinhood-Chain pools. Dark app shell.
export const metadata = { title: 'Mintware — Swap' }

export default function V1SwapPage() {
  return (
    <V1Shell>
      <V1Swap />
    </V1Shell>
  )
}
