import { notFound } from 'next/navigation'
import { v2RwaFlagOn } from '@/lib/v2/rwaGate'
import { RwaPositions } from '@/components/rwa/RwaPositions'

// /app/rwa-liquidity — Personal › Earn › RWA liquidity (retail LP positions). V2-gated by the (personal) layout;
// 404 unless the RWA vertical flag is on.
export default function RwaLiquidityPage() {
  if (!v2RwaFlagOn()) notFound()
  return <RwaPositions />
}
