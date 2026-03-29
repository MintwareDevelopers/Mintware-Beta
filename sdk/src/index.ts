// =============================================================================
// @mintware/ai-attribution-sdk
//
// Dead-simple integration for AI agents to plug into Mintware Attribution.
// One line to get started:
//
//   import { registerWithMintwareOracle } from '@mintware/ai-attribution-sdk'
//   const { address, txHash } = await registerWithMintwareOracle({ privateKey: '0x...' })
//
// That's it — on-chain registration + oracle watcher enrollment in one call.
// After ~60 seconds the oracle watcher will begin tracking your agent's
// on-chain activity and pre-signing reputation attestations automatically.
//
// =============================================================================

import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'

import { AI_ATTRIBUTION_ABI, CONTRACT_ADDRESSES, DEFAULT_CONTRACT, DEFAULT_RPC_URL } from './constants.js'
import type { AgentScore, WriteOptions, OracleOptions, SdkOptions } from './types.js'

export { AI_ATTRIBUTION_ABI, CONTRACT_ADDRESSES, DEFAULT_RPC, DEFAULT_CONTRACT } from './constants.js'
export type { AgentScore, AgentCampaign, SdkOptions, WriteOptions, OracleOptions } from './types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveChain(opts?: SdkOptions) {
  // If a custom RPC is provided alongside baseSepolia contract address, use testnet chain
  const contract = opts?.contractAddress ?? DEFAULT_CONTRACT
  return contract === CONTRACT_ADDRESSES.baseSepolia ? baseSepolia : base
}

function publicClient(opts?: SdkOptions) {
  return createPublicClient({
    chain:     resolveChain(opts),
    transport: http(opts?.rpcUrl ?? DEFAULT_RPC_URL),
  })
}

function walletClient(privateKey: `0x${string}`, opts?: SdkOptions) {
  return createWalletClient({
    account:   privateKeyToAccount(privateKey),
    chain:     resolveChain(opts),
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
export async function recordAction(params: {
  agent:          `0x${string}`
  volumeWei:      bigint
  mwpContextHash: `0x${string}`
  campaignId:     bigint
} & WriteOptions & OracleOptions): Promise<`0x${string}`> {
  // Step 1 — get oracle signature (oracle pays nothing)
  const res = await fetch(`${params.oracleApiUrl}/api/agents/campaigns/record`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${params.oracleApiKey}`,
    },
    body: JSON.stringify({
      address:    params.agent,
      volumeWei:  params.volumeWei.toString(),
      mwpHash:    params.mwpContextHash,
      campaignId: Number(params.campaignId),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(`Oracle API error: ${(err as { error?: string }).error ?? res.statusText}`)
  }

  const { signature, nonce, deadline } = await res.json() as {
    signature: `0x${string}`
    nonce:     string
    deadline:  string
  }

  // Step 2 — agent submits to contract, agent pays gas
  const wallet = walletClient(params.privateKey, params)
  return wallet.writeContract({
    address:      contractAddress(params),
    abi:          AI_ATTRIBUTION_ABI,
    functionName: 'recordVerifiedAction',
    args: [
      params.agent,
      params.volumeWei,
      params.mwpContextHash,
      params.campaignId,
      BigInt(nonce),
      BigInt(deadline),
      signature,
    ],
  })
}

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
export async function claimPendingActions(params: {
  agent:     `0x${string}`
  apiBase?:  string
} & WriteOptions): Promise<{ submitted: number; hashes: `0x${string}`[] }> {
  const base = params.apiBase ?? 'https://mintware.finance'

  // 1. Fetch pending signatures from API
  const res = await fetch(`${base}/api/agents/${params.agent}/pending`)
  if (!res.ok) throw new Error(`Failed to fetch pending actions: ${res.statusText}`)

  const { pending } = await res.json() as {
    pending: Array<{
      id:         number
      txHash:     string
      signature:  string
      nonce:      string
      deadline:   string
      volumeWei:  string
      campaignId: number
    }>
  }

  if (!pending.length) return { submitted: 0, hashes: [] }

  const wallet  = walletClient(params.privateKey, params)
  const hashes: `0x${string}`[] = []
  const nowSecs = BigInt(Math.floor(Date.now() / 1000))

  for (const action of pending) {
    const deadline = BigInt(action.deadline)
    if (deadline <= nowSecs) {
      console.warn(`[sdk] Skipping expired signature for tx ${action.txHash}`)
      continue
    }

    try {
      const hash = await wallet.writeContract({
        address:      contractAddress(params),
        abi:          AI_ATTRIBUTION_ABI,
        functionName: 'recordVerifiedAction',
        args: [
          params.agent,
          BigInt(action.volumeWei),
          '0x' + '00'.repeat(32) as `0x${string}`,  // no MWP hash for watcher-detected actions
          BigInt(action.campaignId),
          BigInt(action.nonce),
          deadline,
          action.signature as `0x${string}`,
        ],
      })
      hashes.push(hash)
    } catch (err) {
      console.error(`[sdk] Failed to submit action for tx ${action.txHash}:`, err)
    }
  }

  return { submitted: hashes.length, hashes }
}

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
export async function registerWithMintwareOracle(params: WriteOptions & {
  /** Mintware API base URL. Defaults to 'https://mintware.finance'. */
  apiBase?: string
  /** Optional display name stored in the agent profile. */
  name?:    string
}): Promise<{ address: `0x${string}`; txHash: `0x${string}` }> {
  const account = privateKeyToAccount(params.privateKey)
  const address = account.address

  // Step 1 — on-chain registration (agent pays gas)
  const txHash = await registerAgent(params)

  // Step 2 — wait for receipt so the profile sync is reliable
  const client = publicClient(params)
  await client.waitForTransactionReceipt({ hash: txHash })

  // Step 3 — sync profile with Mintware oracle watcher
  const base = params.apiBase ?? 'https://mintware.finance'
  try {
    await fetch(`${base}/api/agents/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address, name: params.name ?? null }),
    })
  } catch (err) {
    // Non-fatal — oracle watcher will pick up the on-chain event on its next cron tick
    console.warn('[sdk] registerWithMintwareOracle: profile sync failed (oracle watcher will recover):', err)
  }

  return { address, txHash }
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
