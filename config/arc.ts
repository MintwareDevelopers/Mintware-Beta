// Arc (Circle's USDC-native L1) — the YPN SETTLEMENT / SPEND chain.
//
// The earn side (Uniswap-v4 ETH pools, collateral, MEV) stays on Base; Arc is the spend side — USDC is the
// gas token, settlement is sub-second, and the card off-ramp runs through Circle's rails. CCTP bridges USDC
// between the two. The YPN contracts are chain-agnostic (EIP-712 reads `block.chainid`), so NOTHING here is
// compiled into a contract — this is purely deploy/runtime wiring, env-driven, and filled in once Arc
// testnet access + the spend-stack deploy (`DeployArcSpendStack.s.sol`) land.

/** Arc testnet chain id (public — Circle / Arc docs). */
export const ARC_CHAIN_ID = 5042002

/**
 * Public Arc TESTNET constants (source: docs.arc.io + developers.circle.com, 2026-08). All of this is
 * public developer documentation — no Circle relationship required. Env vars override for prod/rotation.
 */
export const ARC_TESTNET = {
  chainId: ARC_CHAIN_ID,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app',
  faucet: 'https://faucet.circle.com',
  usdc: '0x3600000000000000000000000000000000000000', // Arc testnet USDC (6dp)
  // Arc's yield primitive — XyloNet's XyloVault (auto-compounding ERC-4626 USDC vault, by ForgeLabs,
  // live on Arc testnet; xylonet.xyz/vault). VERIFIED ON-CHAIN 2026-08-18 via rpc.testnet.arc.io:
  //   asset()=0x3600…0000 (Arc USDC)   symbol()="xyUSDC"   decimals()=18   totalAssets()≈8.27M USDC (funded)
  // ⚠ LIVE-SMOKE-TESTED 2026-08-18 (deposit→redeem round-trip, txs on-chain) — it is a NON-STANDARD 4626:
  //   • withdrawFee()=10 (0.10% exit) + performanceFee()=1000 (10% on yield).
  //   • convertToAssets()/maxWithdraw() DO NOT net the withdraw fee → they OVER-REPORT realizable NAV;
  //     previewRedeem()/previewWithdraw() DO net it. maxWithdraw over-reports, so withdraw(assets) REVERTS
  //     (`INSUFFICIENT_BALANCE`) near full balance — **redeem(shares) is the only working exit.**
  //   Consequence: NOT a drop-in for a par-spendable settlement vault. Before wiring, MintwareERC4626YieldAdapter
  //   must (1) value totalAssets via previewRedeem (fee-net, conservative) and (2) exit via redeem(shares).
  //   See docs/developers/session-handoff-arc.md → "what's left #1".
  xyloVault: '0x240Eb85458CD41361bd8C3773253a1D78054f747',
  // CCTP v2 (public — Circle CCTP docs). Arc's CCTP domain id is 26.
  cctpDomain: 26,
  cctpTokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  cctpMessageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
} as const

/**
 * YPN spend stack — LIVE on Arc testnet (deployed 2026-08-16, verified on-chain; deposit→earn smoke passed
 * with real Arc USDC). Yield source is a placeholder mock 4626 until Arc's real yield primitive is wired.
 * Explorer: https://testnet.arcscan.app/address/<addr>
 */
export const ARC_TESTNET_DEPLOYMENT = {
  vault: '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421',
  gateway: '0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399',
  adapter: '0xb9FB965Caa7197932b52631e0121Ea54586e2B88',
  cctpDepositRouter: '0xDB9DB7008cfFb09bD1D943C237f57327383DFc03',
  yieldSourceMock: '0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE',
  deployer: '0x9c646C48a302f4725450669f1218d3FDb3e933AD',
} as const

