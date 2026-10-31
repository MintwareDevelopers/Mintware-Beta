// Read-only snapshot of an org's Treasury yield vault (MintwareYieldVault, a standard ERC-4626 Earn vault) via
// eth_call — no wallet, no writes. Positions are held by members' own wallets (the fund page deposits with
// receiver = the connected wallet), so the snapshot is the vault's total assets plus a member's own redeemable
// value. The retired Treasury senior/junior vault (coverage, junior buffer, par-while-covered) is no longer read.
//
// Selectors are the standard ERC-4626 / ERC-20 / Ownable ones (contracts-v4/src/payments/MintwareYieldVault.sol).

const SEL = {
  asset: '0x38d52e0f', //           asset()                — the vault's underlying (USDC)
  totalAssets: '0x01e1d114', //     totalAssets()          — everything supplied to the vault (atomic 6dp)
  balanceOf: '0x70a08231', //       balanceOf(address)     — a member's vault shares
  convertToAssets: '0x07a2d13a', // convertToAssets(uint256)
  owner: '0x8da5cb5b', //           owner()                — Ownable config authority
} as const

function padAddr(a: string): string {
  return a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}
function padWord(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

export interface TreasurySnapshot {
  /** Total supplied to the Treasury yield vault, atomic USDC 6dp. */
  navUsdc: bigint
}

/** RPC per chain for public reads. Base Sepolia → publicnode (dodges the stale-mempool node).
 *  (Arc testnet was dropped 2026-08-27.) Returns null for an unknown chain. */
export function rpcForChain(chainId: number | null | undefined): string | null {
  if (chainId === 84532) return process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com'
  if (chainId === 8453) return process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com'
  return null
}

/** If `addr` is a Gnosis Safe (multisig), return its threshold + owners; else null. Lets the app show
 *  "owned by your N-of-M multisig" (P3 L2) instead of a single key. Reads getThreshold()/getOwners(). */
export async function readSafeInfo(
  rpcUrl: string,
  addr: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ threshold: number; owners: string[] } | null> {
  async function call(data: string): Promise<string | null> {
    try {
      const res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addr, data }, 'latest'] }),
      })
      const j = (await res.json()) as { result?: string; error?: unknown }
      if (j.error || !j.result || j.result === '0x') return null
      return j.result
    } catch { return null }
  }
  const thr = await call('0xe75235b8') // getThreshold()
  if (!thr) return null // not a Safe (or doesn't answer) → treat as a plain key
  const threshold = Number(BigInt(thr))
  const owners: string[] = []
  const own = await call('0xa0e67e2b') // getOwners() → address[]
  if (own) {
    const hex = own.replace(/^0x/, '')
    const len = Number(BigInt('0x' + hex.slice(64, 128))) // word[0]=offset, word[1]=length
    for (let i = 0; i < len; i++) {
      owners.push('0x' + hex.slice(128 + i * 64, 128 + i * 64 + 64).slice(24))
    }
  }
  return { threshold, owners }
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
    /** Vault-wide snapshot. Also proves the address answers as an ERC-4626 vault (asset() + totalAssets()). */
    async snapshot(): Promise<TreasurySnapshot> {
      const [, nav] = await Promise.all([call(SEL.asset), call(SEL.totalAssets)])
      return { navUsdc: nav }
    },
    /** The on-chain config owner (Ownable). Lets the app VERIFY the treasury is actually
     *  controlled by the org owner's (Privy) wallet — the P3 control check. */
    async owner(): Promise<string> {
      const raw = await call(SEL.owner)
      return '0x' + raw.toString(16).padStart(40, '0')
    },
    /** A member's own redeemable value = convertToAssets(balanceOf(member)), atomic 6dp. */
    async memberSuppliedUsdc(member: string): Promise<bigint> {
      const sh = await call(SEL.balanceOf + padAddr(member))
      if (sh === 0n) return 0n
      return call(SEL.convertToAssets + padWord('0x' + sh.toString(16)))
    },
  }
}
