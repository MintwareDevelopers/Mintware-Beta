// =============================================================================
// @mintwarehq/eliza-plugin
//
// Mintware AI Attribution plugin for ElizaOS.
// Exposes eight actions:
//   GET_ATTRIBUTION_SCORE    — look up any agent's on-chain reputation
//   REGISTER_MINTWARE        — register the agent wallet with Attribution
//   CLAIM_PENDING_ACTIONS    — submit pre-signed oracle attestations to the contract
//   PARK_USDC                — park USDC into the Mintware yield vault (ERC-4626)
//   UNPARK_USDC              — redeem vault shares back to USDC
//   SHOW_TREASURY            — read parked / spendable / earning balances
//   QUOTE_X402               — preflight an x402-gated URL's price (no payment)
//   PAY_X402                 — pay an x402 call in USDC (EIP-3009) and return the resource
//
// Contract (Base mainnet): 0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421
// Park vault (base-sepolia): 0x09Cda8519737a60FD16D263f94fb56237CDb7E42  (Arc dropped 2026-08-27)
// API base:                https://mintware.finance
// =============================================================================

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  elizaLogger,
  type Plugin,
} from '@elizaos/core'

import {
  registerWithMintwareOracle,
  claimPendingActions,
} from '@mintwarehq/ai-attribution-sdk'

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = 'https://mintware.finance'

const BASE_MAINNET_CONTRACT = '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421' as const

// ── Types for API responses ───────────────────────────────────────────────────

interface AgentScoreResponse {
  address:          string
  rank:             number
  total_score:      number
  behavior:         number
  contribution:     number
  interpretability: number
  risk:             number
  is_transparent:   boolean
  registered_at:    string
  pnl?: {
    realized_pnl_usd?: number
    unrealized_pnl_usd?: number
    total_pnl_usd?: number
  } | null
}

interface LeaderboardEntry {
  address:     string
  rank:        number
  total_score: number
  behavior:    number
  contribution: number
  is_transparent: boolean
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[]
  total:       number
}

// ── Helper: extract Ethereum address from a message string ────────────────────

function extractAddress(text: string): string | null {
  const match = text.match(/0x[0-9a-fA-F]{40}/)
  return match ? match[0].toLowerCase() : null
}

// ── Helper: format a score response into a readable string ────────────────────

function formatScoreResponse(data: AgentScoreResponse): string {
  const addr = data.address
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`
  const transparent = data.is_transparent ? 'Yes (MWP hash on-chain)' : 'No'

  let out = `Attribution Score for ${short}\n`
  out += `─────────────────────────────\n`
  out += `Total Score:      ${data.total_score ?? 0}\n`
  out += `Rank:             #${data.rank ?? 'unranked'}\n`
  out += `\n`
  out += `Score Breakdown:\n`
  out += `  Behavior:         ${data.behavior ?? 0}\n`
  out += `  Contribution:     ${data.contribution ?? 0}\n`
  out += `  Interpretability: ${data.interpretability ?? 0}\n`
  out += `  Risk Penalty:     ${data.risk ?? 0}\n`
  out += `\n`
  out += `Transparent Agent: ${transparent}\n`

  if (data.pnl && data.pnl.total_pnl_usd != null) {
    const sign = data.pnl.total_pnl_usd >= 0 ? '+' : ''
    out += `PnL (all-time):    ${sign}$${data.pnl.total_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`
    if (data.pnl.realized_pnl_usd != null) {
      const rs = data.pnl.realized_pnl_usd >= 0 ? '+' : ''
      out += `  Realized:        ${rs}$${data.pnl.realized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`
    }
    if (data.pnl.unrealized_pnl_usd != null) {
      const us = data.pnl.unrealized_pnl_usd >= 0 ? '+' : ''
      out += `  Unrealized:      ${us}$${data.pnl.unrealized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`
    }
  }

  return out.trim()
}

// =============================================================================
// Action 1 — GET_ATTRIBUTION_SCORE
// =============================================================================

