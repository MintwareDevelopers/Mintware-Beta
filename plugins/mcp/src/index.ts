#!/usr/bin/env node
// =============================================================================
// @mintware/mcp-server
//
// Model Context Protocol server — Mintware tools for Claude Desktop, Cursor, and any MCP client.
//
//   Attribution:
//     mintware_get_score      — fetch on-chain reputation score for an agent
//     mintware_leaderboard    — top agents by Attribution score
//     mintware_register       — register a wallet with the Attribution contract
//     mintware_claim_pending  — submit pending oracle attestations on-chain
//   Parking account + x402 compute payments (spec: docs/developers/agentkit-compute-402-spec.md):
//     mintware_parking_account — USDC parked (earning) + spendable in place
//     mintware_x402_quote      — preflight an x402-gated URL's price (no pay)
//     mintware_x402_pay        — pay for an x402 call in USDC (EIP-3009) + return the resource
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

import { privateKeyToAccount } from "viem/accounts"

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "https://mintware.finance"
const BASE_MAINNET_CONTRACT = "0xb9FB965Caa7197932b52631e0121Ea54586e2B88" as const

// ── x402 (agent compute payments) — spec: docs/developers/agentkit-compute-402-spec.md ──────────────

interface X402Requirements {
  scheme: "exact" | "deferred"
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

/** EIP-712 domain for USDC transferWithAuthorization (EIP-3009), per x402 network. */
const USDC_DOMAIN: Record<string, { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }> = {
  base: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  "base-sepolia": { name: "USDC", version: "2", chainId: 84532, verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const

function b64decode(s: string): string {
  return Buffer.from(s, "base64").toString("utf8")
}
function b64encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64")
}
function randomNonce32(): `0x${string}` {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`
}

/** Fetch a URL; if 402, return the first advertised x402 requirements (else null = free/served). */
async function readX402Challenge(url: string): Promise<{ res: Response; reqs: X402Requirements | null }> {
  const res = await fetch(url)
  if (res.status !== 402) return { res, reqs: null }
  const header = res.headers.get("payment-required") ?? res.headers.get("PAYMENT-REQUIRED")
  const raw = header ? b64decode(header) : await res.clone().text()
  const parsed = JSON.parse(raw) as { accepts?: X402Requirements[] }
  return { res, reqs: parsed.accepts?.[0] ?? null }
}

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
      {
        name: "mintware_parking_account",
        description:
          "Show an agent's Mintware capital-parking account: how much USDC is parked (and earning yield) and " +
          "how much is spendable in place right now. Mintware lets an agent park idle USDC in a yield vault " +
          "where it earns, and spend it per call over x402 without ever un-parking — parking never locks. " +
          "Read-only, no key required.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Agent wallet address (0x-prefixed, 42 chars)." },
          },
          required: ["address"],
        },
      },
      {
        name: "mintware_x402_quote",
        description:
          "Preflight an x402-gated compute/API URL WITHOUT paying. Returns the price (USDC), network, " +
          "recipient, and description advertised in the HTTP 402 challenge, so you can decide whether to pay. " +
          "Read-only, no key required.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The x402-protected resource URL to quote." },
          },
          required: ["url"],
        },
      },
      {
        name: "mintware_x402_pay",
        description:
          "Pay for an x402-gated compute/API call in USDC and return the resource. Reads the 402 challenge, " +
          "enforces the optional maxAmountUsd cap, signs an EIP-3009 USDC authorization with the provided key, " +
          "retries with the payment, and returns the resource body. IMPORTANT: only pass a private key for a " +
          "wallet you control, in a trusted environment. Use mintware_x402_quote first to preview cost.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The x402-protected resource URL to pay for and fetch." },
            privateKey: {
              type: "string",
              description: "Private key of the paying wallet (0x-prefixed hex, 66 chars). Signs the EIP-3009 authorization.",
            },
            maxAmountUsd: { type: "number", description: "Hard cap on what to pay, in USD. Aborts if the price exceeds it." },
          },
          required: ["url", "privateKey"],
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

  // ── mintware_parking_account ──────────────────────────────────────────────

  if (name === "mintware_parking_account") {
    const { address } = args as { address: string }
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return { content: [{ type: "text", text: "Invalid address. Provide a valid 0x-prefixed address (42 chars)." }] }
    }
    try {
      const res = await fetch(`${API_BASE}/api/x402/account?address=${address.toLowerCase()}`)
      if (!res.ok) throw new Error(`API returned ${res.status}: ${res.statusText}`)
      const t = (await res.json()) as {
        parkedUsdcFormatted?: string
        spendableUsdcFormatted?: string
        earning?: boolean
        network?: string
      }
      const text = [
        `Mintware parking account for ${shortAddr(address)} (${t.network ?? "arc"})`,
        `  Parked (earning): $${t.parkedUsdcFormatted ?? "0"} USDC`,
        `  Spendable now:    $${t.spendableUsdcFormatted ?? "0"} USDC`,
        t.earning
          ? "  Status: earning yield, fully spendable in place — spend per call with mintware_x402_pay."
          : "  Status: empty — deposit USDC into the vault to start earning while staying spendable.",
      ].join("\n")
      return { content: [{ type: "text", text }] }
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to read parking account: ${err instanceof Error ? err.message : String(err)}` }] }
    }
  }

  // ── mintware_x402_quote ───────────────────────────────────────────────────

  if (name === "mintware_x402_quote") {
    const { url } = args as { url: string }
    try {
      const { res, reqs } = await readX402Challenge(url)
      if (!reqs) return { content: [{ type: "text", text: `No payment required (HTTP ${res.status}). The resource is free or already served.` }] }
      const usdc = (Number(reqs.maxAmountRequired) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })
      const text = [
        `x402 quote for ${reqs.resource}`,
        `  Price:    up to $${usdc} USDC`,
        `  Network:  ${reqs.network}`,
        `  Pay to:   ${reqs.payTo}`,
        `  Scheme:   ${reqs.scheme}`,
        reqs.description ? `  About:    ${reqs.description}` : "",
      ].filter(Boolean).join("\n")
      return { content: [{ type: "text", text }] }
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to quote: ${err instanceof Error ? err.message : String(err)}` }] }
    }
  }

  // ── mintware_x402_pay ─────────────────────────────────────────────────────

  if (name === "mintware_x402_pay") {
    const { url, privateKey, maxAmountUsd } = args as { url: string; privateKey: string; maxAmountUsd?: number }
    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      return { content: [{ type: "text", text: "Invalid private key. Provide a 0x-prefixed 64-char hex key." }] }
    }
    try {
      const { res, reqs } = await readX402Challenge(url)
      if (!reqs) return { content: [{ type: "text", text: await res.text() }] } // already free/served

      const priceUsd = Number(reqs.maxAmountRequired) / 1e6
      if (maxAmountUsd != null && priceUsd > maxAmountUsd) {
        return { content: [{ type: "text", text: `Aborted: price $${priceUsd} exceeds your cap $${maxAmountUsd}. Nothing paid.` }] }
      }
      const domain = USDC_DOMAIN[reqs.network]
      if (!domain) return { content: [{ type: "text", text: `Aborted: network "${reqs.network}" not supported for payment.` }] }

      const account = privateKeyToAccount(privateKey as `0x${string}`)
      const now = Math.floor(Date.now() / 1000)
      const authorization = {
        from: account.address,
        to: reqs.payTo as `0x${string}`,
        value: BigInt(reqs.maxAmountRequired),
        validAfter: BigInt(now - 60),
        validBefore: BigInt(now + (reqs.maxTimeoutSeconds ?? 300)),
        nonce: randomNonce32(),
      }
      const signature = await account.signTypedData({
        domain,
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: authorization,
      })
      // Serialize BigInts as decimal strings for the wire payload.
      const wireAuth = {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      }
      const header = b64encode(JSON.stringify({ x402Version: 2, scheme: reqs.scheme, network: reqs.network, payload: { signature, authorization: wireAuth } }))

      const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": header } })
      if (paid.status === 402) return { content: [{ type: "text", text: "Payment rejected by the resource (still 402). Nothing served; check funds/policy." }] }
      if (!paid.ok) throw new Error(`Resource returned ${paid.status} after payment: ${paid.statusText}`)
      const body = await paid.text()
      return { content: [{ type: "text", text: `Paid $${priceUsd} USDC on ${reqs.network}. Resource:\n\n${body}` }] }
    } catch (err) {
      return { content: [{ type: "text", text: `x402 payment failed: ${err instanceof Error ? err.message : String(err)}` }] }
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
