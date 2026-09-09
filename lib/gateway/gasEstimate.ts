// Round-4 audit fix (Medium): the gateway crons used to send harvest()/compoundQuote()/deploy() with a
// hard-coded gas literal (900_000n / 400_000n / 1_200_000n), never derived from `estimateGas`. A paired
// token whose transfer legitimately (or deliberately) costs more than the fixed budget — but never
// reverts on its own — makes the pre-simulate correctly see real, non-dust fees (so the dust-guard
// doesn't skip), then the REAL on-chain call runs out of gas and reverts every single cron tick,
// permanently: accrued fees keep growing on-chain (never lost) but the automated pipeline can never
// collect/compound/deploy for that specific pool again until an operator notices and intervenes by hand.
//
// Estimate for real, buffer generously, and fall back to the fixed constant only as a FLOOR when
// estimation itself fails (a transient RPC error, or a state change between estimate and send making the
// estimate flaky) — so a genuinely doomed call still gets today's best-effort attempt rather than silently
// no-op'ing, and a legitimately-heavier call gets a real chance instead of an unconditional revert.
// `estimateContractGas`'s real viem type is a deeply-generic overload keyed to the exact ABI/args passed in
// (same friction `lib/gateway/positionReader.ts`'s `Reader` type already works around) — accepted loosely
// here since this helper is deliberately generic over any gateway contract call, pinned at each call site.
type GasEstimateClient = { estimateContractGas: (args: any) => Promise<bigint> } // eslint-disable-line @typescript-eslint/no-explicit-any

export async function estimateGasWithFloor(
  client: GasEstimateClient,
  request: Record<string, unknown>,
  floor: bigint,
  bufferBps = 7_500, // +75% headroom over the point estimate — generous, this only runs a few times/day
): Promise<{ gas: bigint; estimated: boolean }> {
  try {
    const est = await client.estimateContractGas(request)
    const buffered = (est * BigInt(10_000 + bufferBps)) / 10_000n
    return { gas: buffered > floor ? buffered : floor, estimated: true }
  } catch {
    return { gas: floor, estimated: false }
  }
}

// Best-effort detection of a DETERMINISTIC contract-level revert (as opposed to a transient RPC/network
// failure) from a thrown simulate/estimate error — e.g. `NotDeployed()` when a pool has no position yet.
// String-matched against the error's own message (viem includes the decoded custom-error name there when
// the ABI carries it) rather than a strict type/shape check, since the exact wrapper class varies by viem
// version and call path — deliberately conservative (a miss just falls through to the existing behavior,
// never a false positive that skips a call that should have run).
export function isDeterministicContractRevert(e: unknown, errorNames: readonly string[]): string | null {
  const msg = e instanceof Error ? e.message : String(e)
  return errorNames.find((name) => msg.includes(name)) ?? null
}
