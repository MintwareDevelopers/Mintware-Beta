// =============================================================================
// oracle-watcher — PnL tracker
// Aggregates WETH net flows per agent and writes to ai_agent_pnl.
// No scoring impact — data-only display.
// =============================================================================

import type { Env, PnlLog } from './types.js'
import { supabaseUpsert, supabaseSelect } from './supabase.js'

// ── ETH price fetch ────────────────────────────────────────────────────────────

async function getEthPriceUsd(): Promise<number> {
  try {
    const res  = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD', {
      headers: { 'User-Agent': 'mintware-oracle-watcher/1.0' },
    })
    const json = await res.json() as { USD?: number }
    return json.USD ?? 0
  } catch (err) {
    console.warn('[pnl] Failed to fetch ETH price:', err)
    return 0
  }
}

// ── Aggregate PnL logs per agent ───────────────────────────────────────────────

interface AgentFlow {
  ethIn:   bigint   // total WETH received (wei)
  ethOut:  bigint   // total WETH sent (wei)
  trades:  number   // outflow count (proxy for trade count)
}

function aggregateFlows(pnlLogs: PnlLog[]): Map<string, AgentFlow> {
  const map = new Map<string, AgentFlow>()

  for (const log of pnlLogs) {
    const amount = BigInt(log.amountWei)
    if (!map.has(log.agentAddress)) {
      map.set(log.agentAddress, { ethIn: 0n, ethOut: 0n, trades: 0 })
    }
    const flow = map.get(log.agentAddress)!
    if (log.direction === 'in') {
      flow.ethIn += amount
    } else {
      flow.ethOut += amount
      flow.trades += 1
    }
  }

  return map
}

// ── Main updater ───────────────────────────────────────────────────────────────

export async function updateAgentPnl(env: Env, pnlLogs: PnlLog[]): Promise<void> {
  if (!pnlLogs.length) return

  const flows      = aggregateFlows(pnlLogs)
  const ethPriceUsd = await getEthPriceUsd()

  console.log(`[pnl] Updating PnL for ${flows.size} agents at ETH=$${ethPriceUsd}`)

  // Fetch existing PnL rows for these agents so we can accumulate (not overwrite)
  const addresses  = [...flows.keys()]
  const existing   = await supabaseSelect<{
    address: string
    total_eth_in:  string
    total_eth_out: string
    total_trades:  number
  }>(env, 'ai_agent_pnl', `select=address,total_eth_in,total_eth_out,total_trades&address=in.(${addresses.join(',')})`)

  const existingMap = new Map(existing.map(r => [r.address, r]))

  for (const [address, flow] of flows) {
    const prev = existingMap.get(address)

    const newEthIn   = (prev ? BigInt(prev.total_eth_in)  : 0n) + flow.ethIn
    const newEthOut  = (prev ? BigInt(prev.total_eth_out) : 0n) + flow.ethOut
    const newTrades  = (prev ? prev.total_trades          : 0)  + flow.trades

    // Realized PnL in ETH (out - in) — negative means agent spent more than it received
    const pnlEth     = newEthOut - newEthIn
    // Convert to decimal ETH for USD calc (divide by 1e18)
    const pnlEthDec  = Number(pnlEth) / 1e18
    const pnlUsd     = ethPriceUsd > 0 ? pnlEthDec * ethPriceUsd : 0

    await supabaseUpsert(env, 'ai_agent_pnl', {
      address,
      total_eth_in:     newEthIn.toString(),
      total_eth_out:    newEthOut.toString(),
      realized_pnl_usd: pnlUsd.toFixed(2),
      eth_price_usd:    ethPriceUsd,
      total_trades:     newTrades,
      updated_at:       new Date().toISOString(),
    }, 'address')

    console.log(`[pnl] ${address} — PnL: ${pnlEthDec.toFixed(4)} ETH ($${pnlUsd.toFixed(2)}), trades: ${newTrades}`)
  }
}
