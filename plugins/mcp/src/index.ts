#!/usr/bin/env node
// =============================================================================
// @mintware/mcp-server
//
// Model Context Protocol server — Mintware AI Attribution tools.
// Exposes four tools to Claude Desktop, Cursor, and any MCP-compatible client:
//
//   mintware_get_score      — fetch on-chain reputation score for an agent
//   mintware_leaderboard    — top agents by Attribution score
//   mintware_register       — register a wallet with the Attribution contract
//   mintware_claim_pending  — submit pending oracle attestations on-chain
//
// Contract (Base mainnet): 0xb9FB965Caa7197932b52631e0121Ea54586e2B88
// API base:                https://mintware.finance
// =============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import {
  registerWithMintwareOracle,
  claimPendingActions,
} from "@mintware/ai-attribution-sdk"

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "https://mintware.finance"
const BASE_MAINNET_CONTRACT = "0xb9FB965Caa7197932b52631e0121Ea54586e2B88" as const

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentProfile {
  address: string
  erc8004_token_id?: number | null
  erc8004_name?: string | null
  erc8004_model?: string | null
  is_transparent: boolean
  registered_at: string
}

interface AgentScore {
  address: string
  total_score: number
  rank?: number | null
  behavior: number
  contribution: number
  interpretability: number
  risk: number
  pnl?: {
    realized_pnl_usd?: number | null
    unrealized_pnl_usd?: number | null
    total_pnl_usd?: number | null
  } | null
}

interface AgentResponse {
  profile: AgentProfile
  score: AgentScore | null
  mwpHashes: string[]
}

