import { describe, it, expect } from 'vitest'
import {
  can,
  hasTeamAccess,
  isTeamRole,
  permissionsFor,
  activeRole,
  TEAM_ROLES,
  type MintwareOrgMeta,
} from './rbac'

describe('rbac role matrix', () => {
  it('admin has every permission', () => {
    for (const p of [
      'treasury:view',
      'vaults:manage',
      'cards:issue',
      'spend:initiate',
      'spend:approve',
      'roles:manage',
      'developers:manage',
    ] as const) {
      expect(can('admin', p)).toBe(true)
    }
  })

  it('manager can manage vaults + approve spend but NOT manage roles', () => {
    expect(can('manager', 'vaults:manage')).toBe(true)
    expect(can('manager', 'spend:approve')).toBe(true)
    expect(can('manager', 'roles:manage')).toBe(false)
  })

  it('member + cardholder can view + initiate, nothing privileged', () => {
    for (const r of ['member', 'cardholder'] as const) {
      expect(can(r, 'treasury:view')).toBe(true)
      expect(can(r, 'spend:initiate')).toBe(true)
      expect(can(r, 'spend:approve')).toBe(false)
      expect(can(r, 'cards:issue')).toBe(false)
      expect(can(r, 'vaults:manage')).toBe(false)
    }
  })

  it('null / invalid role grants nothing (fail closed)', () => {
    expect(can(null, 'treasury:view')).toBe(false)
    expect(can(undefined, 'treasury:view')).toBe(false)
    // @ts-expect-error deliberately invalid
    expect(can('root', 'treasury:view')).toBe(false)
    expect(permissionsFor(null)).toEqual([])
  })

  it('hasTeamAccess is exactly treasury:view', () => {
    for (const r of TEAM_ROLES) expect(hasTeamAccess(r)).toBe(true)
    expect(hasTeamAccess(null)).toBe(false)
  })

  it('isTeamRole guards untrusted strings', () => {
    expect(isTeamRole('admin')).toBe(true)
    expect(isTeamRole('ADMIN')).toBe(false)
    expect(isTeamRole('')).toBe(false)
    expect(isTeamRole(42)).toBe(false)
    expect(isTeamRole(null)).toBe(false)
  })
})

describe('activeRole from Privy metadata', () => {
  const meta = (m: MintwareOrgMeta) => m

  it('picks the role of the active org', () => {
    const m = meta({
      activeOrgId: 'org_b',
      memberships: [
        { orgId: 'org_a', role: 'admin' },
        { orgId: 'org_b', role: 'member' },
      ],
    })
    expect(activeRole(m)).toBe('member')
  })

  it('with one membership and no activeOrgId, uses the sole membership', () => {
    expect(activeRole({ memberships: [{ orgId: 'org_a', role: 'manager' }] })).toBe('manager')
  })

  it('ambiguous (multiple memberships, no active) → null', () => {
    expect(
      activeRole({
        memberships: [
          { orgId: 'org_a', role: 'admin' },
          { orgId: 'org_b', role: 'member' },
        ],
      }),
    ).toBeNull()
  })

  it('no memberships / undefined → null', () => {
    expect(activeRole(undefined)).toBeNull()
    expect(activeRole(null)).toBeNull()
    expect(activeRole({})).toBeNull()
    expect(activeRole({ memberships: [] })).toBeNull()
  })

  it('active org present but membership role invalid → null (fail closed)', () => {
    const m = { activeOrgId: 'org_a', memberships: [{ orgId: 'org_a', role: 'owner' as unknown as 'admin' }] }
    expect(activeRole(m)).toBeNull()
  })
})
