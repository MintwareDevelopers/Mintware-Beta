import { describe, it, expect } from 'vitest'
import { evaluateTeamAuth } from './requireTeam'
import type { VerifiedSession } from './session'

const sess = (role: VerifiedSession['role']): VerifiedSession => ({ userId: 'did:privy:u1', role })

describe('evaluateTeamAuth (server security boundary)', () => {
  it('401s a null session (unauthenticated / unverified / unconfigured all collapse here)', () => {
    expect(evaluateTeamAuth(null)).toEqual({ ok: false, status: 401, error: 'unauthenticated' })
    expect(evaluateTeamAuth(null, 'roles:manage')).toMatchObject({ status: 401 })
  })

  it('403s a verified user with no team role (null role has no treasury:view)', () => {
    expect(evaluateTeamAuth(sess(null))).toEqual({ ok: false, status: 403, error: 'no_team_access' })
  })

  it('admits any valid role when no specific permission is required', () => {
    for (const r of ['admin', 'manager', 'member', 'cardholder'] as const) {
      expect(evaluateTeamAuth(sess(r))).toMatchObject({ ok: true, role: r, userId: 'did:privy:u1' })
    }
  })

  it('enforces a required permission per the role matrix', () => {
    // roles:manage is admin-only
    expect(evaluateTeamAuth(sess('admin'), 'roles:manage')).toMatchObject({ ok: true })
    expect(evaluateTeamAuth(sess('manager'), 'roles:manage')).toEqual({ ok: false, status: 403, error: 'forbidden' })
    // spend:approve is admin + manager
    expect(evaluateTeamAuth(sess('manager'), 'spend:approve')).toMatchObject({ ok: true })
    expect(evaluateTeamAuth(sess('member'), 'spend:approve')).toEqual({ ok: false, status: 403, error: 'forbidden' })
    // developers:manage is admin + manager
    expect(evaluateTeamAuth(sess('cardholder'), 'developers:manage')).toEqual({ ok: false, status: 403, error: 'forbidden' })
    // treasury:view — everyone with a role
    expect(evaluateTeamAuth(sess('cardholder'), 'treasury:view')).toMatchObject({ ok: true })
  })
})
