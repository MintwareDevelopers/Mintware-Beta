// =============================================================================
// oracleKeys.ts — per-role oracle signing-key resolution (audit fix C2)
//
// The audit found ONE hot EOA reused across unrelated signing roles:
// DISTRIBUTOR_PRIVATE_KEY signed both Merkle roots AND attribution snapshots, and
// the range proposer FELL BACK to that same root key. One key compromise forged
// distributions, fee weights, and rebalances at once.
//
// This resolver splits signing into four ROLES, each with its own env var and a
// SAFE same-family fallback. Critically, the root/merkle family and the
// range/agent family never cross — the old rangeProposer → DISTRIBUTOR_PRIVATE_KEY
// reuse is removed. Provision a distinct key per role in production to complete the
// separation; until then each role falls back within its own family (non-breaking).
//
// Roles:
//   root   — Merkle distribution roots (MintwareDistributor / WeightedDistributor close)
//   weight — attribution snapshots (FeeVault / weighted epoch weighting)
//   range  — signed LP-range rebalance proposals (SocialVault / base vault)
//   agent  — AI-agent action attestations (AIAttribution)
// =============================================================================

export type OracleRole = 'root' | 'weight' | 'range' | 'agent'

/**
 * Ordered env-var candidates per role. First non-empty wins. The fallback stays
 * WITHIN the role's trust family so root/merkle keys and range/agent keys never
 * cross — that crossover is the C2 vulnerability this module closes.
 */
const ROLE_ENV: Record<OracleRole, string[]> = {
  root:   ['ROOT_ORACLE_PRIVATE_KEY',   'DISTRIBUTOR_PRIVATE_KEY'],
  weight: ['WEIGHT_ORACLE_PRIVATE_KEY', 'DISTRIBUTOR_PRIVATE_KEY'],
  range:  ['RANGE_ORACLE_PRIVATE_KEY',  'ORACLE_PRIVATE_KEY'],
  agent:  ['AGENT_ORACLE_PRIVATE_KEY',  'ORACLE_PRIVATE_KEY'],
}

/**
 * Resolve the 0x-prefixed private key for a signing role. Throws a clear error
 * (naming every accepted env var) if none is configured — callers that must fail
 * soft should wrap this in try/catch and return a 500.
 */
export function getOracleSignerKey(role: OracleRole): `0x${string}` {
  const candidates = ROLE_ENV[role]
  for (const name of candidates) {
    const raw = process.env[name]
    if (raw && raw.length > 0) {
      return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
    }
  }
  throw new Error(
    `[oracleKeys] No signing key configured for role "${role}". ` +
    `Set one of: ${candidates.join(', ')}.`
  )
}
