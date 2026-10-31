import { RwaProof } from '@/components/rwa/RwaProof'
import { getUnit, RWA_UNITS } from '@/config/rwa-archive/proof'

// /v1/rwas/proof?unit=<slug> — the recorded lifecycle + contracts per chain.
export default async function RwaProofPage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const { unit } = await searchParams
  return <RwaProof slug={(unit && getUnit(unit)?.slug) || RWA_UNITS[0].slug} />
}
