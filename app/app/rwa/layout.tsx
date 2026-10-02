import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { canSeeRwa, isV2RwaVisible } from '@/lib/v2/rwaGate'
import { RwaShell } from '@/components/rwa/RwaShell'
import { RwaAccess } from '@/components/rwa/RwaAccess'

// /app/rwa/* — the RWA workspace. SERVER-gated (lib/v2/rwaGate.ts): flag off ⇒ 404; no V2 unlock ⇒ the branded
// access screen INSTEAD of any page (no demo data in the HTML); unlocked ⇒ the workspace inside the shared shell.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'RWA liquidity · Mintware', robots: { index: false, follow: false } }

export default async function RwaLayout({ children }: { children: React.ReactNode }) {
  if (!isV2RwaVisible()) notFound()
  if (!canSeeRwa(await cookies())) return <RwaAccess />
  return <RwaShell>{children}</RwaShell>
}
