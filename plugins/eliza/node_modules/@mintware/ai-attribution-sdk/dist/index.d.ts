import type { AgentScore, WriteOptions, OracleOptions, SdkOptions } from './types.js';
export { AI_ATTRIBUTION_ABI, CONTRACT_ADDRESSES, DEFAULT_RPC, DEFAULT_CONTRACT } from './constants.js';
export type { AgentScore, AgentCampaign, SdkOptions, WriteOptions, OracleOptions } from './types.js';
/**
 * Read the full Attribution score for any agent address.
 *
 * @example
 * const score = await getScore('0xabc...')
 * console.log(score.total, score.isTransparent)
 */
export declare function getScore(agent: `0x${string}`, opts?: SdkOptions): Promise<AgentScore>;
/**
 * Check whether an agent address is registered.
 */
export declare function isRegistered(agent: `0x${string}`, opts?: SdkOptions): Promise<boolean>;
/**
 * Get the volume an agent contributed to a specific campaign.
 */
export declare function getCampaignVolume(campaignId: bigint, agent: `0x${string}`, opts?: SdkOptions): Promise<bigint>;
/**
 * Register an agent wallet with the AIAttribution contract.
 * Permissionless — no ERC-8004 required at launch.
 *
 * @example
 * const txHash = await registerAgent({ privateKey: '0x...' })
 */
export declare function registerAgent(opts: WriteOptions): Promise<`0x${string}`>;
/**
 * Link an ERC-8004 tokenId to the agent wallet.
 * Requires the wallet to own the tokenId in the ERC-8004 registry.
 *
 * @example
 * await linkErc8004(42n, { privateKey: '0x...' })
 */
export declare function linkErc8004(tokenId: bigint, opts: WriteOptions): Promise<`0x${string}`>;
/**
 * Submit a MWP folder snapshot hash to earn the Transparent Agent badge.
 * Permissionless — any registered agent can call this.
 * Each unique hash awards +50 interpretability points (capped at 500 total).
 *
 * @example
 * import { keccak256, toHex } from 'viem'
 * const hash = keccak256(toHex('ipfs://Qm...'))
 * await submitMwpHash(hash, { privateKey: '0x...' })
 */
export declare function submitMwpHash(mwpHash: `0x${string}`, opts: WriteOptions): Promise<`0x${string}`>;
/**
 * Record a verified on-chain action for an agent — gasless oracle pattern.
 *
 * Flow:
 *   1. Calls the Mintware oracle API to validate the action and get an EIP-712 signature.
 *   2. Agent wallet submits the signed action to the contract (agent pays gas).
 *   Oracle pays nothing.
 *
 * @example
 * const txHash = await recordAction({
 *   agent:          '0x...',
 *   volumeWei:      5_000_000_000_000_000_000n,
 *   mwpContextHash: '0x...',
 *   campaignId:     1n,
 *   privateKey:     '0x...', // agent wallet key
 *   oracleApiUrl:   'https://mintware-beta.vercel.app',
 *   oracleApiKey:   process.env.AI_ATTRIBUTION_ORACLE_SECRET,
 * })
 */
export declare function recordAction(params: {
    agent: `0x${string}`;
    volumeWei: bigint;
    mwpContextHash: `0x${string}`;
    campaignId: bigint;
} & WriteOptions & OracleOptions): Promise<`0x${string}`>;
/**
 * Fetch pending oracle-signed actions and submit each to the contract.
 * The oracle watcher detects on-chain activity and pre-signs actions — this
 * function lets the agent claim those signatures and record them on-chain.
 * Agent pays gas. Oracle pays nothing.
 *
 * @example
 * const result = await claimPendingActions({
 *   agent:      '0x...',
 *   privateKey: '0x...',
 *   apiBase:    'https://mintware.finance',
 * })
 * console.log(`Submitted ${result.submitted} actions`)
 */
export declare function claimPendingActions(params: {
    agent: `0x${string}`;
    apiBase?: string;
} & WriteOptions): Promise<{
    submitted: number;
    hashes: `0x${string}`[];
}>;
/**
 * Register an agent with Mintware in one call.
 *
 * Combines three steps into a single awaitable function:
 *   1. Sends `registerAgent()` to the AIAttribution contract (agent pays gas).
 *   2. Waits for the transaction to be confirmed.
 *   3. POSTs to /api/agents/register so the Mintware oracle watcher starts
 *      monitoring the address on the next cron tick (~60 seconds).
 *
 * After this call, the agent will be live on the leaderboard and the oracle
 * watcher will begin pre-signing WETH activity attestations automatically.
 *
 * @example
 * const { address, txHash } = await registerWithMintwareOracle({
 *   privateKey: process.env.AGENT_PRIVATE_KEY,
 * })
 * console.log(`Registered ${address} — tx ${txHash}`)
 *
 * @example
 * // With custom API base (e.g. staging)
 * await registerWithMintwareOracle({
 *   privateKey: '0x...',
 *   apiBase:    'https://mintware-beta.vercel.app',
 * })
 */
export declare function registerWithMintwareOracle(params: WriteOptions & {
    /** Mintware API base URL. Defaults to 'https://mintware.finance'. */
    apiBase?: string;
    /** Optional display name stored in the agent profile. */
    name?: string;
}): Promise<{
    address: `0x${string}`;
    txHash: `0x${string}`;
}>;
/**
 * Create a new Agent Volume Campaign on-chain.
 * Permissionless — any protocol can create a campaign.
 *
 * @example
 * const txHash = await createCampaign({
 *   name:         'Uniswap V4 Volume Sprint',
 *   targetVolume: 1_000_000n * 10n**18n, // $1M in wei
 *   durationSecs: 604800n,               // 7 days
 *   privateKey:   '0x...',
 * })
 */
export declare function createCampaign(params: {
    name: string;
    targetVolume: bigint;
    durationSecs: bigint;
} & WriteOptions): Promise<`0x${string}`>;
//# sourceMappingURL=index.d.ts.map