import { notFound } from 'next/navigation'
import { v2RwaFlagOn } from '@/lib/v2/rwaGate'
import { RwaIssuerConsole } from '@/components/rwa/RwaIssuerConsole'

// /app/team/rwa — Team › RWA issuance (the issuer's console). V2-gated by the team layout; 404 unless the RWA
// vertical flag is on. Read-only today — see RwaIssuerConsole.
export default function TeamRwaPage() {
  if (!v2RwaFlagOn()) notFound()
  return <RwaIssuerConsole />
}
