// V2-RWAs — testnet dUSD faucet, so any visitor can try supplying liquidity to the demo unit. Sends a fixed
// amount of the valueless demo dollar from the demo-trader wallet (which holds a dUSD float) — it never mints
// and never sends gas. One claim per wallet per 24 h per server instance, on top of the route's rate limit.
// Base Sepolia only; dUSD has no value.

import { parseAbi, parseUnits } from 'viem'
import { RWA_DEMO } from './demo'
import { rwaPub, rwaTrader, rwaWallet } from './traderSigner'

export const FAUCET_AMOUNT_USD = 500
const DAY_MS = 24 * 3600 * 1000
const ERC20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

const claims = new Map<string, number>()
let inFlight = false

/** Pure: may `addr` claim at `now`? Exported for tests. */
export function canClaim(map: Map<string, number>, addr: string, now: number): boolean {
  const last = map.get(addr.toLowerCase())
  return last === undefined || now - last >= DAY_MS
}

export async function sendDemoUsd(to: `0x${string}`): Promise<{ hash: string; amount: number }> {
  const now = Date.now()
  if (!canClaim(claims, to, now)) throw new Error('already_claimed')
  if (inFlight) throw new Error('busy')
  inFlight = true
  try {
    const usd = RWA_DEMO.contracts.usd as `0x${string}`
    const account = await rwaTrader()
    const amount = parseUnits(String(FAUCET_AMOUNT_USD), 6)
    const float = await rwaPub.readContract({ address: usd, abi: ERC20, functionName: 'balanceOf', args: [account.address] })
    if (float < amount) throw new Error('faucet_empty')
    const req = { address: usd, abi: ERC20, functionName: 'transfer' as const, args: [to, amount] as const, account }
    await rwaPub.simulateContract(req)
    const hash = await rwaWallet(account).writeContract({ ...req, gas: 90_000n })
    const r = await rwaPub.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new Error(`reverted:${hash}`)
    claims.set(to.toLowerCase(), now)
    return { hash, amount: FAUCET_AMOUNT_USD }
  } finally {
    inFlight = false
  }
}
