// Single source of truth for the /proof page — the most recent end-to-end testnet run of the YPN loop.
// After each fresh live run, update THIS file (dates, hashes, deltas, test counts) and the page reflects it.
// Everything here is testnet + unaudited; the hashes are real, the dollars are valueless test USDC.

export type Chain = 'arc' | 'base-sepolia'

export function txUrl(chain: Chain, hash: string): string {
  return chain === 'arc'
    ? `https://testnet.arcscan.app/tx/${hash}`
    : `https://sepolia.basescan.org/tx/${hash}`
}
export function addrUrl(chain: Chain, addr: string): string {
  return chain === 'arc'
    ? `https://testnet.arcscan.app/address/${addr}`
    : `https://sepolia.basescan.org/address/${addr}`
}
/** Middle-truncate a 66-char hash for display: 0x1234…abcd */
export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h
}

export type ProofTx = { label: string; chain: Chain; hash: string; note?: string }
export type ProofDelta = { k: string; before?: string; after: string }
export type Decision = { req: string; kind: 'ok' | 'warn' | 'stop'; label: string; reason: string; latency: string }

export type ProofLeg = {
  n: number
  title: string
  where: string
  status: 'proven' | 'service'
  statusLabel: string
  desc: string
  deltas?: ProofDelta[]
  decisions?: Decision[]
  txs?: ProofTx[]
}

export type LatestRun = {
  date: string
  networkLabel: string
  signer: string
  legs: ProofLeg[]
  tests: { value: string; sub: string; label: string }[]
  contracts: { name: string; chain: Chain; short: string; address: string }[]
  // The live vault whose current NAV the page reads on load, so the page reflects on-chain state now.
  liveVault: { chain: Chain; address: string; label: string }
}

const VAULT = '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421'
const GATEWAY = '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399'
const ADAPTER = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88'
const CCTP_ROUTER = '0xDB9DB7008cfFb09bD1D943C237f57327383DFc03'
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