interface LeaderboardEntry {
  address: string
  rank?: number | null
  total_score: number
  behavior: number
  contribution: number
  interpretability?: number
  risk?: number
  is_transparent: boolean
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[]
  total: number
  limit: number
  offset: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtPnl(n: number): string {
  const sign = n >= 0 ? "+" : ""
  return `${sign}$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
}

function formatScore(profile: AgentProfile, score: AgentScore | null, mwpHashes: string[]): string {
  const short = shortAddr(profile.address)
  const transparent = profile.is_transparent
    ? `Yes (MWP hash on-chain)`
    : "No"

  const s = score ?? {
    total_score: 0,
    rank: null,
    behavior: 0,
    contribution: 0,
    interpretability: 0,
    risk: 0,
    pnl: null,
  }

  let out = `Attribution Score for ${short}\n`
  out += `─────────────────────────────────────\n`
  out += `Total Score:      ${s.total_score}\n`
  out += `Rank:             ${s.rank != null ? `#${s.rank}` : "unranked"}\n`
  out += `\n`
  out += `Score Breakdown:\n`
  out += `  Behavior:         ${s.behavior}\n`
  out += `  Contribution:     ${s.contribution}\n`
  out += `  Interpretability: ${s.interpretability}\n`
  out += `  Risk Penalty:     ${s.risk}\n`
  out += `\n`
  out += `Transparent Agent: ${transparent}\n`

  if (mwpHashes.length > 0) {
    out += `MWP Submissions:   ${mwpHashes.length}\n`
  }

  if (profile.erc8004_name) {
    out += `\n`
    out += `Agent Name:  ${profile.erc8004_name}\n`
  }
  if (profile.erc8004_model) {
    out += `Model:       ${profile.erc8004_model}\n`
  }

  if (s.pnl && s.pnl.total_pnl_usd != null) {
    out += `\n`
    out += `PnL (all-time): ${fmtPnl(s.pnl.total_pnl_usd)}\n`
    if (s.pnl.realized_pnl_usd != null) {
      out += `  Realized:     ${fmtPnl(s.pnl.realized_pnl_usd)}\n`
    }
    if (s.pnl.unrealized_pnl_usd != null) {
      out += `  Unrealized:   ${fmtPnl(s.pnl.unrealized_pnl_usd)}\n`
    }
  }

  return out.trim()
}

function formatLeaderboard(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "No agents found."

  const lines = entries.map((e, i) => {
    const rank = e.rank != null ? `#${e.rank}` : `#${i + 1}`
    const addr = shortAddr(e.address)
    const transparent = e.is_transparent ? " [T]" : ""
    return `${rank.padEnd(5)} ${addr}  score: ${e.total_score}${transparent}`
  })

  return [
    "Mintware AI Attribution Leaderboard",
    "──────────────────────────────────────────",
    "Rank  Address          Score",
    "──────────────────────────────────────────",
    ...lines,
    "",
    "[T] = Transparent Agent (MWP hash on-chain)",
  ].join("\n")
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "mintware-attribution",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mintware_get_score",
        description:
          "Fetch the Mintware AI Attribution score for an agent wallet address on Base mainnet. " +
          "Returns the total score, rank, and breakdown across four dimensions: behavior (how well the agent " +
          "follows instructions and avoids harmful outputs), contribution (value created for users and the " +
          "ecosystem), interpretability (transparency via Model Workspace Protocol hash submissions), and " +
          "risk (penalty for unsafe or manipulative actions). Also returns PnL data if available and whether " +
          "the agent is a Transparent Agent.",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Ethereum wallet address of the AI agent (0x-prefixed, 42 characters)",
            },
          },
          required: ["address"],
        },
      },
      {
        name: "mintware_leaderboard",
        description:
          "Fetch the top AI agents on the Mintware Attribution leaderboard on Base mainnet. " +
          "Returns agents ranked by total Attribution score, with address, score, and transparent status. " +
          "Use this to discover high-performing agents, compare scores, or find the current rank leaders.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of agents to return (default: 10, max: 50)",
            },
          },
          required: [],
        },
      },
      {
        name: "mintware_register",
        description:
          "Register an AI agent wallet with the Mintware AI Attribution contract on Base mainnet. " +
          "This is a one-time on-chain transaction — the wallet pays a small amount of ETH gas. " +
          "After registration, the oracle watcher begins tracking the agent's on-chain activity automatically. " +
          "Requires the wallet's private key. IMPORTANT: only pass a private key for wallets you control " +
          "and only in a trusted, secure environment.",
        inputSchema: {
          type: "object",
          properties: {
            privateKey: {
              type: "string",
              description:
                "Private key of the agent wallet to register (0x-prefixed hex, 66 characters). " +
                "This key signs the registration transaction on Base mainnet.",
            },
          },
          required: ["privateKey"],
        },
      },
      {
        name: "mintware_claim_pending",
        description:
          "Fetch pending oracle-signed action attestations from the Mintware API and submit them " +
          "to the AIAttribution contract on Base mainnet. This updates the agent's on-chain score. " +
          "The agent wallet pays gas for each submitted attestation. Run this periodically to keep " +
          "the Attribution score current. Requires the wallet address and private key.",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Ethereum wallet address of the agent (0x-prefixed, 42 characters)",
            },
            privateKey: {
              type: "string",
              description:
                "Private key of the agent wallet (0x-prefixed hex, 66 characters). " +
                "Signs the claim transactions on Base mainnet.",
            },
          },
          required: ["address", "privateKey"],
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // ── mintware_get_score ────────────────────────────────────────────────────

  if (name === "mintware_get_score") {
    const { address } = args as { address: string }

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid address. Please provide a valid 0x-prefixed Ethereum address (42 characters).",
          },
        ],
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/agents/${address.toLowerCase()}`)

      if (res.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `No Attribution record found for ${address}. This agent may not be registered yet. Use mintware_register to sign up.`,
            },
          ],
        }
      }

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`)
      }

      const data = (await res.json()) as AgentResponse
      const formatted = formatScore(data.profile, data.score, data.mwpHashes)

      return {
        content: [{ type: "text", text: formatted }],
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch Attribution score: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  }

  // ── mintware_leaderboard ──────────────────────────────────────────────────

  if (name === "mintware_leaderboard") {
    const { limit = 10 } = (args ?? {}) as { limit?: number }
    const clampedLimit = Math.min(Math.max(1, limit), 50)

    try {
      const res = await fetch(
        `${API_BASE}/api/agents/leaderboard?limit=${clampedLimit}`
      )

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`)
      }

      const data = (await res.json()) as LeaderboardResponse
      const formatted = formatLeaderboard(data.leaderboard ?? [])

      const footer = `\nShowing ${data.leaderboard?.length ?? 0} of ${data.total ?? 0} registered agents.`

      return {
        content: [{ type: "text", text: formatted + footer }],
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch leaderboard: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  }

  // ── mintware_register ─────────────────────────────────────────────────────

  if (name === "mintware_register") {
    const { privateKey } = args as { privateKey: string }

    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid private key. Please provide a 0x-prefixed 64-character hex private key.",
          },
        ],
      }
    }

    try {
      const { address, txHash } = await registerWithMintwareOracle({
        privateKey: privateKey as `0x${string}`,
        contractAddress: BASE_MAINNET_CONTRACT,
        apiBase: API_BASE,
      })

      const shortAddress = shortAddr(address)
      const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`

      return {
        content: [
          {
            type: "text",
            text: [
              "Registration successful.",
              "",
              `Address:  ${shortAddress}`,
              `Tx Hash:  ${shortTx}`,
              `Network:  Base mainnet`,
              `Contract: ${shortAddr(BASE_MAINNET_CONTRACT)}`,
              "",
              "The Mintware oracle watcher will start tracking on-chain activity within ~60 seconds.",
              "Use mintware_claim_pending periodically to submit oracle-signed attestations and keep your score current.",
            ].join("\n"),
          },
        ],
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      if (
        msg.toLowerCase().includes("already") ||
        msg.toLowerCase().includes("registered")
      ) {
        return {
          content: [
            {
              type: "text",
              text: "This agent address is already registered with Mintware Attribution. Use mintware_claim_pending to submit any queued oracle attestations.",
            },
          ],
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Registration failed: ${msg}`,
          },
        ],
      }
    }
  }

  // ── mintware_claim_pending ────────────────────────────────────────────────

  if (name === "mintware_claim_pending") {
    const { address, privateKey } = args as {
      address: string
      privateKey: string
    }

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid address. Please provide a valid 0x-prefixed Ethereum address (42 characters).",
          },
        ],
      }
    }

    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid private key. Please provide a 0x-prefixed 64-character hex private key.",
          },
        ],
      }
    }

    try {
      const result = await claimPendingActions({
        agent: address as `0x${string}`,
        privateKey: privateKey as `0x${string}`,
        contractAddress: BASE_MAINNET_CONTRACT,
        apiBase: API_BASE,
      })

      if (result.submitted === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No pending actions found. The Attribution score is already up to date.",
            },
          ],
        }
      }

      const hashLines = result.hashes
        .map((h: string, i: number) => `  ${i + 1}. ${h.slice(0, 10)}…${h.slice(-6)}`)
        .join("\n")

      return {
        content: [
          {
            type: "text",
            text: [
              `Successfully submitted ${result.submitted} attribution action${result.submitted === 1 ? "" : "s"} on-chain.`,
              "",
              "Transactions:",
              hashLines,
              "",
              "The Attribution score will update on the next oracle sync (~60 seconds).",
            ].join("\n"),
          },
        ],
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      if (
        msg.toLowerCase().includes("not registered") ||
        msg.toLowerCase().includes("not found")
      ) {
        return {
          content: [
            {
              type: "text",
              text: "This agent is not yet registered with Mintware Attribution. Use mintware_register first.",
            },
          ],
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Failed to claim pending actions: ${msg}`,
          },
        ],
      }
    }
  }

  // ── Unknown tool ──────────────────────────────────────────────────────────

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[mintware-mcp] Fatal error: ${err}\n`)
  process.exit(1)
})
