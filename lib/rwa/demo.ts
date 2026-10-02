// V2-RWAs — the one home for the demo liquidity units' recorded facts (addresses + every proof hash), one
// unit per chain. Sources of truth (written by scripts/rwa-demo-lifecycle.mjs after a real run; never hand-edit):
//   Base Sepolia      → config/rwaDemo.json
//   XRPL EVM testnet  → config/rwaDemo.xrpl.json   (RWA_NETWORK=xrpl-evm-testnet)
// Testnet + unaudited: the hashes are real, the property is fictional, every token is valueless.

import baseDemo from '@/config/rwaDemo.json'
import xrplDemo from '@/config/rwaDemo.xrpl.json'

export type RwaRevertReason = { error: string; target: string | null; args: string[] }
export type RwaProofTx = { label: string; hash: string; status: 'success' | 'reverted'; from?: string; block?: number; reason?: RwaRevertReason }
export type RwaProofLeg = { n: number; title: string; desc: string; txs: RwaProofTx[] }

export type RwaDemo = {
  generatedAt: string
  chainId: number
  property: { name: string; symbol: string; appraisalUsdAtLaunch: number; decimals: number }
  contracts: {
    vault: string; hook: string; property: string; usd: string; adapter: string
    registry: string; router: string; poolManager: string
  }
  poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }
  propertyIsCurrency0: boolean
  poolManagerDeployedByUs?: boolean
  wallets: Record<string, { label: string; address: string }>
  issuer: string
  hookConfig: {
    coreBandTicks: number; specBandTicks: number; maxStepTicks: number
    minUpdateInterval: number; maxAppraisalAge: number; coreFeePips: number; specFeePips: number
    maxDriftTicksPerDay?: number; oracleGraceSecs?: number
  } | null
  deployTxs: { label: string; hash: string; block?: number }[]
  snapshot: Record<string, string>
  legs: RwaProofLeg[]
}

export type RwaChain = {
  id: number
  name: string
  short: string
  explorer: string
  /** where contract source is verified: BaseScan for most of Base, Blockscout for the hook + all of XRPL EVM */
  blockscout: string
  nativeSymbol: string
}

export type RwaUnit = {
  slug: string
  network: 'base-sepolia' | 'xrpl-evm-testnet'
  chain: RwaChain
  demo: RwaDemo
  /** the "run a live trade" button + background activity run on this unit */
  liveTrade: boolean
}

export const RWA_UNITS: RwaUnit[] = [
  {
    slug: 'wcp7',
    network: 'base-sepolia',
    chain: { id: 84532, name: 'Base Sepolia', short: 'Base', explorer: 'https://sepolia.basescan.org', blockscout: 'https://base-sepolia.blockscout.com', nativeSymbol: 'ETH' },
    demo: baseDemo as unknown as RwaDemo,
    liveTrade: true,
  },
  {
    slug: 'wcp7-xrpl',
    network: 'xrpl-evm-testnet',
    chain: { id: 1449000, name: 'XRPL EVM Testnet', short: 'XRPL EVM', explorer: 'https://explorer.testnet.xrplevm.org', blockscout: 'https://explorer.testnet.xrplevm.org', nativeSymbol: 'XRP' },
    demo: xrplDemo as unknown as RwaDemo,
    liveTrade: false,
  },
]

export const getUnit = (slug: string): RwaUnit | undefined => RWA_UNITS.find((u) => u.slug === slug.toLowerCase())

/** Back-compat: the Base Sepolia unit (the live-trade button + activity script trade here). */
export const RWA_DEMO = RWA_UNITS[0].demo
export const RWA_CHAIN = RWA_UNITS[0].chain

/** Plain-English text for a refusal, from the revert the lifecycle script DECODED on-chain (`tx.reason`). */
const RULE_TEXT: Record<string, string> = {
  NotPermitted: 'the property token refused to deliver to an unverified wallet',
  PriceOutOfBand: 'the hook refused a trade that would end outside the appraisal band',
  AppraisalStale: 'the hook halts trading while the appraisal is stale',
  TradingIsPaused: 'trading is paused by the guardian',
}
export function revertReasonText(t: RwaProofTx): string | null {
  if (t.status !== 'reverted') return null
  if (!t.reason) return 'reverted on-chain (reason not recorded for this run)'
  return `${t.reason.error}: ${RULE_TEXT[t.reason.error] ?? 'reverted on-chain'} (decoded from the chain)`
}

