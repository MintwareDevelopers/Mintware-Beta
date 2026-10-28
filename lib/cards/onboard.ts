// Bridge card onboarding — the ordered, idempotent setup sequence, as a pure state machine.
//
// The stellar-journey guarantee this file enforces: a card must never become spendable before its
// buffer holds funds. Bridge only ever sees the buffer wallet's balance; if we provision a card to
// Apple/Google Wallet before the initial refill has landed, the user's VERY FIRST tap can hit an
// empty buffer and decline — the worst possible first impression. So `go_live` is gated behind
// `bufferPrimed`, and the canonical order is fixed here rather than left to whoever calls the steps.
//
// The order is dictated by real on-chain dependencies:
//   1. issue_card    — create the Bridge card + link the funding wallet (crypto_wallet type:standard
//                      = the Privy/bufferOf address).
//   2. register_destination — the MEMBER proposes and accepts their Bridge funding wallet on-chain.
//                      Acceptance is available only after the Gateway's 48-hour destination delay.
//   3. grant_approval — Privy signs the capped USDC approve(spender, cap) so Bridge can pull.
//   4. prime_buffer  — Gateway.refill redeems senior shares → the buffer wallet; wait for on-chain
//                      confirmation. Depends on register_destination.
//   5. go_live       — mark the card live + push-provision. Gated behind prime_buffer (cold-decline
//                      guard) AND grant_approval (Bridge must be able to pull).
//
// Pure over five booleans (no I/O) so the ordering + the guards are unit-testable in isolation. The
// side-effecting orchestrator (lib/org/bridgeOnboard.ts) drives its steps off `nextOnboardStep`,
// pauses on member steps, and refuses `go_live` while `goLiveBlocked` returns a reason.

/** The setup steps, in the only order they may run. */
export type OnboardStep = 'issue_card' | 'register_destination' | 'grant_approval' | 'prime_buffer' | 'go_live'

export const ONBOARD_SEQUENCE: readonly OnboardStep[] = [
  'issue_card',
  'register_destination',
  'grant_approval',
  'prime_buffer',
  'go_live',
] as const

/** Steps the orchestrator cannot execute itself — it waits for the member to act (wallet signature). */
export const MEMBER_STEPS: ReadonlySet<OnboardStep> = new Set<OnboardStep>(['register_destination'])

export function isMemberStep(step: OnboardStep): boolean {
  return MEMBER_STEPS.has(step)
}

export interface OnboardState {
  /** Bridge card created and the funding wallet linked. */
  cardIssued: boolean
  /** The member has accepted the Gateway funding destination. */
  destinationRegistered: boolean
  /** The capped USDC allowance to Bridge's spender is live on-chain. */
  approvalGranted: boolean
  /** The initial refill is CONFIRMED on-chain and the buffer holds at least its minimum. */
  bufferPrimed: boolean
  /** Card marked live / push-provisioned to the wallet. */
  liveProvisioned: boolean
}

/** The next step to run, or 'complete'. Idempotent: re-deriving from the same state is a no-op. */
export function nextOnboardStep(s: OnboardState): OnboardStep | 'complete' {
  if (!s.cardIssued) return 'issue_card'
  if (!s.destinationRegistered) return 'register_destination'
  if (!s.approvalGranted) return 'grant_approval'
  if (!s.bufferPrimed) return 'prime_buffer'
  if (!s.liveProvisioned) return 'go_live'
  return 'complete'
}

/**
 * The cold-decline guard. Returns a human reason why the card may NOT go live yet, or null when
 * go-live is allowed (including when it is already live — idempotent). The orchestrator MUST consult
 * this before provisioning the card to a wallet: going live before `bufferPrimed` is exactly the
 * empty-buffer-first-swipe failure the journey design forbids.
 */
export function goLiveBlocked(s: OnboardState): string | null {
  if (s.liveProvisioned) return null
  if (!s.cardIssued) return 'card not issued'
  if (!s.destinationRegistered) return 'funding destination not registered'
  if (!s.approvalGranted) return 'approval not granted'
  if (!s.bufferPrimed) return 'buffer not primed'
  return null
}

/** True once every step is done. */
export function onboardComplete(s: OnboardState): boolean {
  return nextOnboardStep(s) === 'complete'
}
