// =============================================================================
// @mintware/agentkit-actions
//
// Coinbase AgentKit actions for Mintware AI Attribution.
// Exposes three actions:
//   MINTWARE_GET_SCORE      — look up any agent's on-chain reputation score
//   MINTWARE_REGISTER       — register the agent wallet with Attribution
//   MINTWARE_CLAIM_PENDING  — submit oracle-signed attestations to the contract
//
// Contract (Base mainnet): 0xb9FB965Caa7197932b52631e0121Ea54586e2B88
// API base:                https://mintware.finance
// =============================================================================

import { z } from 'zod'
import {
  registerWithMintwareOracle,
  claimPendingActions,
} from '@mintware/ai-attribution-sdk'

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = 'https://mintware.finance'

const BASE_MAINNET_CONTRACT = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88' as const

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
    realized_pnl_usd?:   number
    unrealized_pnl_usd?: number
    total_pnl_usd?:      number
  } | null
}

// ── Helper: format score response into a readable string ──────────────────────

function formatScoreResponse(data: AgentScoreResponse): string {
  const addr  = data.address
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
// Action 1 — MINTWARE_GET_SCORE
// =============================================================================

const mintwareGetScoreAction = {
  name: 'MINTWARE_GET_SCORE',

  description:
    'Fetches the Mintware AI Attribution score for an agent address. ' +
    'If no address is provided, looks up the agent\'s own address via walletProvider. ' +
    'Returns total score, rank, behavior, contribution, interpretability, risk, transparent status, and PnL.',

  schema: z.object({
    address: z.string().optional().describe(
      'Ethereum address to look up. Omit to fetch the score for the agent\'s own wallet address.',
    ),
  }),

  invoke: async (
    walletProvider: { getAddress(): string },
    args: { address?: string },
  ): Promise<string> => {
    const address = (args.address ?? walletProvider.getAddress()).toLowerCase()

    const res = await fetch(`${API_BASE}/api/agents/${address}`)

    if (res.status === 404) {
      return (
        `No Attribution record found for ${address}. ` +
        `The agent may not be registered yet. Use MINTWARE_REGISTER to sign up.`
      )
    }

    if (!res.ok) {
      throw new Error(`Mintware API returned ${res.status}: ${res.statusText}`)
    }

    const data = (await res.json()) as AgentScoreResponse
    return formatScoreResponse(data)
  },
}

// =============================================================================
// Action 2 — MINTWARE_REGISTER
// =============================================================================

const mintwareRegisterAction = {
  name: 'MINTWARE_REGISTER',

  description:
    'Registers the agent wallet with the Mintware AI Attribution contract on Base mainnet. ' +
    'Reads the private key from the AGENT_PRIVATE_KEY environment variable. ' +
    'This is a one-time on-chain transaction — the agent pays gas. ' +
    'After registration the oracle watcher begins tracking on-chain activity automatically.',

  schema: z.object({}),

  invoke: async (
    walletProvider: { getAddress(): string },
    _args: Record<string, never>,
  ): Promise<string> => {
    const privateKey = process.env.AGENT_PRIVATE_KEY

    if (!privateKey) {
      throw new Error(
        'AGENT_PRIVATE_KEY environment variable is not set. ' +
        'Set it to the 0x-prefixed hex private key of the agent wallet before using MINTWARE_REGISTER.',
      )
    }

    const { address, txHash } = await registerWithMintwareOracle({
      privateKey:      privateKey as `0x${string}`,
      contractAddress: BASE_MAINNET_CONTRACT,
      apiBase:         API_BASE,
    })

    const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`
    const shortTx   = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`

    return [
      `Registration successful.`,
      ``,
      `Address:  ${shortAddr}`,
      `Tx Hash:  ${shortTx}`,
      `Network:  Base mainnet`,
      ``,
      `The Mintware oracle watcher will start tracking on-chain activity within ~60 seconds. ` +
      `Use MINTWARE_CLAIM_PENDING periodically to submit oracle-signed attestations and keep the score current.`,
    ].join('\n')
  },
}

// =============================================================================
// Action 3 — MINTWARE_CLAIM_PENDING
// =============================================================================

const mintwareClaimPendingAction = {
  name: 'MINTWARE_CLAIM_PENDING',

  description:
    'Fetches pending oracle-signed action attestations from the Mintware API and submits each to the ' +
    'AIAttribution contract on Base mainnet. The agent pays gas. ' +
    'Reads the private key from AGENT_PRIVATE_KEY. ' +
    'Run periodically to keep the Attribution score current.',

  schema: z.object({}),

  invoke: async (
    walletProvider: { getAddress(): string },
    _args: Record<string, never>,
  ): Promise<string> => {
    const privateKey = process.env.AGENT_PRIVATE_KEY

    if (!privateKey) {
      throw new Error(
        'AGENT_PRIVATE_KEY environment variable is not set. ' +
        'Set it to the 0x-prefixed hex private key of the agent wallet before using MINTWARE_CLAIM_PENDING.',
      )
    }

    const agent = walletProvider.getAddress() as `0x${string}`

    const result = await claimPendingActions({
      agent,
      privateKey:      privateKey as `0x${string}`,
      contractAddress: BASE_MAINNET_CONTRACT,
      apiBase:         API_BASE,
    })

    if (result.submitted === 0) {
      return 'No pending actions found. The Attribution score is already up to date.'
    }

    const hashLines = result.hashes
      .map((h: string, i: number) => `  ${i + 1}. ${h.slice(0, 10)}…${h.slice(-6)}`)
      .join('\n')

    return [
      `Successfully submitted ${result.submitted} attribution action${result.submitted === 1 ? '' : 's'} on-chain.`,
      ``,
      `Transactions:`,
      hashLines,
      ``,
      `The Attribution score will update on the next oracle sync (~60 seconds).`,
    ].join('\n')
  },
}

// =============================================================================
// x402 — pay for compute per call (spec: docs/developers/agentkit-compute-402-spec.md)
// =============================================================================

// Base64 helpers (Node + edge).
function b64decode(s: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : atob(s)
}
function b64encode(s: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(s)
}

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
const USDC_DOMAIN: Record<string, { name: string; version: string; chainId: number; verifyingContract: string }> = {
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

/** Minimal wallet surface x402 payment needs — `signTypedData` is present on EVM AgentKit providers. */
interface X402Wallet {
  getAddress(): string
  signTypedData?(params: { domain: unknown; types: unknown; primaryType: string; message: unknown }): Promise<string>
}

function randomNonce32(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes) // Web Crypto — global in Node 18+ and browsers
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
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

const mintwareX402QuoteAction = {
  name: 'MINTWARE_X402_QUOTE',
  description:
    'Preflight an x402-gated compute/API URL WITHOUT paying. Returns the price (USDC), network, recipient, ' +
    'and description advertised in the 402 challenge, so the agent can decide whether to pay.',
  schema: z.object({
    url: z.string().url().describe('The x402-protected resource URL to quote.'),
  }),
  invoke: async (_wallet: X402Wallet, args: { url: string }): Promise<string> => {
    const { res, reqs } = await readX402Challenge(args.url)
    if (!reqs) return `No payment required (HTTP ${res.status}). The resource is free or already served.`
    const usdc = (Number(reqs.maxAmountRequired) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })
    return [
      `x402 quote for ${reqs.resource}`,
      `  Price:    up to $${usdc} USDC`,
      `  Network:  ${reqs.network}`,
      `  Pay to:   ${reqs.payTo}`,
      `  Scheme:   ${reqs.scheme}`,
      reqs.description ? `  About:    ${reqs.description}` : '',
    ].filter(Boolean).join('\n')
  },
}

const mintwareX402PayAction = {
  name: 'MINTWARE_X402_PAY',
  description:
    'Pay for an x402-gated compute/API call from the agent wallet in USDC and return the resource. ' +
    'Reads the 402 challenge, enforces the optional maxAmountUsd cap, signs an EIP-3009 authorization, ' +
    'retries with the payment, and returns the resource body. Use MINTWARE_X402_QUOTE first to preview cost.',
  schema: z.object({
    url: z.string().url().describe('The x402-protected resource URL to pay for and fetch.'),
    maxAmountUsd: z.number().optional().describe('Hard cap on what to pay, in USD. Aborts if the price exceeds it.'),
  }),
  invoke: async (wallet: X402Wallet, args: { url: string; maxAmountUsd?: number }): Promise<string> => {
    const { res, reqs } = await readX402Challenge(args.url)
    if (!reqs) return await res.text() // already free/served

    const priceUsd = Number(reqs.maxAmountRequired) / 1e6
    if (args.maxAmountUsd != null && priceUsd > args.maxAmountUsd) {
      return `Aborted: price $${priceUsd} exceeds your cap $${args.maxAmountUsd}. Nothing paid.`
    }
    const domain = USDC_DOMAIN[reqs.network]
    if (!domain) return `Aborted: network "${reqs.network}" not supported for payment by this action.`
    if (!wallet.signTypedData) {
      throw new Error('This wallet provider cannot signTypedData — required to authorize an x402 (EIP-3009) payment.')
    }

    const now = Math.floor(Date.now() / 1000)
    const authorization = {
      from: wallet.getAddress(),
      to: reqs.payTo,
      value: reqs.maxAmountRequired,
      validAfter: String(now - 60),
      validBefore: String(now + (reqs.maxTimeoutSeconds ?? 300)),
      nonce: randomNonce32(),
    }
    const signature = await wallet.signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    })
    const paymentPayload = { x402Version: 2, scheme: reqs.scheme, network: reqs.network, payload: { signature, authorization } }
    const header = b64encode(JSON.stringify(paymentPayload))

    const paid = await fetch(args.url, { headers: { 'PAYMENT-SIGNATURE': header } })
    if (paid.status === 402) return `Payment rejected by the resource (still 402). Nothing was served; check funds/score.`
    if (!paid.ok) throw new Error(`Resource returned ${paid.status} after payment: ${paid.statusText}`)
    const body = await paid.text()
    return `Paid $${priceUsd} USDC on ${reqs.network}. Resource:\n\n${body}`
  },
}

