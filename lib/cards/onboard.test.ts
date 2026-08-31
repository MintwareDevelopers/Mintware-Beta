import { describe, expect, it } from 'vitest'
import {
  ONBOARD_SEQUENCE,
  goLiveBlocked,
  isMemberStep,
  nextOnboardStep,
  onboardComplete,
  type OnboardState,
} from './onboard'

const fresh: OnboardState = {
  cardIssued: false,
  permitSigned: false,
  approvalGranted: false,
  bufferPrimed: false,
  liveProvisioned: false,
}
const step = (s: Partial<OnboardState>): OnboardState => ({ ...fresh, ...s })

describe('card onboarding — ordered sequence', () => {
  it('walks issue → permit → approve → prime → go_live → complete, in order', () => {
    let s = fresh
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      const n = nextOnboardStep(s)
      if (n === 'complete') break
      seen.push(n)
      s = step({
        cardIssued: s.cardIssued || n === 'issue_card',
        permitSigned: s.permitSigned || n === 'sign_permit',
        approvalGranted: s.approvalGranted || n === 'grant_approval',
        bufferPrimed: s.bufferPrimed || n === 'prime_buffer',
        liveProvisioned: s.liveProvisioned || n === 'go_live',
      })
    }
    expect(seen).toEqual([...ONBOARD_SEQUENCE])
    expect(onboardComplete(s)).toBe(true)
  })

  it('marks sign_permit as the one member step', () => {
    expect(isMemberStep('sign_permit')).toBe(true)
    expect(isMemberStep('grant_approval')).toBe(false)
    expect(isMemberStep('prime_buffer')).toBe(false)
  })

  it('requires the permit BEFORE the buffer can be primed', () => {
    // issued but no permit → next is sign_permit, never prime
    expect(nextOnboardStep(step({ cardIssued: true }))).toBe('sign_permit')
  })
})

describe('card onboarding — cold-decline (go-live) guard', () => {
  it('blocks go-live until the buffer is primed', () => {
    expect(
      goLiveBlocked(step({ cardIssued: true, permitSigned: true, approvalGranted: true, bufferPrimed: false })),
    ).toBe('buffer not primed')
    expect(nextOnboardStep(step({ cardIssued: true, permitSigned: true, approvalGranted: true }))).toBe('prime_buffer')
  })

  it('reports the earliest missing precondition', () => {
    expect(goLiveBlocked(fresh)).toBe('card not issued')
    expect(goLiveBlocked(step({ cardIssued: true }))).toBe('permit not signed')
    expect(goLiveBlocked(step({ cardIssued: true, permitSigned: true }))).toBe('approval not granted')
  })

  it('allows go-live once fully primed, and is a no-op when already live', () => {
    expect(
      goLiveBlocked(step({ cardIssued: true, permitSigned: true, approvalGranted: true, bufferPrimed: true })),
    ).toBeNull()
    expect(goLiveBlocked(step({ liveProvisioned: true, bufferPrimed: false }))).toBeNull()
  })
})