const getAttributionScoreAction: Action = {
  name: 'GET_ATTRIBUTION_SCORE',

  similes: [
    'check attribution score',
    'what\'s my score',
    'what is my score',
    'get reputation score for',
    'mintware score',
    'attribution score',
    'check my attribution',
    'look up score',
    'show reputation',
    'agent score',
    'get score',
    'my attribution',
    'score for',
  ],

  description:
    'Fetches the Mintware AI Attribution score for an agent address. ' +
    'Pass an Ethereum address in the message, or omit it to look up the agent\'s own address. ' +
    'Returns total score, rank, behavior, contribution, interpretability, risk, transparent status, and PnL if available.',

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    // Read-only — no private key required
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] GET_ATTRIBUTION_SCORE triggered')

    const text = message.content?.text ?? ''

    // Try to find an address in the message; fall back to the agent's own address
    let address = extractAddress(text)

    if (!address) {
      // Use the agent's configured wallet address if available
      const agentKey = runtime.getSetting('AGENT_PRIVATE_KEY')
      if (agentKey) {
        try {
          // Derive address from private key using a lightweight approach
          const { privateKeyToAccount } = await import('viem/accounts')
          const account = privateKeyToAccount(agentKey as `0x${string}`)
          address = account.address.toLowerCase()
        } catch (err) {
          elizaLogger.warn('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err)
        }
      }
    }

    if (!address) {
      await callback({
        text: 'Please provide an Ethereum address to look up, e.g. "check attribution score for 0xabc..."',
      })
      return false
    }

    elizaLogger.info(`[mintware] Fetching score for ${address}`)

    try {
      const res = await fetch(`${API_BASE}/api/agents/${address}`)

      if (res.status === 404) {
        await callback({
          text: `No Attribution record found for ${address}. The agent may not be registered yet. Use REGISTER_MINTWARE to sign up.`,
        })
        return true
      }

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`)
      }

      const data = (await res.json()) as AgentScoreResponse
      const formatted = formatScoreResponse(data)

      elizaLogger.info(`[mintware] Score fetched — total: ${data.total_score}, rank: #${data.rank}`)

      await callback({ text: formatted })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] GET_ATTRIBUTION_SCORE error:', err)
      await callback({
        text: `Failed to fetch Attribution score: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Check my attribution score' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Attribution Score for 0xabc1…ef12\n─────────────────────────────\nTotal Score: 320\nRank: #14\n\nScore Breakdown:\n  Behavior: 110\n  Contribution: 95\n  Interpretability: 80\n  Risk Penalty: 0\n\nTransparent Agent: Yes (MWP hash on-chain)',
          action: 'GET_ATTRIBUTION_SCORE',
        },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Get reputation score for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Attribution Score for 0xd8dA…6045\n─────────────────────────────\nTotal Score: 0\nRank: unranked\n\nScore Breakdown:\n  Behavior: 0\n  Contribution: 0\n  Interpretability: 0\n  Risk Penalty: 0\n\nTransparent Agent: No',
          action: 'GET_ATTRIBUTION_SCORE',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 2 — REGISTER_MINTWARE
// =============================================================================

const registerMintwareAction: Action = {
  name: 'REGISTER_MINTWARE',

  similes: [
    'register with mintware',
    'join mintware attribution',
    'sign up for attribution',
    'register on mintware',
    'enroll in mintware',
    'set up attribution',
    'start mintware attribution',
    'mintware registration',
    'register for reputation scoring',
    'get on mintware leaderboard',
  ],

  description:
    'Registers the agent wallet with the Mintware AI Attribution contract on Base mainnet. ' +
    'Requires AGENT_PRIVATE_KEY to be set in the agent runtime settings. ' +
    'This is a one-time on-chain transaction — the agent pays gas. ' +
    'After registration the oracle watcher will begin tracking on-chain activity automatically.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const key = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!key) {
      elizaLogger.warn('[mintware] REGISTER_MINTWARE: AGENT_PRIVATE_KEY not set')
      return false
    }
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] REGISTER_MINTWARE triggered')

    const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY')

    if (!privateKey) {
      await callback({
        text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to enable on-chain registration.',
      })
      return false
    }

    await callback({
      text: 'Registering with Mintware AI Attribution on Base mainnet. Submitting transaction — this may take 10–30 seconds…',
    })

    try {
      const { address, txHash } = await registerWithMintwareOracle({
        privateKey: privateKey as `0x${string}`,
        contractAddress: BASE_MAINNET_CONTRACT,
        apiBase: API_BASE,
      })

      const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`
      const shortTx   = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`

      elizaLogger.info(`[mintware] Registration complete — address: ${address}, tx: ${txHash}`)

      await callback({
        text: [
          `Registration successful.`,
          ``,
          `Address:  ${shortAddr}`,
          `Tx Hash:  ${shortTx}`,
          `Network:  Base mainnet`,
          ``,
          `The Mintware oracle watcher will start tracking your on-chain activity within ~60 seconds. Use "claim pending actions" periodically to submit oracle-signed attestations and keep your score up to date.`,
        ].join('\n'),
      })

      return true
    } catch (err) {
      elizaLogger.error('[mintware] REGISTER_MINTWARE error:', err)

      const msg = err instanceof Error ? err.message : String(err)

      // Surface friendly message for already-registered agents
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
        await callback({
          text: 'This agent address is already registered with Mintware Attribution. Use "claim pending actions" to submit any queued oracle attestations.',
        })
        return true
      }

      await callback({
        text: `Registration failed: ${msg}`,
      })
      return false
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Register with Mintware' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Registration successful.\n\nAddress:  0xabc1…ef12\nTx Hash:  0x1a2b3c4d5e…f6a7b8\nNetwork:  Base mainnet\n\nThe Mintware oracle watcher will start tracking your on-chain activity within ~60 seconds.',
          action: 'REGISTER_MINTWARE',
        },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Join Mintware attribution' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Registering with Mintware AI Attribution on Base mainnet. Submitting transaction — this may take 10–30 seconds…',
          action: 'REGISTER_MINTWARE',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 3 — CLAIM_PENDING_ACTIONS
// =============================================================================

const claimPendingActionsAction: Action = {
  name: 'CLAIM_PENDING_ACTIONS',

  similes: [
    'claim attribution rewards',
    'claim pending actions',
    'update my attribution score',
    'submit pending attestations',
    'claim my score',
    'update attribution',
    'flush pending actions',
    'claim oracle signatures',
    'record pending actions',
    'sync attribution score',
  ],

  description:
    'Fetches pending oracle-signed action attestations from the Mintware API and submits each to the ' +
    'AIAttribution contract on Base mainnet. The agent pays gas; the oracle pays nothing. ' +
    'Requires AGENT_PRIVATE_KEY to be set. Run this periodically to keep the Attribution score current.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const key = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!key) {
      elizaLogger.warn('[mintware] CLAIM_PENDING_ACTIONS: AGENT_PRIVATE_KEY not set')
      return false
    }
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] CLAIM_PENDING_ACTIONS triggered')

    const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY')

    if (!privateKey) {
      await callback({
        text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to enable on-chain transactions.',
      })
      return false
    }

    // Derive the agent address from the private key
    let agentAddress: `0x${string}`
    try {
      const { privateKeyToAccount } = await import('viem/accounts')
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      agentAddress = account.address
    } catch (err) {
      elizaLogger.error('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err)
      await callback({
        text: 'Failed to derive wallet address from AGENT_PRIVATE_KEY. Please check the key is a valid 0x-prefixed hex private key.',
      })
      return false
    }

    elizaLogger.info(`[mintware] Claiming pending actions for ${agentAddress}`)

    await callback({
      text: 'Checking for pending oracle attestations…',
    })

    try {
      const result = await claimPendingActions({
        agent:           agentAddress,
        privateKey:      privateKey as `0x${string}`,
        contractAddress: BASE_MAINNET_CONTRACT,
        apiBase:         API_BASE,
      })

      if (result.submitted === 0) {
        elizaLogger.info('[mintware] No pending actions to claim')
        await callback({
          text: 'No pending actions found. Your Attribution score is already up to date.',
        })
        return true
      }

      elizaLogger.info(`[mintware] Submitted ${result.submitted} actions — hashes: ${result.hashes.join(', ')}`)

      const hashLines = result.hashes
        .map((h: string, i: number) => `  ${i + 1}. ${h.slice(0, 10)}…${h.slice(-6)}`)
        .join('\n')

      await callback({
        text: [
          `Successfully submitted ${result.submitted} attribution action${result.submitted === 1 ? '' : 's'} on-chain.`,
          ``,
          `Transactions:`,
          hashLines,
          ``,
          `Your Attribution score will update on the next oracle sync (~60 seconds).`,
        ].join('\n'),
      })

      return true
    } catch (err) {
      elizaLogger.error('[mintware] CLAIM_PENDING_ACTIONS error:', err)

      const msg = err instanceof Error ? err.message : String(err)

      if (msg.toLowerCase().includes('not registered') || msg.toLowerCase().includes('not found')) {
        await callback({
          text: 'This agent is not yet registered with Mintware Attribution. Use "register with Mintware" first.',
        })
        return false
      }

      await callback({
        text: `Failed to claim pending actions: ${msg}`,
      })
      return false
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Claim pending actions' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'Successfully submitted 3 attribution actions on-chain.\n\nTransactions:\n  1. 0x1a2b3c4d5e…f6a7b8\n  2. 0x9b8c7d6e5f…a1b2c3\n  3. 0x3d4e5f6a7b…c8d9e0\n\nYour Attribution score will update on the next oracle sync (~60 seconds).',
          action: 'CLAIM_PENDING_ACTIONS',
        },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Update my attribution score' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: 'No pending actions found. Your Attribution score is already up to date.',
          action: 'CLAIM_PENDING_ACTIONS',
        },
      },
    ],
  ],
}

// =============================================================================
// Capital-parking (base-sepolia yield vault) + x402 pay-per-call
//
// Mirrors the five AgentKit actions (MINTWARE_PARK / _UNPARK / _TREASURY /
// _X402_QUOTE / _X402_PAY) in Eliza's action shape. On-chain writes use a viem
// wallet client built from AGENT_PRIVATE_KEY; the vault/USDC/RPC default to the
// base-sepolia YPN yield stack (Arc dropped 2026-08-27) and are overridable via runtime settings.
// =============================================================================

// ── Parking vault + USDC (settings-overridable; base-sepolia — Arc dropped 2026-08-27) ────────────

const PARK_VAULT_DEFAULT = '0x09Cda8519737a60FD16D263f94fb56237CDb7E42' // base-sepolia MintwareYieldVault
const PARK_USDC_DEFAULT  = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // base-sepolia USDC
const PARK_RPC_DEFAULT   = 'https://base-sepolia-rpc.publicnode.com'
const PARK_CHAIN_ID_DEFAULT = 84532 // Base Sepolia

// ERC-20 / ERC-4626 selectors.
const APPROVE_SEL          = '0x095ea7b3' // approve(address,uint256)
const DEPOSIT_SEL          = '0x6e553f65' // deposit(uint256,address)  (ERC-4626)
const REDEEM_SEL           = '0xdb006a75' // redeem(uint256)  (burns caller's shares → USDC to caller)
const PREVIEW_WITHDRAW_SEL = '0x0a28a477' // previewWithdraw(uint256)  → shares needed
const SHARES_SEL           = '0xce7c2ac2' // shares(address)

function parkVault(runtime: IAgentRuntime): string {
  return (runtime.getSetting('MINTWARE_PARK_VAULT') as string) || PARK_VAULT_DEFAULT
}
function parkUsdc(runtime: IAgentRuntime): string {
  return (runtime.getSetting('MINTWARE_PARK_USDC') as string) || PARK_USDC_DEFAULT
}
function parkRpc(runtime: IAgentRuntime): string {
  return (runtime.getSetting('MINTWARE_PARK_RPC') as string) || PARK_RPC_DEFAULT
}
function parkChainId(runtime: IAgentRuntime): number {
  const raw = runtime.getSetting('MINTWARE_PARK_CHAIN_ID') as string | undefined
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : PARK_CHAIN_ID_DEFAULT
}

// ── Calldata / nonce helpers ──────────────────────────────────────────────────

function pad32(hexOrAddr: string): string {
  return hexOrAddr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}
function padUint(n: bigint): string {
  return n.toString(16).padStart(64, '0')
}
function randomNonce32(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes) // Web Crypto — global in Node 18+ and browsers
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Base64 helpers (Node + edge) ──────────────────────────────────────────────

function b64decode(s: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : atob(s)
}
function b64encode(s: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(s)
}

// ── Message parsing helpers ───────────────────────────────────────────────────

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s'"]+/)
  return match ? match[0] : null
}
function extractUsdAmount(text: string): number | null {
  const match = text.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── on-chain read (eth_call) ──────────────────────────────────────────────────

async function ethCall(rpc: string, to: string, data: string): Promise<bigint> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  })
  const j = (await res.json()) as { result?: string }
  return j.result && j.result !== '0x' ? BigInt(j.result) : 0n
}

// ── on-chain write (viem wallet client from AGENT_PRIVATE_KEY) ─────────────────

async function sendTx(
  runtime: IAgentRuntime,
  privateKey: `0x${string}`,
  tx: { to: string; data: string; value?: bigint },
): Promise<string> {
  const { createWalletClient, http, defineChain } = await import('viem')
  const { privateKeyToAccount } = await import('viem/accounts')

  const account = privateKeyToAccount(privateKey)
  const rpc = parkRpc(runtime)
  const chain = defineChain({
    id: parkChainId(runtime),
    name: 'Arc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  })
  const client = createWalletClient({ account, chain, transport: http(rpc) })

  return client.sendTransaction({
    account,
    chain,
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: tx.value ?? 0n,
  })
}

// ── x402 (EIP-3009 pay-per-call) ──────────────────────────────────────────────

const API_BASE_X402 = API_BASE

interface X402Requirements {
  scheme: 'exact' | 'deferred'
  network: string
  maxAmountRequired: string
  asset: string
  payTo: string
  resource: string
  description?: string
  nonce: string
  validUntil: number
  maxTimeoutSeconds?: number
}

/** EIP-712 domain for USDC `transferWithAuthorization` (EIP-3009), per x402 network. */
const USDC_DOMAIN: Record<string, { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }> = {
  base: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  'base-sepolia': { name: 'USDC', version: '2', chainId: 84532, verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

/** Fetch a resource; if it is 402, return the first advertised requirements (else null = free/served). */
async function readX402Challenge(url: string): Promise<{ res: Response; reqs: X402Requirements | null }> {
  const res = await fetch(url)
  if (res.status !== 402) return { res, reqs: null }
  const header = res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED')
  const raw = header ? b64decode(header) : await res.clone().text()
  const parsed = JSON.parse(raw) as { accepts?: X402Requirements[] }
  const reqs = parsed.accepts?.[0] ?? null
  return { res, reqs }
}

// =============================================================================
// Action 4 — PARK_USDC
// =============================================================================

const parkUsdcAction: Action = {
  name: 'PARK_USDC',

  similes: [
    'park usdc',
    'park my usdc',
    'deposit into the yield vault',
    'park capital',
    'earn yield on my usdc',
    'put usdc to work',
    'start earning yield',
    'deposit usdc to earn',
    'park my cash',
    'move usdc into the vault',
  ],

  description:
    'Parks USDC into the Mintware yield vault so it earns while staying spendable in place (it never locks). ' +
    'Deposits the USDC amount from the message: approves the vault, then deposits (ERC-4626). ' +
    'On-chain — the agent pays gas. Requires AGENT_PRIVATE_KEY. Vault/USDC/RPC default to the Arc-testnet YPN stack.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const key = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!key) {
      elizaLogger.warn('[mintware] PARK_USDC: AGENT_PRIVATE_KEY not set')
      return false
    }
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] PARK_USDC triggered')

    const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!privateKey) {
      await callback({
        text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to park capital on-chain.',
      })
      return false
    }

    const amountUsd = extractUsdAmount(message.content?.text ?? '')
    if (amountUsd == null) {
      await callback({
        text: 'How much USDC should I park? e.g. "park $25 into the vault".',
      })
      return false
    }

    const amount = BigInt(Math.round(amountUsd * 1_000_000)) // USDC 6dp
    if (amount <= 0n) {
      await callback({ text: 'Nothing to park (amount rounds to zero).' })
      return false
    }

    const vault = parkVault(runtime)
    const usdc  = parkUsdc(runtime)

    let agent: `0x${string}`
    try {
      const { privateKeyToAccount } = await import('viem/accounts')
      agent = privateKeyToAccount(privateKey as `0x${string}`).address
    } catch (err) {
      elizaLogger.error('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err)
      await callback({
        text: 'Failed to derive wallet address from AGENT_PRIVATE_KEY. Please check the key is a valid 0x-prefixed hex private key.',
      })
      return false
    }

    await callback({ text: `Parking $${amountUsd} USDC into the Mintware yield vault — submitting approve + deposit…` })

    try {
      // 1) approve the vault to pull `amount` USDC.
      const approveTx = await sendTx(runtime, privateKey as `0x${string}`, {
        to: usdc,
        data: APPROVE_SEL + pad32(vault) + padUint(amount),
      })
      // 2) deposit(assets, receiver=agent) → mints vault shares to the agent.
      const depositTx = await sendTx(runtime, privateKey as `0x${string}`, {
        to: vault,
        data: DEPOSIT_SEL + padUint(amount) + pad32(agent),
      })

      elizaLogger.info(`[mintware] Parked $${amountUsd} — approve: ${approveTx}, deposit: ${depositTx}`)

      await callback({
        text: [
          `Parked $${amountUsd} USDC into the Mintware yield vault.`,
          `  approve: ${approveTx}`,
          `  deposit: ${depositTx}`,
          `It's now earning yield and stays fully spendable in place — spend per call with PAY_X402.`,
        ].join('\n'),
      })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] PARK_USDC error:', err)
      await callback({
        text: `Failed to park USDC: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Park $25 into the vault' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'Parked $25 USDC into the Mintware yield vault.\n  approve: 0xabc…\n  deposit: 0xdef…\nIt\'s now earning yield and stays fully spendable in place — spend per call with PAY_X402.',
          action: 'PARK_USDC',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 5 — UNPARK_USDC
// =============================================================================

const unparkUsdcAction: Action = {
  name: 'UNPARK_USDC',

  similes: [
    'unpark usdc',
    'un-park my usdc',
    'redeem from the vault',
    'withdraw from the yield vault',
    'pull my usdc out',
    'take usdc back',
    'unpark everything',
    'redeem vault shares',
    'cash out of the vault',
    'get my usdc back',
  ],

  description:
    'Un-parks USDC from the Mintware yield vault back to the agent wallet by redeeming vault shares. ' +
    'Include an amount to un-park part; omit it to un-park everything. Capital is always yours — parking never locks. ' +
    'On-chain — the agent pays gas. Requires AGENT_PRIVATE_KEY.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const key = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!key) {
      elizaLogger.warn('[mintware] UNPARK_USDC: AGENT_PRIVATE_KEY not set')
      return false
    }
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] UNPARK_USDC triggered')

    const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!privateKey) {
      await callback({
        text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to un-park from the vault.',
      })
      return false
    }

    const vault = parkVault(runtime)
    const rpc   = parkRpc(runtime)

    let agent: `0x${string}`
    try {
      const { privateKeyToAccount } = await import('viem/accounts')
      agent = privateKeyToAccount(privateKey as `0x${string}`).address
    } catch (err) {
      elizaLogger.error('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err)
      await callback({
        text: 'Failed to derive wallet address from AGENT_PRIVATE_KEY. Please check the key is a valid 0x-prefixed hex private key.',
      })
      return false
    }

    // Detect an explicit amount ("un-park all" / no number → redeem everything).
    const text = message.content?.text ?? ''
    const wantsAll = /\ball\b|everything/i.test(text)
    const amountUsd = wantsAll ? null : extractUsdAmount(text)

    try {
      const balShares = await ethCall(rpc, vault, SHARES_SEL + pad32(agent))
      if (balShares === 0n) {
        await callback({ text: 'Nothing parked to un-park.' })
        return true
      }

      let sharesToBurn = balShares // default: un-park all
      if (amountUsd != null) {
        const amount = BigInt(Math.round(amountUsd * 1_000_000))
        const need = await ethCall(rpc, vault, PREVIEW_WITHDRAW_SEL + padUint(amount)) // shares to net `amount`
        sharesToBurn = need < balShares ? need : balShares
      }
      if (sharesToBurn === 0n) {
        await callback({ text: 'Nothing to un-park (amount rounds to zero).' })
        return true
      }

      const tx = await sendTx(runtime, privateKey as `0x${string}`, {
        to: vault,
        data: REDEEM_SEL + padUint(sharesToBurn),
      })

      const which = amountUsd != null ? `$${amountUsd}` : 'all parked USDC'
      elizaLogger.info(`[mintware] Un-parked ${which} — redeemed ${sharesToBurn} shares, tx: ${tx}`)

      await callback({
        text: `Un-parked ${which} — redeemed ${sharesToBurn} shares. redeem tx: ${tx}. USDC is back in the agent wallet.`,
      })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] UNPARK_USDC error:', err)
      await callback({
        text: `Failed to un-park USDC: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Un-park all my USDC' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'Un-parked all parked USDC — redeemed 25000000 shares. redeem tx: 0xabc…. USDC is back in the agent wallet.',
          action: 'UNPARK_USDC',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 6 — SHOW_TREASURY
// =============================================================================

const showTreasuryAction: Action = {
  name: 'SHOW_TREASURY',

  similes: [
    'show my treasury',
    'show my parking account',
    'how much is parked',
    'how much can i spend',
    'check my spendable balance',
    'show parked usdc',
    'mintware account balance',
    'what\'s in my vault',
    'treasury status',
    'parking account',
  ],

  description:
    "Shows the agent's Mintware capital-parking account: how much USDC is parked (earning yield) and how much " +
    'is spendable in place right now. Parking does not lock — the full parked balance stays spendable per call via x402. ' +
    'Read-only. Pass an address in the message, or omit it to use the agent\'s own wallet.',

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    // Read-only — no private key required
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] SHOW_TREASURY triggered')

    let address = extractAddress(message.content?.text ?? '')

    if (!address) {
      const agentKey = runtime.getSetting('AGENT_PRIVATE_KEY')
      if (agentKey) {
        try {
          const { privateKeyToAccount } = await import('viem/accounts')
          address = privateKeyToAccount(agentKey as `0x${string}`).address.toLowerCase()
        } catch (err) {
          elizaLogger.warn('[mintware] Could not derive address from AGENT_PRIVATE_KEY:', err)
        }
      }
    }

    if (!address) {
      await callback({
        text: 'Please provide an address to inspect, e.g. "show treasury for 0xabc…", or set AGENT_PRIVATE_KEY to use the agent\'s own wallet.',
      })
      return false
    }

    try {
      const res = await fetch(`${API_BASE_X402}/api/x402/account?address=${address}`)
      if (!res.ok) throw new Error(`Mintware account API returned ${res.status}: ${res.statusText}`)

      const t = (await res.json()) as {
        parkedUsdcFormatted?: string
        spendableUsdcFormatted?: string
        earning?: boolean
        network?: string
      }
      const short = `${address.slice(0, 6)}…${address.slice(-4)}`

      await callback({
        text: [
          `Mintware parking account for ${short} (${t.network ?? 'arc'})`,
          `  Parked (earning): $${t.parkedUsdcFormatted ?? '0'} USDC`,
          `  Spendable now:    $${t.spendableUsdcFormatted ?? '0'} USDC`,
          t.earning
            ? `  Status: earning yield, fully spendable in place — spend per call via PAY_X402.`
            : `  Status: empty — park USDC into the vault to start earning while staying spendable.`,
        ].join('\n'),
      })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] SHOW_TREASURY error:', err)
      await callback({
        text: `Failed to fetch parking account: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Show my treasury' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'Mintware parking account for 0xabc1…ef12 (arc)\n  Parked (earning): $250 USDC\n  Spendable now:    $250 USDC\n  Status: earning yield, fully spendable in place — spend per call via PAY_X402.',
          action: 'SHOW_TREASURY',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 7 — QUOTE_X402
// =============================================================================

const quoteX402Action: Action = {
  name: 'QUOTE_X402',

  similes: [
    'quote x402',
    'how much does this cost',
    'preview x402 price',
    'what does this api cost',
    'price this compute call',
    'check x402 price',
    'preflight x402',
    'quote this url',
    'cost to call',
    'how much to pay for',
  ],

  description:
    'Preflights an x402-gated compute/API URL WITHOUT paying. Returns the price (USDC), network, recipient, and ' +
    'description advertised in the 402 challenge, so the agent can decide whether to pay. Read-only. Include the URL in the message.',

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    // Read-only — no private key required
    return true
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] QUOTE_X402 triggered')

    const url = extractUrl(message.content?.text ?? '')
    if (!url) {
      await callback({ text: 'Please include the x402-protected URL to quote, e.g. "quote x402 for https://…".' })
      return false
    }

    try {
      const { res, reqs } = await readX402Challenge(url)
      if (!reqs) {
        await callback({ text: `No payment required (HTTP ${res.status}). The resource is free or already served.` })
        return true
      }

      const usdc = (Number(reqs.maxAmountRequired) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })
      await callback({
        text: [
          `x402 quote for ${reqs.resource}`,
          `  Price:    up to $${usdc} USDC`,
          `  Network:  ${reqs.network}`,
          `  Pay to:   ${reqs.payTo}`,
          `  Scheme:   ${reqs.scheme}`,
          reqs.description ? `  About:    ${reqs.description}` : '',
        ].filter(Boolean).join('\n'),
      })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] QUOTE_X402 error:', err)
      await callback({
        text: `Failed to quote x402 resource: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Quote x402 for https://api.example.com/compute' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'x402 quote for https://api.example.com/compute\n  Price:    up to $0.01 USDC\n  Network:  base\n  Pay to:   0xabc…\n  Scheme:   exact',
          action: 'QUOTE_X402',
        },
      },
    ],
  ],
}