export const LATEST_RUN: LatestRun = {
  date: '2026-08-19',
  networkLabel: 'Arc testnet (5042002) + Base Sepolia (84532)',
  signer: '0x9c646C48a302f4725450669f1218d3FDb3e933AD',
  liveVault: { chain: 'arc', address: VAULT, label: 'YPN treasury vault · Arc' },

  legs: [
    {
      n: 1,
      title: 'Deposit & earn',
      where: 'Arc · MintwareYieldVault 0x11Ef…C421',
      status: 'proven',
      statusLabel: 'Proven on Arc',
      desc: '5 USDC deposited into the treasury vault. The same transaction routed it through the adapter into the yield source — the capital went straight to work rather than sitting idle.',
      deltas: [
        { k: 'Vault total assets', before: '2.00', after: '7.00 USDC' },
        { k: 'Signer vault shares', before: '2.00', after: '7.00' },
        { k: 'Capital earning in yield source', before: '2.00', after: '7.00 USDC' },
      ],
      txs: [
        { label: 'Approve', chain: 'arc', hash: '0x529e20de769ed12a45db196db2716dec1e9dcccfe0695e8a3bb60a7ec0ca612f' },
        { label: 'Deposit', chain: 'arc', hash: '0x9d34c116290761e4bb35f78de1a3c36039e98b1e32c6cb0e496592d8daa58449' },
      ],
    },
    {
      n: 2,
      title: 'Authorize — sub-10 ms, off live NAV',
      where: 'edge-auth → live Arc NAV (7.00 USDC backing)',
      status: 'service',
      statusLabel: 'Live service',
      desc: 'The Rust edge-auth service, pointed at the live Arc vault, decided each spend off the real NAV — reserving a hold on approval, failing closed otherwise. Off-chain, so no tx hash; these are the running service’s live responses.',
      decisions: [
        { req: '$2.00', kind: 'ok', label: 'Approved', reason: 'hold reserved · headroom 7→5', latency: '7.2 ms' },
        { req: '$10.00', kind: 'warn', label: 'Declined', reason: 'insufficient_equity (over 5 headroom)', latency: '6.9 ms' },
        { req: '$300.00', kind: 'warn', label: 'Declined', reason: 'high-value lane · 2nd-signer absent → fail-closed', latency: '6.1 ms' },
        { req: '$2.00 · no bearer', kind: 'stop', label: '401', reason: 'fail-closed: endpoint reserves equity', latency: '—' },
      ],
    },
    {
      n: 3,
      title: 'Settle — spend as USDC',
      where: 'Arc · MintwarePaymentGateway 0x1D07…5399',
      status: 'proven',
      statusLabel: 'Proven on Arc',
      desc: 'A signed EIP-712 spend permit → the gateway burned exactly the shares needed and paid the merchant 2 USDC. The event trace unwinds the earn path in reverse (yield source redeemed → adapter → vault → merchant) — the dollars came out of the earning position at the moment of the spend.',
      deltas: [
        { k: 'Merchant USDC received', before: '0.00', after: '2.00 USDC' },
        { k: 'Signer vault shares', before: '7.00', after: '5.00' },
        { k: 'Vault total assets', before: '7.00', after: '5.00 USDC' },
      ],
      txs: [
        { label: 'Point card rail', chain: 'arc', hash: '0x9879e7faefcdfd3fa469a5aed0d2f8f6bdc8f428e2a0b22fd711d71a85d01420' },
        { label: 'settleSpend', chain: 'arc', hash: '0x7fd4b3f0db0e01ebf04c8e59147c725f6e5aa77717ae828ff347e626d67c6934', note: 'PaymentSettled' },
      ],
    },
    {
      n: 4,
      title: 'Bridge — native USDC, Base → Arc',
      where: 'Base Sepolia → CCTP domain 26 (Arc)',
      status: 'proven',
      statusLabel: 'Proven end-to-end',
      desc: '1 USDC burned on Base Sepolia through Circle’s CCTP v2, attested by Circle (~22 min, standard finality), then minted natively on Arc and deposited straight into the vault as yield-earning shares. Bridged capital arrived already earning.',
      deltas: [
        { k: 'Bridged USDC minted on Arc', after: '1.00 USDC' },
        { k: 'Vault total assets', before: '5.00', after: '6.00 USDC' },
        { k: 'Recipient vault shares', before: '5.00', after: '6.00' },
      ],
      txs: [
        { label: 'Approve (Base)', chain: 'base-sepolia', hash: '0xff7318e4d0d72232be204a7350b28f2200dca6b36269df4107f885d89851c18d' },
        { label: 'Burn (Base)', chain: 'base-sepolia', hash: '0xc7a0d7c3ea5c7ec0ce3d75c08d2c8cba860e596cc54c0c1a38367c6de2031df9', note: 'depositForBurn' },
        { label: 'Receive (Arc)', chain: 'arc', hash: '0xf99b2d6faf0f1dd09598f9c0159c301c45e6f7456a5db9b65eeff8746a3d4796', note: 'BridgedAndDeposited' },
      ],
    },
  ],

  tests: [
    { value: '502', sub: '/ 0', label: 'Forge tests pass / fail · incl. staged-router suite (6 fork skips)' },
    { value: '109', sub: 'Rust', label: 'edge-auth 86 · relayer 23 — all pass' },
    { value: '7', sub: '/ 7', label: 'MEV + solvency invariants · 256 × 128k' },
    { value: '~10', sub: 'ms', label: 'edge-auth decision, off live NAV' },
  ],

  contracts: [
    { name: 'Treasury vault', chain: 'arc', short: '0x11Ef…C421', address: VAULT },
    { name: 'Payment gateway', chain: 'arc', short: '0x1D07…5399', address: GATEWAY },
    { name: 'Yield adapter', chain: 'arc', short: '0xb9FB…2B88', address: ADAPTER },
    { name: 'CCTP deposit router', chain: 'arc', short: '0xDB9D…Fc03', address: CCTP_ROUTER },
    { name: 'CCTP TokenMessenger', chain: 'base-sepolia', short: '0x8FE6…2DAA', address: TOKEN_MESSENGER },
  ],
}

// ── Second proven flow: the staged-buffer liquidity loop ────────────────────────────────────────
// A team that holds ONE side parks it (it earns), then pairs into a pool when they bring the other
// side. Proven live on Base Sepolia against a self-contained mock rig (open-mint token + yield
// adapter + pair vault) — the router itself is the real product bytecode. See config/stagedRouter.ts.

