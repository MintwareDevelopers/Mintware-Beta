import { notFound } from 'next/navigation'
import { getVaultsDiscovery } from '@/lib/vaults/discovery'
import { VaultDiscovery } from './VaultDiscovery'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'

// Gated preview of the ATX Settlemint Vault Discovery page (dev or NEXT_PUBLIC_ATX_PREVIEW).
const ALLOW =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

export default async function VaultDiscoveryPreview() {
  if (!ALLOW) notFound()
  const vaults = await getVaultsDiscovery()
  return (
    <>
      <VaultDiscovery vaults={vaults} />
      <VaultAmplify />
    </>
  )
}
