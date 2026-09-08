// Curator authentication for the LP-gateway registry (audit closeout O-3 / R-2 / HO-7).
//
// The curator is a WALLET on an env allowlist (`LP_GATEWAY_CURATORS`), not a shared bearer secret typed
// into the public /curate page. Every approve / reject / deactivate / register is an EIP-191 signature
// over the canonical JSON below; the route rebuilds the exact message server-side and strict-compares
// it (the "gold standard" from .claude/rules/route-handler.md), so a signature is bound to the action,
// the request, the candidate addresses AND the issuedAt — it cannot be replayed for another action or
// another candidate. Pure functions only (no I/O) so the page and the route share one definition.

export const GATEWAY_CURATE_ACTION = 'mintware-gateway-curate' as const

export type CurateAction = 'approve' | 'reject' | 'deactivate'

export type CurateMessageInput = {
  address: string
  issuedAt: number
  curateAction: CurateAction
  requestId?: string | null
  /** the pool being acted on (poolId / address, lower-cased); required for deactivate */
  poolAddress?: string | null
  chainId?: number | null
  /** candidate instance addresses when an approve also registers */
  positionManager?: string | null
  staging?: string | null
}

const lower = (v?: string | null) => (v ? v.toLowerCase() : null)

/** Canonical curator message — the page signs exactly this; the route rebuilds + strict-compares. */
export function buildGatewayCurateMessage(input: CurateMessageInput): string {
  return JSON.stringify(
    {
      action: GATEWAY_CURATE_ACTION,
      address: lower(input.address) ?? '',
      curateAction: input.curateAction,
      requestId: input.requestId ?? null,
      poolAddress: lower(input.poolAddress),
      chainId: input.chainId ?? null,
      positionManager: lower(input.positionManager),
      staging: lower(input.staging),
      issuedAt: input.issuedAt,
    },
    null,
    2,
  )
}

/** Parse `LP_GATEWAY_CURATORS` (comma list of 0x addresses). Malformed entries are dropped. */
export function parseCuratorAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s))
}

/** True only when the allowlist is configured AND contains the wallet. Empty allowlist ⇒ nobody. */
export function isAllowlistedCurator(address: string | null | undefined, allowlist: readonly string[]): boolean {
  if (!address || allowlist.length === 0) return false
  return allowlist.includes(address.toLowerCase())
}
