// V2-RWAs — the one home for the demo liquidity unit's recorded facts (addresses + every proof hash).
// Source of truth: config/rwaDemo.json, written by scripts/rwa-demo-lifecycle.mjs after a real run on
// Base Sepolia. Re-run the scripts and this updates; never hand-edit hashes. Testnet + unaudited:
// the hashes are real, the property is fictional, every token is valueless.

import demo from '@/config/rwaDemo.json'

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

export const RWA_DEMO = demo as unknown as RwaDemo

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

export const RWA_CHAIN = { id: 84532, name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org' } as const
export const txUrl = (hash: string) => `${RWA_CHAIN.explorer}/tx/${hash}`
export const addrUrl = (addr: string) => `${RWA_CHAIN.explorer}/address/${addr}`
export const codeUrl = (addr: string) => `${RWA_CHAIN.explorer}/address/${addr}#code`
export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h)

/** USD price of one property token at a pool tick (6-dp USD quote, 18-dp property). */
export function tickToUsd(tick: number, propertyIsCurrency0 = RWA_DEMO.propertyIsCurrency0): number {
  const p = Math.pow(1.0001, tick) // currency1 per currency0, raw units
  return (propertyIsCurrency0 ? p : 1 / p) * 1e12
}

/** The verified demo-trader Privy wallet behind the "run a live trade" button + the activity script. */
export const RWA_DEMO_TRADER = '0x65398D823cB346aa4CCd4774223F96E303360bAC'

/** Human label for a demo wallet, else a short address. */
export function walletLabel(addr: string): string {
  const a = addr.toLowerCase()
  if (a === RWA_DEMO.issuer.toLowerCase()) return 'Issuer'
  if (a === RWA_DEMO_TRADER.toLowerCase()) return 'Demo trader (live)'
  for (const w of Object.values(RWA_DEMO.wallets)) if (w.address.toLowerCase() === a) return w.label.replace(/^.* · /, '')
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export const RWA_CONTRACT_ROWS: { name: string; role: string; key: keyof RwaDemo['contracts'] }[] = [
  { name: 'MintwareTreasuryVault', role: 'Liquidity vault: senior USD + issuer junior, unchanged V2 code', key: 'vault' },
  { name: 'MintwareRwaAppraisalHook', role: 'Uniswap v4 hook: appraisal band, band fee, vault oracle', key: 'hook' },
  { name: 'MockPermissionedPropertyToken', role: 'Property token (testnet stand-in): refuses unverified holders', key: 'property' },
  { name: 'MockRwaIdentityRegistry', role: 'Identity registry (testnet stand-in for the issuer’s)', key: 'registry' },
  { name: 'DemoLendingAdapter', role: 'Lending venue: idle senior earns (simulated testnet yield)', key: 'adapter' },
  { name: 'DemoUSD', role: 'Valueless 6-dp testnet dollar', key: 'usd' },
  { name: 'DemoSwapRouter', role: 'Demo router: stands in for the issuer’s licensed front end', key: 'router' },
]