export interface ArcSettlementConfig {
  chainId: number
  name: string
  /** ARC_RPC_URL — from Circle (testnet access). */
  rpcUrl?: string
  /** Real USDC on Arc. */
  usdc?: string
  /** Arc's yield primitive as an ERC-4626 over USDC (slots into MintwareERC4626YieldAdapter).
   *  CONFIRMED address: XyloNet's **XyloVault** at `ARC_TESTNET.xyloVault`
   *  (`0x240Eb85458CD41361bd8C3773253a1D78054f747`), verified + live-smoke-tested on-chain 2026-08-18.
   *  ⚠ NOT a clean drop-in — the smoke test found XyloVault is a non-standard 4626 (0.10% withdrawFee +
   *  10% performanceFee; convertToAssets/maxWithdraw over-report because they ignore the fee, and
   *  withdraw(assets) reverts near full balance — redeem(shares) is the working exit). See the ⚠ block on
   *  `ARC_TESTNET.xyloVault` above. So the redeploy is gated on a fee-aware adapter change (totalAssets via
   *  previewRedeem; exit via redeem). Once that lands, it IS a one-line redeploy:
   *    `ARC_YIELD_SOURCE=0x240Eb85458CD41361bd8C3773253a1D78054f747 \
   *       forge script contracts-v4/script/DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow`
   *  Until then keep the mock 4626. Arc public mainnet: Sept 16, 2026. */
  yieldSource?: string
  /** Deployed MintwarePaymentGateway (the settleSpend entrypoint). */
  gateway?: string
  /** Deployed MintwareYieldVault (single-asset USDC). */
  vault?: string
  /** Circle Payments Network settlement address (the card off-ramp recipient). */
  cpnTreasury?: string
  /** CCTP MessageTransmitter on Arc (destination side — mints bridged USDC). */
  cctpMessageTransmitter?: string
  /** Deployed MintwareCctpDepositRouter on Arc (bridge-and-deposit). */
  cctpDepositRouter?: string
}

/** CCTP domain ids (public — Circle CCTP docs). Base is 6; Arc is 26. */
export const CCTP_DOMAIN = {
  base: 6,
  arc: Number(process.env.ARC_CCTP_DOMAIN ?? ARC_TESTNET.cctpDomain),
} as const

export const ARC: ArcSettlementConfig = {
  chainId: ARC_CHAIN_ID,
  name: 'Arc',
  // Public testnet defaults; env overrides for prod / rotation / provider RPCs.
  rpcUrl: process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl,
  usdc: process.env.ARC_USDC ?? ARC_TESTNET.usdc,
  yieldSource: process.env.ARC_YIELD_SOURCE, // the one value still to confirm (Arc's yield 4626)
  gateway: process.env.NEXT_PUBLIC_ARC_GATEWAY_ADDRESS, // set after DeployArcSpendStack on Arc
  vault: process.env.NEXT_PUBLIC_ARC_VAULT_ADDRESS,
  cpnTreasury: process.env.ARC_CPN_TREASURY, // Circle Payments Network — the one relationship-gated piece
  cctpMessageTransmitter: process.env.ARC_CCTP_MESSAGE_TRANSMITTER ?? ARC_TESTNET.cctpMessageTransmitter,
  cctpDepositRouter: process.env.NEXT_PUBLIC_ARC_CCTP_ROUTER, // set after deploy
}

/**
 * True once the Arc settlement stack is actually wired (RPC + deployed gateway + vault known). Fail-safe:
 * gate any Arc UI / settlement flow on this so nothing points at an unconfigured chain.
 */
export const isArcConfigured = (): boolean => Boolean(ARC.rpcUrl && ARC.gateway && ARC.vault)

/**
 * The edge/relayer environment for Arc (documentation-as-code — set these to move settlement to Arc):
 *   EDGE_CHAIN_ID=5042002 makes the edge signer's EIP-712 domain correct for Arc;
 *   EDGE_GATEWAY_ADDRESS / EDGE_VAULT_ADDRESS come from the DeployArcSpendStack output;
 *   the relayer just needs its RPC pointed at Arc (chain id is read from the node).
 */
export const ARC_EDGE_ENV = {
  EDGE_CHAIN_ID: String(ARC_CHAIN_ID),
} as const
