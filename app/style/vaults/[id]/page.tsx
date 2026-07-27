import { notFound } from 'next/navigation'
import { getVault } from '@/lib/vaults/discovery'
import { VaultDetailView } from './VaultDetail'

const ALLOW =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

export default async function VaultDetailPreview({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!ALLOW) notFound()
  const { id } = await params
  const vault = await getVault(id)
  if (!vault) notFound()
  return <VaultDetailView v={vault} />
}
