// RBAC model for the Team (Treasury Terminal) surface — Phase 2 hard gates.
//
// The User/Team split is a SOFT, client-side mode today (see components/web2/AppMode.tsx). Phase 2 adds
// real access control: a role per organization membership, carried in the user's Privy custom metadata,
// enforced by middleware (coarse redirect) + the server data layer (the security boundary). This file is
// the PURE, dependency-free core — the role matrix + permission checks — so it is exhaustively unit-tested
// and shared by both the middleware and the server layer.

/** Roles on a treasury organization, most→least privileged. Mirrors the Phase-2 spec's Admin/Manager/
 *  Member/Cardholder ladder (a crypto-native flavor of the Brex/Ramp Admin→…→Viewer convention). */
export type TeamRole = 'admin' | 'manager' | 'member' | 'cardholder'

export const TEAM_ROLES: readonly TeamRole[] = ['admin', 'manager', 'member', 'cardholder'] as const

/** Fine-grained capabilities the terminal gates on. `<resource>:<action>`. */
export type Permission =
  | 'treasury:view' // see the terminal at all (overview, balances)
  | 'vaults:manage' // curator: create / allocate treasury vaults
  | 'cards:issue' // issue cards in the program
  | 'spend:initiate' // propose a spend / use an assigned card
  | 'spend:approve' // sign / approve a spend below-or-at quorum
  | 'roles:manage' // invite members, change roles
  | 'developers:manage' // API keys, webhooks

/** Role → granted permissions. Additive only (a role's set is explicit, no inheritance magic — easier to
 *  audit). Admin is the superset; Cardholder is the minimal spender. */
const MATRIX: Record<TeamRole, readonly Permission[]> = {
  admin: [
    'treasury:view',
    'vaults:manage',
    'cards:issue',
    'spend:initiate',
    'spend:approve',
    'roles:manage',
    'developers:manage',
  ],
  manager: ['treasury:view', 'vaults:manage', 'cards:issue', 'spend:initiate', 'spend:approve', 'developers:manage'],
  member: ['treasury:view', 'spend:initiate'],
  cardholder: ['treasury:view', 'spend:initiate'],
}

/** Type guard: is `v` a valid TeamRole? (Untrusted cookie/metadata strings pass through here.) */
export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === 'string' && (TEAM_ROLES as readonly string[]).includes(v)
}

/** Does `role` grant `permission`? A null/unknown role grants nothing (fail closed). */
export function can(role: TeamRole | null | undefined, permission: Permission): boolean {
  if (!role || !isTeamRole(role)) return false
  return MATRIX[role].includes(permission)
}

/** All permissions for a role (empty for an invalid/null role). */
export function permissionsFor(role: TeamRole | null | undefined): readonly Permission[] {
  return role && isTeamRole(role) ? MATRIX[role] : []
}

/** Any valid team role can enter the terminal (they at least have `treasury:view`). */
export function hasTeamAccess(role: TeamRole | null | undefined): boolean {
  return can(role, 'treasury:view')
}

// ── Privy custom-metadata shape (the org memberships live on the Privy user) ─────────────────

/** One org membership carried in the user's Privy custom metadata. */
export type OrgMembership = { orgId: string; role: TeamRole }

/** The Mintware-owned slice of a Privy user's custom metadata. `activeOrgId` selects which membership the
 *  current session is scoped to (the ScopeSwitcher writes it). */
export type MintwareOrgMeta = {
  activeOrgId?: string
  memberships?: OrgMembership[]
}

/** The user's role in their ACTIVE org (or the sole org if `activeOrgId` is unset), or null if none. */
export function activeRole(meta: MintwareOrgMeta | null | undefined): TeamRole | null {
  const memberships = meta?.memberships
  if (!memberships || memberships.length === 0) return null
  const active = meta?.activeOrgId
    ? memberships.find((m) => m.orgId === meta.activeOrgId)
    : memberships.length === 1
      ? memberships[0]
      : null
  return active && isTeamRole(active.role) ? active.role : null
}
