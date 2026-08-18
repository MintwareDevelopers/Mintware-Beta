// The AGENT CAPITAL-PARKING model — the core idea: an agent parks idle USDC, it keeps EARNING, and it stays
// SPENDABLE IN PLACE. Spend draws straight from the yield position (edge-auth hold → gateway burns shares →
// USDC to the payee), so parked capital never has to be un-parked into a hot wallet to be usable. This is
// YPN's "never idle, never locked, always yours" applied to agent treasuries; x402 is just the spend trigger.
// Pure functions — the on-chain / edge reads are injected so this is unit-testable. Spec: agentkit-compute-402-spec.md.

export interface ParkedReader {
  /** Agent's parked USDC (atomic, 6dp), fee-NET realizable — the vault's `convertToAssets(shares(agent))`,
   *  which already reflects the yield adapter's previewRedeem (net of any source exit fee). */
  parkedAtomic(agent: string): Promise<bigint>
}

export interface SpendableSource {
  /** Atomic USDC the edge will authorize to spend RIGHT NOW (NAV − live holds − caps). Return null when the
   *  edge is unavailable — spendable then defaults to the full parked balance. */
  headroomAtomic(agent: string): Promise<bigint | null>
}

export interface AgentTreasury {
  agent: string
  /** Parked USDC (earning), atomic 6dp string. */
  parkedUsdc: string
  /** Spendable-in-place USDC right now, atomic 6dp string (≤ parked). */
  spendableUsdc: string
  /** Whether the parked balance is currently earning (parked > 0). */
  earning: boolean
}

/**
 * Resolve an agent's treasury: what's parked (and earning) and what's spendable in place right now. When no
 * `SpendableSource` is given (or it returns null), spendable == parked — the whole earning balance is usable,
 * which is the defining property of the account: parking does not lock.
 */
export async function readAgentTreasury(
  agent: string,
  parked: ParkedReader,
  spend?: SpendableSource,
): Promise<AgentTreasury> {
  const parkedAtomic = await parked.parkedAtomic(agent)
  const head = spend ? await spend.headroomAtomic(agent) : null
  const spendableAtomic = head == null ? parkedAtomic : head < parkedAtomic ? head : parkedAtomic
  return {
    agent: agent.toLowerCase(),
    parkedUsdc: parkedAtomic.toString(),
    spendableUsdc: (spendableAtomic < 0n ? 0n : spendableAtomic).toString(),
    earning: parkedAtomic > 0n,
  }
}

/** Format atomic 6dp USDC as a human decimal string. "1234500" → "1.2345", "2000000" → "2". */
export function formatUsdc(atomic: string): string {
  const n = BigInt(atomic)
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}