const mintwareTreasuryAction = {
  name: 'MINTWARE_TREASURY',
  description:
    "Show the agent's Mintware capital-parking account: how much USDC is parked (and earning yield) and " +
    'how much is spendable in place right now. Parking does not lock — the full parked balance stays ' +
    'spendable per call via x402. Omit address to use the agent\'s own wallet.',
  schema: z.object({
    address: z.string().optional().describe("Address to inspect. Omit for the agent's own wallet."),
  }),
  invoke: async (wallet: X402Wallet, args: { address?: string }): Promise<string> => {
    const address = (args.address ?? wallet.getAddress()).toLowerCase()
    const res = await fetch(`${API_BASE}/api/x402/account?address=${address}`)
    if (!res.ok) throw new Error(`Mintware account API returned ${res.status}: ${res.statusText}`)
    const t = (await res.json()) as {
      parkedUsdcFormatted?: string
      spendableUsdcFormatted?: string
      earning?: boolean
      network?: string
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`
    return [
      `Mintware parking account for ${short} (${t.network ?? 'arc'})`,
      `  Parked (earning): $${t.parkedUsdcFormatted ?? '0'} USDC`,
      `  Spendable now:    $${t.spendableUsdcFormatted ?? '0'} USDC`,
      t.earning
        ? `  Status: earning yield, fully spendable in place — spend per call via MINTWARE_X402_PAY.`
        : `  Status: empty — deposit USDC into the vault to start earning while staying spendable.`,
    ].join('\n')
  },
}

// =============================================================================
// Exports
// =============================================================================

export const mintwareActions = [
  mintwareGetScoreAction,
  mintwareRegisterAction,
  mintwareClaimPendingAction,
  mintwareTreasuryAction,
  mintwareX402QuoteAction,
  mintwareX402PayAction,
]

export {
  mintwareGetScoreAction,
  mintwareRegisterAction,
  mintwareClaimPendingAction,
  mintwareTreasuryAction,
  mintwareX402QuoteAction,
  mintwareX402PayAction,
  BASE_MAINNET_CONTRACT,
  API_BASE,
}
