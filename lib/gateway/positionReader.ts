// Reads a depositor's LP-gateway position value from chain, using the SAME offset-consistent share
// math the contract enforces (toAssets with the 1e6 virtual offset) so the dashboard never disagrees
// with an actual withdraw. Cost basis + buffer balance come from the caller (DB). All amounts are
// atomic units of the pool's quote asset (USDG). No par claim — value is the current IL-exposed mark.

import { LP_GATEWAY_ABI, LP_GATEWAY_VIRTUAL as V } from '@/lib/web3/artifacts/lpGateway'

// Structural: satisfied by a viem PublicClient and by test mocks alike (viem's readContract is a
// complex generic overload, so we accept it loosely and pin the ABI at the call site).
type Reader = { readContract: (args: any) => Promise<unknown> } // eslint-disable-line @typescript-eslint/no-explicit-any

export type GatewayPositionView = {
  shares: bigint
  positionValueAtomic: bigint
  costBasisAtomic: bigint | null
  unrealizedPnlAtomic: bigint | null
  bufferBalanceAtomic: bigint
}

/** toAssets(shares, nav, totalShares) with the contract's virtual offset — floor, matching on-chain. */
export function positionValueAtomic(shares: bigint, totalShares: bigint, totalNav: bigint): bigint {
  if (shares <= 0n || totalShares <= 0n) return 0n
  return (shares * (totalNav + V)) / (totalShares + V)
}

export async function readGatewayPosition(opts: {
  client: Reader
  positionManager: `0x${string}`
  user: `0x${string}`
  costBasisAtomic?: bigint | null
  bufferBalanceAtomic?: bigint
}): Promise<GatewayPositionView> {
  const { client, positionManager, user } = opts
  const read = (functionName: string, args?: readonly unknown[]) =>
    client.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName, args })

  const [shares, totalShares, totalNav] = (await Promise.all([
    read('sharesOf', [user]),
    read('totalShares'),
    read('totalNav'),
  ])) as [bigint, bigint, bigint]

  const value = positionValueAtomic(shares, totalShares, totalNav)
  const costBasisAtomic = opts.costBasisAtomic ?? null
  const unrealizedPnlAtomic = costBasisAtomic == null ? null : value - costBasisAtomic

  return {
    shares,
    positionValueAtomic: value,
    costBasisAtomic,
    unrealizedPnlAtomic,
    bufferBalanceAtomic: opts.bufferBalanceAtomic ?? 0n,
  }
}