// =============================================================================
// Action 8 — PAY_X402
// =============================================================================

const payX402Action: Action = {
  name: 'PAY_X402',

  similes: [
    'pay x402',
    'pay for this call',
    'pay and fetch',
    'pay the api',
    'settle x402',
    'pay for compute',
    'pay to access',
    'buy this compute call',
    'pay for and fetch',
    'authorize x402 payment',
  ],

  description:
    'Pays for an x402-gated compute/API call from the agent wallet in USDC and returns the resource. Reads the 402 ' +
    'challenge, signs an EIP-3009 authorization, retries with the payment, and returns the resource body. ' +
    'On-chain-signed — requires AGENT_PRIVATE_KEY. Use QUOTE_X402 first to preview cost. Include the URL in the message.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const key = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!key) {
      elizaLogger.warn('[mintware] PAY_X402: AGENT_PRIVATE_KEY not set')
      return false
    }
    return true
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    elizaLogger.info('[mintware] PAY_X402 triggered')

    const privateKey = runtime.getSetting('AGENT_PRIVATE_KEY')
    if (!privateKey) {
      await callback({
        text: 'AGENT_PRIVATE_KEY is not configured. Please set it in your agent environment to authorize x402 payments.',
      })
      return false
    }

    const text = message.content?.text ?? ''
    const url = extractUrl(text)
    if (!url) {
      await callback({ text: 'Please include the x402-protected URL to pay for, e.g. "pay x402 for https://…".' })
      return false
    }

    // Optional hard cap: "cap $5", "up to $5", or "max 5".
    const capMatch = text.match(/(?:cap|max|up to|under|below)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i)
    const maxAmountUsd = capMatch ? Number(capMatch[1]) : undefined

    try {
      const { res, reqs } = await readX402Challenge(url)
      if (!reqs) {
        const body = await res.text() // already free/served
        await callback({ text: body })
        return true
      }

      const priceUsd = Number(reqs.maxAmountRequired) / 1e6
      if (maxAmountUsd != null && priceUsd > maxAmountUsd) {
        await callback({ text: `Aborted: price $${priceUsd} exceeds your cap $${maxAmountUsd}. Nothing paid.` })
        return true
      }

      const domain = USDC_DOMAIN[reqs.network]
      if (!domain) {
        await callback({ text: `Aborted: network "${reqs.network}" not supported for payment by this action.` })
        return false
      }

      // Sign the EIP-3009 TransferWithAuthorization off the agent key.
      const { privateKeyToAccount } = await import('viem/accounts')
      const account = privateKeyToAccount(privateKey as `0x${string}`)

      const now = Math.floor(Date.now() / 1000)
      const authorization = {
        from: account.address,
        to: reqs.payTo,
        value: reqs.maxAmountRequired,
        validAfter: String(now - 60),
        validBefore: String(now + (reqs.maxTimeoutSeconds ?? 300)),
        nonce: randomNonce32(),
      }

      const signature = await account.signTypedData({
        domain,
        types: EIP3009_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: authorization,
      })

      const paymentPayload = { x402Version: 2, scheme: reqs.scheme, network: reqs.network, payload: { signature, authorization } }
      const header = b64encode(JSON.stringify(paymentPayload))

      const paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': header } })
      if (paid.status === 402) {
        await callback({ text: 'Payment rejected by the resource (still 402). Nothing was served; check funds/score.' })
        return false
      }
      if (!paid.ok) throw new Error(`Resource returned ${paid.status} after payment: ${paid.statusText}`)

      const body = await paid.text()
      elizaLogger.info(`[mintware] Paid $${priceUsd} USDC on ${reqs.network} for ${reqs.resource}`)

      await callback({ text: `Paid $${priceUsd} USDC on ${reqs.network}. Resource:\n\n${body}` })
      return true
    } catch (err) {
      elizaLogger.error('[mintware] PAY_X402 error:', err)
      await callback({
        text: `Failed to pay x402 resource: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'Pay x402 for https://api.example.com/compute' } },
      {
        user: '{{agentName}}',
        content: {
          text: 'Paid $0.01 USDC on base. Resource:\n\n{ "result": "…" }',
          action: 'PAY_X402',
        },
      },
    ],
  ],
}

// =============================================================================
// Plugin export
// =============================================================================

// =============================================================================
// Read actions — verified against the live route handlers (GET, no-auth)
// =============================================================================

const showVaultsAction: Action = {
  name: 'MINTWARE_VAULT_LIST',
  similes: ['SHOW_VAULTS', 'LIST_VAULTS', 'MINTWARE_VAULTS'],
  description: 'List Mintware liquidity vaults (dual-sided DeFi on Uniswap V4) with each vault\'s current epoch. In testing on Base Sepolia — read-only.',
  validate: async (): Promise<boolean> => true,
  handler: async (_runtime: IAgentRuntime, _message: Memory, _state: State | undefined, _options: Record<string, unknown>, callback: HandlerCallback): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/vaults`)
      if (!res.ok) throw new Error(`API returned ${res.status}: ${res.statusText}`)
      await callback({ text: 'Mintware vaults:\n\n' + JSON.stringify(await res.json(), null, 2) })
      return true
    } catch (err) {
      await callback({ text: `Failed to list vaults: ${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  },
  examples: [],
}

const showYieldsAction: Action = {
  name: 'MINTWARE_YIELDS',
  similes: ['SHOW_YIELDS', 'YIELD_BENCHMARKS', 'BEST_YIELDS'],
  description: 'Live yield benchmarks — curated real DeFi pools (base APY) Mintware references. Use to compare where idle capital could earn.',
  validate: async (): Promise<boolean> => true,
  handler: async (_runtime: IAgentRuntime, _message: Memory, _state: State | undefined, _options: Record<string, unknown>, callback: HandlerCallback): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/benchmarks/yields`)
      if (!res.ok) throw new Error(`API returned ${res.status}: ${res.statusText}`)
      await callback({ text: 'Live yield benchmarks:\n\n' + JSON.stringify(await res.json(), null, 2) })
      return true
    } catch (err) {
      await callback({ text: `Failed to fetch yields: ${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  },
  examples: [],
}

const showPoolsAction: Action = {
  name: 'MINTWARE_POOLS',
  similes: ['SHOW_POOLS', 'MINTWARE_LIQUIDITY_POOLS'],
  description: "Mintware's liquidity manifest for solver/aggregator networks (UniswapX, CoW, 1inch).",
  validate: async (): Promise<boolean> => true,
  handler: async (_runtime: IAgentRuntime, _message: Memory, _state: State | undefined, _options: Record<string, unknown>, callback: HandlerCallback): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/pools`)
      if (!res.ok) throw new Error(`API returned ${res.status}: ${res.statusText}`)
      await callback({ text: 'Mintware pool manifest:\n\n' + JSON.stringify(await res.json(), null, 2) })
      return true
    } catch (err) {
      await callback({ text: `Failed to fetch pools: ${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  },
  examples: [],
}

const mintwarePlugin: Plugin = {
  name: 'mintware-attribution',
  description: 'Mintware AI Attribution + capital parking (yield vault) + x402 pay-per-call for AI agents on Base/Arc',
  actions: [
    getAttributionScoreAction,
    registerMintwareAction,
    claimPendingActionsAction,
    parkUsdcAction,
    unparkUsdcAction,
    showTreasuryAction,
    quoteX402Action,
    payX402Action,
    showVaultsAction,
    showYieldsAction,
    showPoolsAction,
  ],
  evaluators: [],
  providers: [],
}

export default mintwarePlugin
export {
  mintwarePlugin,
  getAttributionScoreAction,
  registerMintwareAction,
  claimPendingActionsAction,
  parkUsdcAction,
  unparkUsdcAction,
  showTreasuryAction,
  quoteX402Action,
  payX402Action,
}
