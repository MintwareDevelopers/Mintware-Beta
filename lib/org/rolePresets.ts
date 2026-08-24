// Four canned role presets — NOT a policy engine, NOT a tier DSL. Each maps a member's free-text
// `role` (stored on `org_members.role` by the org layer) to a daily USDC spend cap + a few capability
// flags. The cap is enforced at payout time (belt) and by edge-auth off live NAV (suspenders).
//
// `dailyCapUsdc`: null = uncapped (owner), 0n = receive-only / cannot spend (vendor), else the cap in
// atomic USDC (6dp). Deliberately four fixed rows — an org picks a preset from a dropdown; there is no
// per-org policy engine to configure.

export type RolePreset = 'owner' | 'manager' | 'contributor' | 'vendor'

export interface RolePolicy {
  preset: RolePreset
  label: string
  /** null = uncapped · 0n = receive-only · else daily cap in atomic USDC (6dp). */
  dailyCapUsdc: bigint | null
  canInvite: boolean
  canManageTreasury: boolean // record the vault address, fund, assign roles
  canPayVendors: boolean // pay-a-vendor + run payroll
  blurb: string
}

export const ROLE_PRESETS: Record<RolePreset, RolePolicy> = {
  owner: {
    preset: 'owner',
    label: 'Owner',
    dailyCapUsdc: null,
    canInvite: true,
    canManageTreasury: true,
    canPayVendors: true,
    blurb: 'Full control — record the treasury, fund it, assign roles, pay. No spend cap.',
  },
  manager: {
    preset: 'manager',
    label: 'Manager',
    dailyCapUsdc: 25_000_000_000n, // $25,000/day
    canInvite: true,
    canManageTreasury: false,
    canPayVendors: true,
    blurb: 'Pay vendors and run payroll up to $25,000/day. Can invite. Cannot change the treasury.',
  },
  contributor: {
    preset: 'contributor',
    label: 'Contributor',
    dailyCapUsdc: 2_000_000_000n, // $2,000/day
    canInvite: false,
    canManageTreasury: false,
    canPayVendors: false,
    blurb: 'Spend up to $2,000/day from the treasury via card / x402. Cannot pay arbitrary vendors.',
  },
  vendor: {
    preset: 'vendor',
    label: 'Vendor',
    dailyCapUsdc: 0n,
    canInvite: false,
    canManageTreasury: false,
    canPayVendors: false,
    blurb: 'Receive-only — gets paid by the org, cannot spend the treasury.',
  },
}

export const ROLE_PRESET_LIST: RolePolicy[] = [
  ROLE_PRESETS.owner,
  ROLE_PRESETS.manager,
  ROLE_PRESETS.contributor,
  ROLE_PRESETS.vendor,
]

/** Normalize any stored role string to a known preset (defaults to contributor — matches the org
 *  layer's `org_members.role` default). */
export function policyForRole(role: string | null | undefined): RolePolicy {
  const key = (role ?? '').toLowerCase() as RolePreset
  return ROLE_PRESETS[key] ?? ROLE_PRESETS.contributor
}

/** Is a proposed spend (atomic USDC) within a raw daily cap? null cap = always allowed; 0n cap =
 *  never. `spentToday` is the member's already-spent amount today (atomic USDC). Split out from
 *  `withinDailyCap` so the standing layer can check a tier-adjusted cap with identical belt semantics
 *  (lib/org/standing.ts#withinStandingDailyCap). */
export function withinDailyCapValue(cap: bigint | null, amountUsdc: bigint, spentToday: bigint = 0n): boolean {
  if (cap === null) return true
  if (cap === 0n) return false
  return spentToday + amountUsdc <= cap
}

/** Is a proposed spend (atomic USDC) within this role's daily cap? null cap = always allowed;
 *  0n cap = never. `spentToday` is the member's already-spent amount today (atomic USDC). */
export function withinDailyCap(policy: RolePolicy, amountUsdc: bigint, spentToday: bigint = 0n): boolean {
  return withinDailyCapValue(policy.dailyCapUsdc, amountUsdc, spentToday)
}
