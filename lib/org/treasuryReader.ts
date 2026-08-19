// Read-only treasury snapshot off a converged MintwareTreasuryVault via eth_call — no wallet, no writes.
// Mirrors lib/x402/vaultReader. Senior is PAR (community/member USDC redeemable ~1:1, spendable); the
// junior tranche (the org itself) earns the spread. So a member's `seniorShares` realize at par via
// `convertToAssets`, and the treasury's health is `coverageBps` (junior coverage of at-risk senior).
//
// Selectors verified with `cast sig` against contracts-v4/src/payments/MintwareTreasuryVault.sol.

const SEL = {
  totalSeniorAssets: '0xdf43a90f', // totalSeniorAssets()   — par-backed senior NAV (atomic 6dp)
  coverageBps: '0x48ebfe9c', //       coverageBps()          — junior coverage of at-risk senior
  deployedFromSenior: '0x9655bfbc', //deployedFromSenior()
  juniorUsdcBuffer: '0xfa0f2b74', //  juniorUsdcBuffer()
  seniorShares: '0x6e4a7e08', //      seniorShares(address)
  convertToAssets: '0x07a2d13a', //   convertToAssets(uint256)
  owner: '0x8da5cb5b', //             owner()                — Ownable config authority
} as const

const MAX_UINT = (1n << 256n) - 1n

function padAddr(a: string): string {
  return a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}
function padWord(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

export interface TreasurySnapshot {
  /** Par-backed senior NAV (what all member claims sum to), atomic USDC 6dp. */
  navUsdc: bigint
  /** Junior coverage of the at-risk senior, in bps. MAX_UINT when nothing is deployed (fully covered). */
  coverageBps: bigint
  /** At-risk senior currently deployed to LP, atomic 6dp. */
  deployedUsdc: bigint
  /** Junior first-loss USDC buffer, atomic 6dp. */
  juniorBufferUsdc: bigint
  /** coverage >= 100% (or nothing deployed). The "backed & solvent" signal. */
  fullyCovered: boolean
}

/** RPC per chain for public reads. Base Sepolia → publicnode (dodges the stale-mempool node);
 *  Arc testnet → the pinned RPC. Returns null for an unknown chain. */
export function rpcForChain(chainId: number | null | undefined): string | null {
  if (chainId === 5042002) return 'https://rpc.testnet.arc.io'
  if (chainId === 84532) return process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com'
  if (chainId === 8453) return process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com'
  return null
}

export function makeTreasuryReader(cfg: { rpcUrl: string; vault: string; fetchImpl?: typeof fetch }) {
  const f = cfg.fetchImpl ?? fetch
  async function call(data: string): Promise<bigint> {
    const res = await f(cfg.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: cfg.vault, data }, 'latest'] }),
    })
    const j = (await res.json()) as { result?: string; error?: { message?: string } }
    if (j.error) throw new Error(`eth_call: ${j.error.message ?? 'error'}`)
    if (!j.result || j.result === '0x') throw new Error('eth_call empty result')
    return BigInt(j.result)
  }
  return {
    /** Treasury-wide snapshot: NAV, coverage, deployed, junior buffer. */
    async snapshot(): Promise<TreasurySnapshot> {
      const [nav, cov, dep, jr] = await Promise.all([
        call(SEL.totalSeniorAssets),
        call(SEL.coverageBps),
        call(SEL.deployedFromSenior),
        call(SEL.juniorUsdcBuffer),
      ])
      return {
        navUsdc: nav,
        coverageBps: cov,
        deployedUsdc: dep,
        juniorBufferUsdc: jr,
        fullyCovered: cov === MAX_UINT || cov >= 10_000n,
      }
    },
    /** The on-chain config owner (Ownable). Lets the app VERIFY the treasury is actually
     *  controlled by the org owner's (Privy) wallet — the P3 control check. */
    async owner(): Promise<string> {
      const raw = await call(SEL.owner)
      return '0x' + raw.toString(16).padStart(40, '0')
    },
    /** A member's par-safe realizable balance = convertToAssets(seniorShares(member)), atomic 6dp. */
    async memberRealizableUsdc(member: string): Promise<bigint> {
      const sh = await call(SEL.seniorShares + padAddr(member))
      if (sh === 0n) return 0n
      return call(SEL.convertToAssets + padWord('0x' + sh.toString(16)))
    },
  }
}
