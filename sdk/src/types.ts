// =============================================================================
// @mintware/ai-attribution-sdk — types
// =============================================================================

/** Full score breakdown for an agent */
export interface AgentScore {
  total:            bigint
  behavior:         bigint
  contribution:     bigint
  risk:             bigint
  interpretability: bigint
  isTransparent:    boolean
  lastMwpHash:      `0x${string}`
  erc8004TokenId:   bigint  // 0n if not linked
}

/** A single agent volume campaign */
export interface AgentCampaign {
  campaignId:   bigint
  protocol:     `0x${string}`
  name:         string
  targetVolume: bigint
  startTime:    bigint
  endTime:      bigint
  active:       boolean
}

/** Options shared across SDK functions */
export interface SdkOptions {
  /** RPC URL. Defaults to Base Sepolia. */
  rpcUrl?:          string
  /** Contract address override. Defaults to Base Sepolia deployment. */
  contractAddress?: `0x${string}`
}

/** Options for write functions that require a signer */
export interface WriteOptions extends SdkOptions {
  /** Private key (0x-prefixed) for the agent wallet */
  privateKey: `0x${string}`
}

/** Options for the oracle-only recordAction function */
export interface OracleOptions extends SdkOptions {
  /** Oracle private key */
  oraclePrivateKey: `0x${string}`
}
