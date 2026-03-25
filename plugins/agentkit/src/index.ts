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
// Exports
// =============================================================================

export const mintwareActions = [
  mintwareGetScoreAction,
  mintwareRegisterAction,
  mintwareClaimPendingAction,
]

export {
  mintwareGetScoreAction,
  mintwareRegisterAction,
  mintwareClaimPendingAction,
  BASE_MAINNET_CONTRACT,
  API_BASE,
}
