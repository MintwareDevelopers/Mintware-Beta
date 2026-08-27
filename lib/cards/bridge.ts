// Bridge (bridge.xyz / Stripe Issuing) provider leg — the non-custodial "standard" card rail.
// Sibling to lib/cards/lithic.ts: this file is the Bridge-SPECIFIC plumbing only. Unlike the Lithic
// rail, Bridge AUTHORIZES the swipe itself (Stripe does not hand us the issuing_authorization.request
// webhook), so there is deliberately NO decision logic here — lib/org/cardAuthorize.ts's ASA path is
// Lithic-only. On Bridge our control surface is just two levers: how much USDC sits in the buffer, and
// how large a standing allowance we grant. This file owns the allowance lever.
//
// How Bridge pulls (verified against apidocs.bridge.xyz + docs.stripe.com/issuing, 2026-08):
//   • The funding wallet is a non-custodial wallet — here, the user's OWN Privy embedded wallet, which
//     is exactly the address they self-register on-chain as `bufferOf[user]` (Gateway.setBufferAddress,
//     msg.sender-pinned). Bridge's rule is ONE WALLET = ONE CARD in standard mode, which is precisely
//     the per-user shape the buffer table already enforces (card_spend_buffers is 1:1 per org_card).
//   • The wallet grants a plain ERC-20 `approve(spender, allowance)` on USDC, signed by the wallet's
//     own key (Privy signs; gas can be sponsored). At auth Bridge pulls the exact amount via the
//     allowance and only up to the wallet's real USDC balance — it never reads a vault NAV.
//   • The spender is a PER-PROGRAM Bridge issuer address that Bridge provisions to us — NOT a public
//     constant, and explicitly NOT the same as any global cards contract. So it is config (env), and
//     `bridgeConfigured()` refuses to operate until it is set to a valid address.
//
// Security posture on the allowance: an allowance is a standing pull-right, so we do NOT grant the
// "unlimited" approval Stripe's sample suggests (it leans on Stripe spending_controls as the only
// cap). We cap the on-chain allowance to a few days of the card's daily spend limit — Bridge's
// spending_controls stay the belt; this capped allowance is the on-chain backstop, so even an
// over-funded wallet or a misbehaving issuer contract can only ever pull up to the cap. Mirrors the
// Gateway's maxBurnPerBlock defense-in-depth philosophy.

import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem'

/** Absolute ceiling on any standing allowance we will ever grant, regardless of inputs. $50,000. */
export const BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC = 50_000_000_000n // 50_000 * 1e6 (USDC, 6dp)

/** Default number of days of the daily spend cap a standing allowance covers before a re-approve. */
export const BRIDGE_ALLOWANCE_COVERAGE_DAYS = 7

/**
 * Master runtime gate for the Bridge card rail. Fail-CLOSED: only the exact string 'true' enables it,
 * so unset / '' / '1' / 'TRUE' all evaluate OFF (same posture as CARD_BUFFER_ENABLED / _REFILL_ENABLED).
 * Nothing in this rail touches funds or issues a card until this is deliberately flipped on.
 */
export function bridgeCardsEnabled(): boolean {
  return process.env.CARD_BRIDGE_ENABLED === 'true'
}

/**
 * The per-program Bridge cards spender we approve on USDC — provisioned to us by Bridge, read from
 * BRIDGE_CARDS_SPENDER. Returns null (never throws) when unset or not a valid address, so callers can
 * degrade to a clean 503 the same way getLithicClient() does.
 */
export function bridgeCardsSpender(): Address | null {
  const raw = process.env.BRIDGE_CARDS_SPENDER
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
}

/** True only when the Bridge rail is both enabled AND fully configured (API key + a valid spender). */
export function bridgeConfigured(): boolean {
  return bridgeCardsEnabled() && !!process.env.BRIDGE_API_KEY && bridgeCardsSpender() !== null
}

export interface ApproveAllowanceParams {
  /** The card's maximum daily spend (atomic USDC, 6dp). The on-chain allowance is sized off this. */
  dailyCapAtomic: bigint
  /** Days of `dailyCapAtomic` the standing allowance should cover before needing a re-approve. Default 7. */
  coverageDays?: number
  /** Never grant less than this (atomic USDC). Default: one day of the cap (`dailyCapAtomic`). */
  minAllowanceAtomic?: bigint
  /** Never grant more than this (atomic USDC). Default: BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC. Always wins. */
  hardMaxAtomic?: bigint
}

const bigMin = (a: bigint, b: bigint): bigint => (a < b ? a : b)
const bigMax = (a: bigint, b: bigint): bigint => (a > b ? a : b)

/**
 * Compute the capped standing allowance to grant Bridge on USDC. `coverageDays × dailyCap`, floored at
 * `minAllowance` (default one day of cap) and — always last — clamped down to `hardMax`. The hard max is
 * the ultimate ceiling: even a misconfigured floor larger than it cannot push the grant above it. This
 * is a bounded pull-right by construction, never an unlimited approval.
 */
export function computeApproveAllowanceAtomic(p: ApproveAllowanceParams): bigint {
  if (p.dailyCapAtomic <= 0n) throw new Error('dailyCapAtomic must be > 0')
  const coverageDays = p.coverageDays ?? BRIDGE_ALLOWANCE_COVERAGE_DAYS
  if (!Number.isInteger(coverageDays) || coverageDays < 1) {
    throw new Error('coverageDays must be an integer >= 1')
  }
  const hardMax = p.hardMaxAtomic ?? BRIDGE_ALLOWANCE_HARD_MAX_ATOMIC
  if (hardMax <= 0n) throw new Error('hardMaxAtomic must be > 0')

  const floor = p.minAllowanceAtomic ?? p.dailyCapAtomic
  const base = p.dailyCapAtomic * BigInt(coverageDays)
  // floor first (never under-provision), then clamp to the hard max last (the ceiling always wins).
  return bigMin(hardMax, bigMax(base, floor))
}

/** A raw transaction for Privy to sign from the funding (buffer) wallet. No signing happens here. */
export interface ApproveCall {
  /** The USDC token contract the approve is called on. */
  to: Address
  /** Encoded `approve(spender, allowance)` calldata. */
  data: Hex
  /** ERC-20 approve carries no ether. */
  value: '0x0'
}

/**
 * Build the ERC-20 `approve(spender, allowance)` call the funding (Privy) wallet must sign so Bridge
 * can pull at swipe time. Pure — encodes the calldata and returns the tx shape; the caller hands it to
 * Privy for signing (ideally under a policy that allowlists ONLY this spender and caps the amount, so
 * an auto-signer can never approve an attacker — the approve-step analogue of the Gateway's C1 pin).
 */
export function buildApproveCall(args: {
  usdcAddress: string
  spender: string
  allowanceAtomic: bigint
}): ApproveCall {
  if (!isAddress(args.usdcAddress)) throw new Error('invalid usdcAddress')
  if (!isAddress(args.spender)) throw new Error('invalid spender')
  if (args.allowanceAtomic <= 0n) throw new Error('allowanceAtomic must be > 0')

  const spender = getAddress(args.spender)
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, args.allowanceAtomic] })
  return { to: getAddress(args.usdcAddress), data, value: '0x0' }
}
