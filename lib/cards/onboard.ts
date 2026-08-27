// Bridge card onboarding — the ordered, idempotent setup sequence, as a pure state machine.
//
// The stellar-journey guarantee this file enforces: a card must never become spendable before its
// buffer holds funds. Bridge only ever sees the buffer wallet's balance; if we provision a card to
// Apple/Google Wallet before the initial refill has landed, the user's VERY FIRST tap can hit an
// empty buffer and decline — the worst possible first impression. So `activate` is gated behind
// `bufferPrimed`, and the canonical order is fixed here rather than left to whoever calls the steps.
//
// Pure over four booleans (no I/O) so the ordering + the cold-decline guard are unit-testable in
// isolation. The side-effecting orchestrator (issue via the Bridge REST client → grant the approve via
// Privy → prime via Gateway.refillBuffer → activate + push-provision) is a later, credential-gated
// slice; it drives its steps off `nextOnboardStep` and refuses to `activate` while `activationBlocked`
// returns a reason.

/** The setup steps, in the only order they may run. */
export type OnboardStep = 'issue_card' | 'grant_approval' | 'prime_buffer' | 'activate'

export const ONBOARD_SEQUENCE: readonly OnboardStep[] = [
  'issue_card', // create the Bridge card + link the funding wallet (crypto_wallet type:standard = the Privy/bufferOf address)
  'grant_approval', // Privy signs the capped ERC-20 approve(spender, cap) on USDC (lib/cards/bridge.ts#buildApproveCall)
  'prime_buffer', // Gateway.refillBuffer redeems senior shares → the buffer wallet; wait for on-chain confirmation
  'activate', // mark active + push-provision — ONLY once the buffer is primed
] as const

export interface OnboardState {
  /** Bridge card created and the funding wallet linked. */
  cardIssued: boolean
  /** The capped USDC allowance to Bridge's spender is live on-chain. */
  approvalGranted: boolean
  /** The initial refill is CONFIRMED on-chain and the buffer holds at least its minimum. */
  bufferPrimed: boolean
  /** Card marked active / push-provisioned to the wallet. */
  activated: boolean
}

/** The next step to run, or 'complete'. Idempotent: re-deriving from the same state is a no-op. */
export function nextOnboardStep(s: OnboardState): OnboardStep | 'complete' {
  if (!s.cardIssued) return 'issue_card'
  if (!s.approvalGranted) return 'grant_approval'
  if (!s.bufferPrimed) return 'prime_buffer'
  if (!s.activated) return 'activate'
  return 'complete'
}

/**
 * The cold-decline guard. Returns a human reason why the card may NOT be activated yet, or null when
 * activation is allowed (including when it is already active — activation is idempotent). The
 * orchestrator MUST consult this before provisioning the card to a wallet: activating before
 * `bufferPrimed` is exactly the empty-buffer-first-swipe failure the journey design forbids.
 */
export function activationBlocked(s: OnboardState): string | null {
  if (s.activated) return null
  if (!s.cardIssued) return 'card not issued'
  if (!s.approvalGranted) return 'approval not granted'
  if (!s.bufferPrimed) return 'buffer not primed'
  return null
}

/** True once every step is done. */
export function onboardComplete(s: OnboardState): boolean {
  return nextOnboardStep(s) === 'complete'
}
