// The ONE definition of the gateway's long-lived `DelegatedSpendPermit` EIP-712 scheme — the
// signature a spender signs ONCE and that `MintwarePaymentGateway.settleSpend` verifies on every
// later settle. Extracted here so every caller (the human card-activate flow in
// `app/api/orgs/[id]/cards/[cardId]/activate/route.ts` AND the agent x402 permit-registration flow
// in `app/api/x402/permit/route.ts`) verifies against the IDENTICAL domain + typehash. There is
// exactly one permit mechanism; a second copy of these constants is a drift bug, not a convenience.
//
// Matches the Solidity side: domain { name: 'Mintware Payment Gateway', version: '2.0', chainId,
// verifyingContract: <gateway> } and the `DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,
// uint256 nonce,uint256 deadline)` typehash.

import { verifyTypedData } from 'viem'

/** EIP-712 domain `name` — must equal the Gateway's `EIP712("Mintware Payment Gateway","2.0")`. */
export const DELEGATED_SPEND_PERMIT_DOMAIN_NAME = 'Mintware Payment Gateway'
/** EIP-712 domain `version`. */
export const DELEGATED_SPEND_PERMIT_DOMAIN_VERSION = '2.0'

/** The `DelegatedSpendPermit` typed-data struct — field order + types define the typehash. */
export const DELEGATED_SPEND_PERMIT_TYPES = {
  DelegatedSpendPermit: [
    { name: 'user', type: 'address' },
    { name: 'maxDailySpendUSDC', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

/** The signed message values (uint256 fields as bigint, as viem expects for typed-data). */
export interface DelegatedSpendPermitMessage {
  user: `0x${string}`
  maxDailySpendUSDC: bigint
  nonce: bigint
  deadline: bigint
}

/** Build the EIP-712 domain for a specific gateway + chain. `verifyingContract` is the deployed
 *  `MintwarePaymentGateway` (the `settleSpend` entrypoint) — never a client-supplied value. */
export function delegatedSpendPermitDomain(chainId: number, gateway: `0x${string}`) {
  return {
    name: DELEGATED_SPEND_PERMIT_DOMAIN_NAME,
    version: DELEGATED_SPEND_PERMIT_DOMAIN_VERSION,
    chainId,
    verifyingContract: gateway,
  } as const
}

/** Verify a `DelegatedSpendPermit` signature recovers to `signer` under this exact scheme. Returns
 *  true only when the typed-data signature is valid for the given domain (gateway + chain) and
 *  message. The single verification path shared by the card and x402 flows. */
export async function verifyDelegatedSpendPermit(args: {
  signer: `0x${string}`
  chainId: number
  gateway: `0x${string}`
  message: DelegatedSpendPermitMessage
  signature: `0x${string}`
}): Promise<boolean> {
  return verifyTypedData({
    address: args.signer,
    domain: delegatedSpendPermitDomain(args.chainId, args.gateway),
    types: DELEGATED_SPEND_PERMIT_TYPES,
    primaryType: 'DelegatedSpendPermit',
    message: args.message,
    signature: args.signature,
  })
}
