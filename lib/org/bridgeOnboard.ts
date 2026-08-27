// The onboarding ORCHESTRATOR — drives the pure state machine (lib/cards/onboard.ts) through its
// real side effects, in order, idempotently. Every effect is an injected dependency so the whole
// sequence is testable end-to-end with fakes; the route wires the real Bridge client / Privy signer /
// Gateway.refillBuffer / activation.
//
// The one invariant it refuses to break: it will not run `activate` while `activationBlocked` reports
// a reason (buffer not primed) — the cold-decline guard. Steps are re-derived from freshly-loaded
// state each pass, so a crash-and-retry resumes exactly where it left off.

import {
  activationBlocked,
  nextOnboardStep,
  type OnboardState,
  type OnboardStep,
} from '@/lib/cards/onboard'

export interface OnboardDeps {
  /** Read the current persisted onboarding state (source of truth; reflects prior steps' effects). */
  loadState(): Promise<OnboardState>
  /** Create the Bridge card + link the funding wallet (crypto_wallet type:standard = bufferOf[user]). */
  issueCard(): Promise<void>
  /** Privy signs the capped approve (lib/org/bridgeApprove.ts). */
  grantApproval(): Promise<void>
  /** Redeem senior shares → the buffer wallet (Gateway.refillBuffer); MUST leave bufferPrimed=true only
   *  once the refill is confirmed on-chain and the balance is at/above its minimum. */
  primeBuffer(): Promise<void>
  /** Mark the card active + push-provision. Only reached after the buffer is primed. */
  activate(): Promise<void>
  log?(msg: string, meta?: Record<string, unknown>): void
}

export interface OnboardRunResult {
  finalState: OnboardState
  ran: OnboardStep[]
  complete: boolean
  /** Set when the run stopped because activation was blocked or a step made no progress. */
  stopped?: string
}

const RUNNERS: Record<OnboardStep, (d: OnboardDeps) => Promise<void>> = {
  issue_card: (d) => d.issueCard(),
  grant_approval: (d) => d.grantApproval(),
  prime_buffer: (d) => d.primeBuffer(),
  activate: (d) => d.activate(),
}

/**
 * Advance onboarding to completion (or until it can't). Returns the steps it ran and the final state.
 * `maxSteps` is a loop backstop; a step that fails to change the next-step is treated as no-progress
 * and stops the run (rather than spinning) so the caller can surface it.
 */
export async function runOnboarding(deps: OnboardDeps, maxSteps = 8): Promise<OnboardRunResult> {
  const ran: OnboardStep[] = []
  let state = await deps.loadState()

  for (let i = 0; i < maxSteps; i++) {
    const step = nextOnboardStep(state)
    if (step === 'complete') return { finalState: state, ran, complete: true }

    if (step === 'activate') {
      const blocked = activationBlocked(state)
      if (blocked) return { finalState: state, ran, complete: false, stopped: `activate blocked: ${blocked}` }
    }

    deps.log?.('onboard.step', { step })
    await RUNNERS[step](deps)
    ran.push(step)

    const next = await deps.loadState()
    if (nextOnboardStep(next) === step) {
      // the effect didn't advance the machine (e.g. prime submitted but not yet confirmed) — stop
      // cleanly rather than loop; a later invocation resumes from the same point.
      return { finalState: next, ran, complete: false, stopped: `no progress after ${step}` }
    }
    state = next
  }

  return { finalState: state, ran, complete: nextOnboardStep(state) === 'complete', stopped: 'max steps reached' }
}
