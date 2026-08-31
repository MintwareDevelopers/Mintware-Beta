// The onboarding ORCHESTRATOR — drives the pure state machine (lib/cards/onboard.ts) through its
// real side effects, in order, idempotently. Every effect is an injected dependency so the whole
// sequence is testable end-to-end with fakes; the route wires the real Bridge client / Privy signer /
// Gateway.refillBuffer / go-live.
//
// Two things it refuses to do: (1) run `go_live` while `goLiveBlocked` reports a reason (buffer not
// primed) — the cold-decline guard; (2) perform a MEMBER step (the standing-permit signature). When
// the next step is a member step, it stops with `awaitingMember` set so the caller can prompt the
// member, then resumes from the same point once they've signed. Steps are re-derived from freshly-
// loaded state each pass, so a crash-and-retry resumes exactly where it left off.

import {
  goLiveBlocked,
  isMemberStep,
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
  /** Mark the card live + push-provision. Only reached after the buffer is primed. */
  goLive(): Promise<void>
  log?(msg: string, meta?: Record<string, unknown>): void
}

export interface OnboardRunResult {
  finalState: OnboardState
  ran: OnboardStep[]
  complete: boolean
  /** Set when the run paused waiting for a member action (e.g. the standing-permit signature). */
  awaitingMember?: OnboardStep
  /** Set when the run stopped because go-live was blocked or a step made no progress. */
  stopped?: string
}

// Automated steps only — sign_permit is a member action and is never in this map.
const RUNNERS: Partial<Record<OnboardStep, (d: OnboardDeps) => Promise<void>>> = {
  issue_card: (d) => d.issueCard(),
  grant_approval: (d) => d.grantApproval(),
  prime_buffer: (d) => d.primeBuffer(),
  go_live: (d) => d.goLive(),
}

/**
 * Advance onboarding as far as it can autonomously. Returns the steps it ran and the final state.
 * Pauses (does not fail) at a member step. `maxSteps` is a loop backstop; a step that fails to change
 * the next-step is treated as no-progress and stops the run rather than spinning.
 */
export async function runOnboarding(deps: OnboardDeps, maxSteps = 10): Promise<OnboardRunResult> {
  const ran: OnboardStep[] = []
  let state = await deps.loadState()

  for (let i = 0; i < maxSteps; i++) {
    const step = nextOnboardStep(state)
    if (step === 'complete') return { finalState: state, ran, complete: true }

    if (isMemberStep(step)) {
      // the member has to act (sign their permit) — surface it and stop; a later call resumes here.
      return { finalState: state, ran, complete: false, awaitingMember: step }
    }

    if (step === 'go_live') {
      const blocked = goLiveBlocked(state)
      if (blocked) return { finalState: state, ran, complete: false, stopped: `go_live blocked: ${blocked}` }
    }

    const runner = RUNNERS[step]
    if (!runner) return { finalState: state, ran, complete: false, stopped: `no runner for ${step}` }

    deps.log?.('onboard.step', { step })
    await runner(deps)
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
