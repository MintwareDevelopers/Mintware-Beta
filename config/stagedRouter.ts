// Deployed MintwareStagedLiquidityRouter (staged-buffer pairing) — one home for its addresses.
//
// LIVE ON BASE SEPOLIA (testnet, unaudited — 2026-08-19). The router itself is the real product
// bytecode. The `demo` stack below is a SELF-CONTAINED proof rig — a MockERC20 pair + a MockYieldAdapter
// + a MockPairVault — that exercises the router end-to-end on-chain (stage → earn → pair) without an
// Aave faucet. The real Aave adapter (`AaveV3YieldAdapter`) + `MintwareDeFiPairVault` implement the
// exact same `IYieldAdapter` / `IPairVaultLike` interfaces the router calls (Forge-tested; wired by the
// `deploy-pair-full-testnet` route), so the loop proven here is the loop that runs in production.
// NOT an offer; nothing here holds real value.

export const STAGED_ROUTER = {
  chainId: 84532, // Base Sepolia
  router: '0x36fa7d533dC94A9b0648EeEC935e127d7F5533e3',

  // Self-contained testnet proof rig (mock yield source + mock pair vault, 18-decimals).
  demo: {
    stagedToken: '0xE2362BAc754C372F25eCA9850B8eFe0530D38401', // sUSD — the single side you park
    counterToken: '0x002db20A565cB0F64fe8e25cCCC7AbD00c02c8b1', // TKA — the other side you bring at pair time
    adapter: '0xe412678FF19D46C4B0682B58D14b48879ad00B5F',      // MockYieldAdapter (dedicated to the router)
    pairVault: '0xB0144C6c033F5480619851eDF13ff1034707D2F7',    // MockPairVault (token0=TKA, token1=sUSD)
    stagedIsToken0: false,                                        // sUSD is token1
  },

  // First proven loop (real Base Sepolia txs, 2026-08-19): staged 1000 sUSD → accrued to ~1099.99 →
  // paired with 2000 TKA → LP minted to owner; the staged yield flowed into the pool.
  proof: {
    routerDeployTx: '0xf797c1f7a6ffe7a04ff63246c8522805ce9a9f2eef3040616021a52efda70926',
    stageTx: '0x3ab38f65436f9f750bcbc7cc8b210a48d5155e32827b7cd4bbe9b3a1ff169c37',
    accrueTx: '0x92b9ba8fc24f9e1a74ae5fdd13b32ddf16133d80bf9053f7d5f9bf5007dda17e',
    pairTx: '0x02b3cbb6d49a914f805847b581f9bb770f9feaa0f56b08df22a07643343b8247',
  },
} as const

export function stagedRouterBasescan(addr: string): string {
  return `https://sepolia.basescan.org/address/${addr}`
}
export function stagedRouterTx(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`
}
