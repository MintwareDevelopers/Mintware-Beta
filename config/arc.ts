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
  // CCTP v2 (public — Circle CCTP docs). Arc's CCTP domain id is 26.
  cctpDomain: 26,
  cctpTokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  cctpMessageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
} as const

export interface ArcSettlementConfig {
  chainId: number
  name: string
  /** ARC_RPC_URL — from Circle (testnet access). */
  rpcUrl?: string
  /** Real USDC on Arc. */
  usdc?: string
  /** Arc's yield primitive as an ERC-4626 over USDC (slots into MintwareERC4626YieldAdapter). */
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
