import { describe, expect, it } from 'vitest'
import {
  ONBOARD_SEQUENCE,
  activationBlocked,
  nextOnboardStep,
  onboardComplete,
  type OnboardState,
} from './onboard'

const fresh: OnboardState = { cardIssued: false, approvalGranted: false, bufferPrimed: false, activated: false }
const step = (s: Partial<OnboardState>): OnboardState => ({ ...fresh, ...s })

describe('card onboarding — ordered sequence', () => {
  it('walks issue → approve → prime → activate → complete, in order', () => {
    let s = fresh
    const seen: string[] = []
    // simulate the orchestrator completing each step the planner names
    for (let i = 0; i < 10; i++) {
      const n = nextOnboardStep(s)
      if (n === 'complete') break
      seen.push(n)
      s = step({
        cardIssued: s.cardIssued || n === 'issue_card',
        approvalGranted: s.approvalGranted || n === 'grant_approval',
        bufferPrimed: s.bufferPrimed || n === 'prime_buffer',
        activated: s.activated || n === 'activate',
      })
    }
    expect(seen).toEqual([...ONBOARD_SEQUENCE])
    expect(onboardComplete(s)).toBe(true)
  })

  it('nextOnboardStep is idempotent on a completed state', () => {
    const done = step({ cardIssued: true, approvalGranted: true, bufferPrimed: true, activated: true })
    expect(nextOnboardStep(done)).toBe('complete')
    expect(onboardComplete(done)).toBe(true)
  })
})

describe('card onboarding — cold-decline guard', () => {
  it('blocks activation until the buffer is primed (the empty-first-swipe guard)', () => {
    expect(activationBlocked(step({ cardIssued: true, approvalGranted: true, bufferPrimed: false }))).toBe(
      'buffer not primed',
    )
    // even with a card + approval, activation is refused until funds are actually in the buffer
    expect(nextOnboardStep(step({ cardIssued: true, approvalGranted: true }))).toBe('prime_buffer')
  })

  it('reports the earliest missing precondition', () => {
    expect(activationBlocked(fresh)).toBe('card not issued')
    expect(activationBlocked(step({ cardIssued: true }))).toBe('approval not granted')
    expect(activationBlocked(step({ cardIssued: true, approvalGranted: true }))).toBe('buffer not primed')
  })

  it('allows activation once primed, and is a no-op when already active', () => {
    expect(activationBlocked(step({ cardIssued: true, approvalGranted: true, bufferPrimed: true }))).toBeNull()
    expect(activationBlocked(step({ activated: true, bufferPrimed: false }))).toBeNull() // already active → idempotent
  })
})
