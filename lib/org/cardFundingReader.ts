import type { Address, PublicClient } from 'viem'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'
import { PAYMENT_GATEWAY_ABI } from '@/lib/web3/artifacts/mintwarePaymentGateway'

const TREASURY_MARKER_ABI = [{
  type: 'function', name: 'poolManager', stateMutability: 'view', inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const

/** Resolve and validate the single-asset card funding vault's dedicated PaymentGateway. */
export async function readCardFundingGateway(
  client: PublicClient,
  vault: Address,
  treasuryVault?: string | null,
): Promise<Address> {
  if (treasuryVault && vault.toLowerCase() === treasuryVault.toLowerCase()) {
    throw new Error('card_funding_vault_must_be_separate_from_treasury')
  }

  const gateway = await client.readContract({ address: vault, abi: YIELD_VAULT_ABI, functionName: 'gateway' })
  if (!gateway || gateway === '0x0000000000000000000000000000000000000000') {
    throw new Error('card_funding_gateway_not_configured')
  }
  const boundVault = await client.readContract({ address: gateway, abi: PAYMENT_GATEWAY_ABI, functionName: 'vault' })
  if (String(boundVault).toLowerCase() !== vault.toLowerCase()) throw new Error('card_funding_gateway_vault_mismatch')

  // Require the single-asset vault surface and reject the V4 Treasury marker. This prevents another
  // org's Treasury from being selected even when it uses the same USDC and has a bound Gateway.
  let hasPoolManager = false
  try {
    await client.readContract({ address: vault, abi: TREASURY_MARKER_ABI, functionName: 'poolManager' })
    hasPoolManager = true
  } catch { /* MintwareYieldVault has no PoolManager getter */ }
  if (hasPoolManager) throw new Error('card_funding_source_must_be_single_asset_yield_vault')
  await client.readContract({ address: vault, abi: YIELD_VAULT_ABI, functionName: 'adapter' })
  const vaultUsdc = await client.readContract({ address: vault, abi: YIELD_VAULT_ABI, functionName: 'asset' })
  const bridgeUsdc = process.env.BRIDGE_USDC_ADDRESS
  if (!bridgeUsdc || String(vaultUsdc).toLowerCase() !== bridgeUsdc.toLowerCase()) {
    throw new Error('card_funding_asset_must_match_bridge_usdc')
  }
  return gateway as Address
}
