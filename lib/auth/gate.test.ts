import { describe, it, expect } from 'vitest'
import { evaluateGate, type GateSession } from './gate'

const ON = { hardGateEnabled: true }
const anon: GateSession = { authenticated: false, role: null }
const userOnly: GateSession = { authenticated: true, role: null } // authed retail user, no team role
const member: GateSession = { authenticated: true, role: 'member' }
const admin: GateSession = { authenticated: true, role: 'admin' }

describe('evaluateGate — flag off (showcase)', () => {
  it('never redirects when the hard gate is disabled', () => {
    for (const path of ['/app/team', '/app/team/cards', '/app/account', '/app/vaults']) {
      expect(evaluateGate(path, anon, { hardGateEnabled: false })).toEqual({ action: 'allow' })
    }
  })
})

describe('evaluateGate — flag on', () => {
  it('allows unprotected app paths for anyone', () => {
    expect(evaluateGate('/app/vaults', anon, ON)).toEqual({ action: 'allow' })
    expect(evaluateGate('/app/swap', anon, ON)).toEqual({ action: 'allow' })
    expect(evaluateGate('/app/leaderboard', anon, ON)).toEqual({ action: 'allow' })
  })

  it('sends an anonymous visitor on a team path to sign-in', () => {
    const r = evaluateGate('/app/team/cards', anon, ON)
    expect(r).toMatchObject({ action: 'redirect', reason: 'unauthenticated' })
  })

  it('sends an anonymous visitor on the personal money surface to sign-in', () => {
    const r = evaluateGate('/app/account', anon, ON)
    expect(r).toMatchObject({ action: 'redirect', reason: 'unauthenticated' })
  })

  it('an authed retail user (no team role) is bounced OUT of the terminal to their home', () => {
    const r = evaluateGate('/app/team', userOnly, ON)
    expect(r).toEqual({ action: 'redirect', to: '/app/account', reason: 'no-team-access' })
  })

  it('an authed retail user CAN see their own personal money surface', () => {
    expect(evaluateGate('/app/account', userOnly, ON)).toEqual({ action: 'allow' })
  })

  it('team members + admins pass into the terminal', () => {
    expect(evaluateGate('/app/team/policy', member, ON)).toEqual({ action: 'allow' })
    expect(evaluateGate('/app/team', admin, ON)).toEqual({ action: 'allow' })
  })

  it('prefix matching is boundary-safe (no /app/teamX false match)', () => {
    // A hypothetical sibling path must NOT be treated as the team surface.
    expect(evaluateGate('/app/teamwork', anon, ON)).toEqual({ action: 'allow' })
  })

  it('exact prefix path is protected', () => {
    expect(evaluateGate('/app/team', anon, ON)).toMatchObject({ action: 'redirect', reason: 'unauthenticated' })
  })
})
