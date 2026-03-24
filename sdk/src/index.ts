// =============================================================================
// @mintware/ai-attribution-sdk
//
// Dead-simple integration for AI agents to plug into Mintware Attribution.
// Three lines to get started:
//
//   import { registerAgent, getScore } from '@mintware/ai-attribution-sdk'
//   await registerAgent({ privateKey: '0x...' })
//   const score = await getScore('0x...')
//
// =============================================================================

import {
  createPublicClient,
  createWalletClient,
  http,
  privateKeyToAccount,
} from 'viem'
import { baseSepolia } from 'viem/chains'

import { AI_ATTRIBUTION_ABI, DEFAULT_CONTRACT, DEFAULT_RPC_URL } from './constants.js'
import type { AgentScore, WriteOptions, OracleOptions, SdkOptions } from './types.js'

export { AI_ATTRIBUTION_ABI, CONTRACT_ADDRESSES, DEFAULT_RPC, DEFAULT_CONTRACT } from './constants.js'
export type { AgentScore, AgentCampaign, SdkOptions, WriteOptions, OracleOptions } from './types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function publicClient(opts?: SdkOptions) {
  return createPublicClient({
    chain:     baseSepolia,
    transport: http(opts?.rpcUrl ?? DEFAULT_RPC_URL),
  })
}

function walletClient(privateKey: `0x${string}`, opts?: SdkOptions) {
  return createWalletClient({
    account:   privateKeyToAccount(privateKey),
    chain:     baseSepolia,
    transport: http(opts?.rpcUrl ?? DEFAULT_RPC_URL),
  })
}

function contractAddress(opts?: SdkOptions): `0x${string}` {
  return opts?.contractAddress ?? DEFAULT_CONTRACT
}

// ── Read functions ────────────────────────────────────────────────────────────

/**
 * Read the full Attribution score for any agent address.
 *
 * @example
 * const score = await getScore('0xabc...')
 * console.log(score.total, score.isTransparent)
 */
export async function getScore(
  agent: `0x${string}`,
  opts?: SdkOptions,
): Promise<AgentScore> {
  const client = publicClient(opts)
  const result = await client.readContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'getScore',
    args:         [agent],
  }) as [bigint, bigint, bigint, bigint, bigint, boolean, `0x${string}`, bigint]

  return {
    total:            result[0],
    behavior:         result[1],
    contribution:     result[2],
    risk:             result[3],
    interpretability: result[4],
    isTransparent:    result[5],
    lastMwpHash:      result[6],
    erc8004TokenId:   result[7],
  }
}

/**
 * Check whether an agent address is registered.
 */
export async function isRegistered(
  agent: `0x${string}`,
  opts?: SdkOptions,
): Promise<boolean> {
  const client = publicClient(opts)
  return client.readContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'registered',
    args:         [agent],
  }) as Promise<boolean>
}

/**
 * Get the volume an agent contributed to a specific campaign.
 */
export async function getCampaignVolume(
  campaignId: bigint,
  agent: `0x${string}`,
  opts?: SdkOptions,
): Promise<bigint> {
  const client = publicClient(opts)
  return client.readContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'getAgentCampaignVolume',
    args:         [campaignId, agent],
  }) as Promise<bigint>
}

// ── Write functions ───────────────────────────────────────────────────────────

/**
 * Register an agent wallet with the AIAttribution contract.
 * Permissionless — no ERC-8004 required at launch.
 *
 * @example
 * const txHash = await registerAgent({ privateKey: '0x...' })
 */
export async function registerAgent(opts: WriteOptions): Promise<`0x${string}`> {
  const wallet = walletClient(opts.privateKey, opts)
  return wallet.writeContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'registerAgent',
    args:         [],
  })
}

/**
 * Link an ERC-8004 tokenId to the agent wallet.
 * Requires the wallet to own the tokenId in the ERC-8004 registry.
 *
 * @example
 * await linkErc8004(42n, { privateKey: '0x...' })
 */
export async function linkErc8004(
  tokenId: bigint,
  opts: WriteOptions,
): Promise<`0x${string}`> {
  const wallet = walletClient(opts.privateKey, opts)
  return wallet.writeContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'linkErc8004',
    args:         [tokenId],
  })
}

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
export async function submitMwpHash(
  mwpHash: `0x${string}`,
  opts: WriteOptions,
): Promise<`0x${string}`> {
  const wallet = walletClient(opts.privateKey, opts)
  return wallet.writeContract({
    address:      contractAddress(opts),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'submitMwpHash',
    args:         [mwpHash],
  })
}

/**
 * Oracle-only: record a verified on-chain action for an agent.
 * Increments behavior score and optionally credits MWP interpretability.
 *
 * @example
 * await recordAction({
 *   agent:            '0x...',
 *   volumeWei:        5000000000000000000n, // 5 ETH
 *   mwpContextHash:   '0x...',
 *   campaignId:       1n,
 *   oraclePrivateKey: '0x...',
 * })
 */
export async function recordAction(params: {
  agent:          `0x${string}`
  volumeWei:      bigint
  mwpContextHash: `0x${string}`
  campaignId:     bigint
} & OracleOptions): Promise<`0x${string}`> {
  const wallet = walletClient(params.oraclePrivateKey, params)
  return wallet.writeContract({
    address:      contractAddress(params),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'recordVerifiedAction',
    args:         [params.agent, params.volumeWei, params.mwpContextHash, params.campaignId],
  })
}

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
export async function createCampaign(params: {
  name:         string
  targetVolume: bigint
  durationSecs: bigint
} & WriteOptions): Promise<`0x${string}`> {
  const wallet = walletClient(params.privateKey, params)
  return wallet.writeContract({
    address:      contractAddress(params),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'createVolumeCampaign',
    args:         [params.name, params.targetVolume, params.durationSecs],
  })
}
