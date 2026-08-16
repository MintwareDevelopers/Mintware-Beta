// Arc (Circle's USDC-native L1) — the YPN SETTLEMENT / SPEND chain.
//
// The earn side (Uniswap-v4 ETH pools, collateral, MEV) stays on Base; Arc is the spend side — USDC is the
// gas token, settlement is sub-second, and the card off-ramp runs through Circle's rails. CCTP bridges USDC
// between the two. The YPN contracts are chain-agnostic (EIP-712 reads `block.chainid`), so NOTHING here is
// compiled into a contract — this is purely deploy/runtime wiring, env-driven, and filled in once Arc
// testnet access + the spend-stack deploy (`DeployArcSpendStack.s.sol`) land.

/** Documented Arc target chain id (per the YPN foundation spec). */
export const ARC_CHAIN_ID = 5042002

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

/** CCTP domain ids (Circle-assigned). Base is 6; Arc's domain is TBD — confirm with Circle. */
export const CCTP_DOMAIN = {
  base: 6,
  arc: Number(process.env.ARC_CCTP_DOMAIN ?? -1), // -1 until Circle assigns/confirms
} as const

export const ARC: ArcSettlementConfig = {
  chainId: ARC_CHAIN_ID,
  name: 'Arc',
  rpcUrl: process.env.ARC_RPC_URL,
  usdc: process.env.ARC_USDC,
  yieldSource: process.env.ARC_YIELD_SOURCE,
  gateway: process.env.NEXT_PUBLIC_ARC_GATEWAY_ADDRESS,
  vault: process.env.NEXT_PUBLIC_ARC_VAULT_ADDRESS,
  cpnTreasury: process.env.ARC_CPN_TREASURY,
  cctpMessageTransmitter: process.env.ARC_CCTP_MESSAGE_TRANSMITTER,
  cctpDepositRouter: process.env.NEXT_PUBLIC_ARC_CCTP_ROUTER,
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