export type ProofFlow = {
  date: string
  eyebrow: string
  title: string
  titleAccent: string
  subtitle: string
  legs: ProofLeg[]
  contracts: { name: string; chain: Chain; short: string; address: string }[]
}

const S_ROUTER = '0x36fa7d533dC94A9b0648EeEC935e127d7F5533e3'
const S_TOKEN = '0xE2362BAc754C372F25eCA9850B8eFe0530D38401'
const S_ADAPTER = '0xe412678FF19D46C4B0682B58D14b48879ad00B5F'
const S_VAULT = '0xB0144C6c033F5480619851eDF13ff1034707D2F7'

export const STAGED_LIQUIDITY_RUN: ProofFlow = {
  date: '2026-08-19',
  eyebrow: 'Staged liquidity · executed on-chain',
  title: 'Stage one side, earn,',
  titleAccent: 'pair when ready.',
  subtitle:
    'The capital-constrained liquidity path, run live on Base Sepolia. A team parks the single side it holds; it earns while it waits; then one call forms the pool — and the yield it earned flowed into the position, not away.',
  legs: [
    {
      n: 1,
      title: 'Stage a single side',
      where: 'Base Sepolia · MintwareStagedLiquidityRouter 0x36fa…33e3',
      status: 'proven',
      statusLabel: 'Proven on Base Sepolia',
      desc: '1,000 sUSD — the one side the team holds — was staged into the router and supplied to the yield adapter in the same action. No 50/50, no forced swap, no second asset required.',
      deltas: [
        { k: 'Staged principal', before: '0', after: '1,000 sUSD' },
        { k: 'Earning in yield adapter', before: '0', after: '1,000 sUSD' },
      ],
      txs: [
        { label: 'Approve', chain: 'base-sepolia', hash: '0x7a53677d7b573e0286144a9cf146429e563d6e0114815960702d385f7f05059e' },
        { label: 'Stage', chain: 'base-sepolia', hash: '0x3ab38f65436f9f750bcbc7cc8b210a48d5155e32827b7cd4bbe9b3a1ff169c37' },
      ],
    },
    {
      n: 2,
      title: 'It earns while it waits',
      where: 'router · per-adapter yield pool',
      status: 'proven',
      statusLabel: 'Proven on Base Sepolia',
      desc: 'Yield accrued to the staged position. The router’s on-chain stagedAssets read reflects principal plus its pro-rata share of the yield — the buffer was productive from the first block, never idle.',
      deltas: [{ k: 'Staged value (stagedAssets)', before: '1,000.00', after: '1,099.99 sUSD' }],
      txs: [{ label: 'Accrue yield', chain: 'base-sepolia', hash: '0x92b9ba8fc24f9e1a74ae5fdd13b32ddf16133d80bf9053f7d5f9bf5007dda17e', note: 'yield to adapter' }],
    },
    {
      n: 3,
      title: 'Pair into the pool',
      where: 'Base Sepolia · router → pair vault',
      status: 'proven',
      statusLabel: 'Proven on Base Sepolia',
      desc: 'The owner brought the other side (2,000 TKA). One call pulled the staged side back with its earned yield, paired both, and minted LP straight to the owner — the yield went into the position, and the stage closed.',
      deltas: [
        { k: 'Staged side paired (with yield)', after: '1,099.99 sUSD' },
        { k: 'Counterparty paired', after: '2,000 TKA' },
        { k: 'LP minted to owner', before: '0', after: '3,099.99' },
        { k: 'Stage status', before: 'earning', after: 'paired ✓' },
      ],
      txs: [{ label: 'Pair', chain: 'base-sepolia', hash: '0x02b3cbb6d49a914f805847b581f9bb770f9feaa0f56b08df22a07643343b8247', note: 'Paired' }],
    },
  ],
  contracts: [
    { name: 'Staged router', chain: 'base-sepolia', short: '0x36fa…33e3', address: S_ROUTER },
    { name: 'Staged token (sUSD)', chain: 'base-sepolia', short: '0xE236…8401', address: S_TOKEN },
    { name: 'Yield adapter', chain: 'base-sepolia', short: '0xe412…0B5F', address: S_ADAPTER },
    { name: 'Pair vault', chain: 'base-sepolia', short: '0xB014…D2F7', address: S_VAULT },
  ],
}