export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h)

/** Explorer links for one unit's chain. */
export function explorer(u: RwaUnit) {
  const isXrpl = u.network === 'xrpl-evm-testnet'
  return {
    tx: (hash: string) => `${u.chain.explorer}/tx/${hash}`,
    addr: (addr: string) => `${u.chain.explorer}/address/${addr}`,
    /** BaseScan rejects the factory-CREATE2'd hook although its metadata matches the source; Blockscout verifies it. */
    source: (key: string, addr: string) =>
      isXrpl || key === 'hook' ? `${u.chain.blockscout}/address/${addr}?tab=contract` : `${u.chain.explorer}/address/${addr}#code`,
  }
}

/** Back-compat Base helpers. */
export const txUrl = (hash: string) => explorer(RWA_UNITS[0]).tx(hash)
export const addrUrl = (addr: string) => explorer(RWA_UNITS[0]).addr(addr)
export const codeUrl = (addr: string) => `${RWA_CHAIN.explorer}/address/${addr}#code`
export const verifiedSourceUrl = (key: string, addr: string) => explorer(RWA_UNITS[0]).source(key, addr)

/** USD price of one property token at a pool tick (6-dp USD quote, 18-dp property). */
export function tickToUsd(tick: number, propertyIsCurrency0 = RWA_DEMO.propertyIsCurrency0): number {
  const p = Math.pow(1.0001, tick) // currency1 per currency0, raw units
  return (propertyIsCurrency0 ? p : 1 / p) * 1e12
}

/** The verified demo-trader Privy wallet behind the "run a live trade" button + the activity script (Base). */
export const RWA_DEMO_TRADER = '0x65398D823cB346aa4CCd4774223F96E303360bAC'

/** Human label for a demo wallet on a unit, else a short address. */
export function walletLabel(addr: string, demo: RwaDemo = RWA_DEMO): string {
  const a = addr.toLowerCase()
  if (a === demo.issuer.toLowerCase()) return 'Issuer'
  if (a === RWA_DEMO_TRADER.toLowerCase()) return 'Demo trader (live)'
  for (const w of Object.values(demo.wallets)) if (w.address.toLowerCase() === a) return w.label.replace(/^.* · /, '')
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export const RWA_CONTRACT_ROWS: { name: string; role: string; key: keyof RwaDemo['contracts'] }[] = [
  { name: 'MintwareTreasuryVault', role: 'Liquidity vault: senior USD + issuer junior, unchanged V2 code', key: 'vault' },
  { name: 'MintwareRwaAppraisalHook', role: 'Uniswap v4 hook: appraisal band, band fee, vault oracle, exit window', key: 'hook' },
  { name: 'MockPermissionedPropertyToken', role: 'Property token (testnet stand-in): refuses unverified holders', key: 'property' },
  { name: 'MockRwaIdentityRegistry', role: 'Identity registry (testnet stand-in for the issuer’s)', key: 'registry' },
  { name: 'DemoLendingAdapter', role: 'Lending venue: idle senior earns (simulated testnet yield)', key: 'adapter' },
  { name: 'DemoUSD', role: 'Valueless 6-dp testnet dollar', key: 'usd' },
  { name: 'DemoSwapRouter', role: 'Demo router: stands in for the issuer’s licensed front end', key: 'router' },
]

/** Contract rows for a unit — adds the v4 PoolManager when we deployed it ourselves (chain has no Uniswap v4). */
export function contractRows(u: RwaUnit) {
  return u.demo.poolManagerDeployedByUs
    ? [...RWA_CONTRACT_ROWS, { name: 'PoolManager (v4-core)', role: 'Our testnet deployment of Uniswap v4-core (BUSL-1.1) — this chain has no Uniswap v4', key: 'poolManager' as const }]
    : RWA_CONTRACT_ROWS
}
