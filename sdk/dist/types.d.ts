/** Full score breakdown for an agent */
export interface AgentScore {
    total: bigint;
    behavior: bigint;
    contribution: bigint;
    risk: bigint;
    interpretability: bigint;
    isTransparent: boolean;
    lastMwpHash: `0x${string}`;
    erc8004TokenId: bigint;
}
/** A single agent volume campaign */
export interface AgentCampaign {
    campaignId: bigint;
    protocol: `0x${string}`;
    name: string;
    targetVolume: bigint;
    startTime: bigint;
    endTime: bigint;
    active: boolean;
}
/** Options shared across SDK functions */
export interface SdkOptions {
    /** RPC URL. Defaults to Base Sepolia. */
    rpcUrl?: string;
    /** Contract address override. Defaults to Base Sepolia deployment. */
    contractAddress?: `0x${string}`;
}
/** Options for write functions that require a signer */
export interface WriteOptions extends SdkOptions {
    /** Private key (0x-prefixed) for the agent wallet */
    privateKey: `0x${string}`;
}
/**
 * Options for recordAction — gasless oracle pattern.
 * The oracle signs off-chain via the oracle API; the agent submits to the contract.
 */
export interface OracleOptions extends SdkOptions {
    /**
     * Base URL of the Mintware oracle API.
     * @example 'https://mintware-beta.vercel.app'
     */
    oracleApiUrl: string;
    /**
     * Bearer token for the oracle API (AI_ATTRIBUTION_ORACLE_SECRET).
     * Keep server-side only — never expose in client bundles.
     */
    oracleApiKey: string;
}
//# sourceMappingURL=types.d.ts.map