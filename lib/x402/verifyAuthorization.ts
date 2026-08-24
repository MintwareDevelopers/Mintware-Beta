// Cryptographic verification of the x402 EIP-3009 `TransferWithAuthorization` the payer signs — the
// per-payment authorization that binds RECIPIENT + AMOUNT to the payer's signature. The settle path uses
// this so the standing DelegatedSpendPermit (a daily-cap gate that binds NEITHER receiver nor amount) is
// no longer the ONLY thing gating a spend: without a valid signature over {from,to,value,…}, an
// unauthenticated caller could settle a victim's standing permit to an arbitrary payTo/value.
//
// Domain/types MUST match what the client signs. The AgentKit / Eliza / MCP `X402_PAY` actions sign
// USDC's EIP-712 `TransferWithAuthorization` (types below) over the token's own domain
// { name, version, chainId, verifyingContract: <USDC on network> } — see plugins/agentkit/src/index.ts
// (`USDC_DOMAIN` + `EIP3009_TYPES`). We mirror that exactly here.

import { verifyTypedData, isAddress } from 'viem'
import type { Eip3009Authorization } from './types'
import { USDC_BY_NETWORK } from './config'

/** EIP-3009 `TransferWithAuthorization` typed-data struct — field order + types define the typehash.
 *  Byte-identical to the client signers (AgentKit/Eliza/MCP). `nonce` is bytes32 (a random 32-byte id),
 *  NOT the `PaymentRequirements.nonce` string. */
export const EIP3009_TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/** USDC EIP-712 domain identity per x402 network (name/version/chainId). `verifyingContract` comes from
 *  the payment requirements' `asset` when present (the exact USDC contract the seller advertised),
 *  falling back to the known public token address for the network (`USDC_BY_NETWORK`). base/base-sepolia
 *  match `plugins/agentkit`'s `USDC_DOMAIN` byte-for-byte; arc is the Circle-Arc USDC identity. */
const USDC_DOMAIN_ID: Record<string, { name: string; version: string; chainId: number }> = {
  base: { name: 'USD Coin', version: '2', chainId: 8453 },
  'base-sepolia': { name: 'USDC', version: '2', chainId: 84532 },
  arc: { name: 'USDC', version: '2', chainId: 5042002 },
}

/** Resolve the USDC EIP-712 domain for `network`, using `asset` as `verifyingContract` when it is a valid
 *  address (else the network default). Returns null for an unknown network or missing token address so the
 *  caller fails closed rather than verifying against a fabricated domain. */
export function usdcDomainFor(
  network: string,
  asset?: string,
): { name: string; version: string; chainId: number; verifyingContract: `0x${string}` } | null {
  const id = USDC_DOMAIN_ID[network]
  if (!id) return null
  const verifyingContract = asset && isAddress(asset) ? asset : USDC_BY_NETWORK[network]
  if (!verifyingContract || !isAddress(verifyingContract)) return null
  return { name: id.name, version: id.version, chainId: id.chainId, verifyingContract: verifyingContract as `0x${string}` }
}

/** Recover the signer of an EIP-3009 `TransferWithAuthorization` and check it equals `authorization.from`.
 *  Returns true ONLY when the signature is a valid 65-byte sig over the exact {from,to,value,validAfter,
 *  validBefore,nonce} the payer signed, under the correct USDC domain for (network, asset). Any missing /
 *  malformed field, unknown network, or non-recovering signature ⇒ false (fail closed). Never throws. */
export async function verifyEip3009Authorization(args: {
  network: string
  asset?: string
  authorization: Eip3009Authorization | undefined
  signature: string | undefined
}): Promise<boolean> {
  const a = args.authorization
  const signature = args.signature
  if (!a) return false
  if (!isAddress(a.from ?? '') || !isAddress(a.to ?? '')) return false
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false
  if (typeof a.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return false

  let value: bigint
  let validAfter: bigint
  let validBefore: bigint
  try {
    value = BigInt(a.value)
    validAfter = BigInt(a.validAfter)
    validBefore = BigInt(a.validBefore)
  } catch {
    return false
  }

  const domain = usdcDomainFor(args.network, args.asset)
  if (!domain) return false

  try {
    return await verifyTypedData({
      address: a.from as `0x${string}`,
      domain,
      types: EIP3009_TRANSFER_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: a.from as `0x${string}`,
        to: a.to as `0x${string}`,
        value,
        validAfter,
        validBefore,
        nonce: a.nonce as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    })
  } catch {
    return false
  }
}
