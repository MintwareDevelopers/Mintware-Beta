// =============================================================================
// oracle-watcher — action recorder
// For each qualifying transfer: calls oracle sign API, stores pending signature.
// =============================================================================

import type { Env, TransferLog } from './types.js'
import { supabaseInsert } from './supabase.js'

const KV_PROCESSED_KEY = 'processed_txs'
const MAX_PROCESSED    = 10_000  // rolling cap to keep KV value manageable

// ── Dedup helpers ─────────────────────────────────────────────────────────────

async function getProcessedSet(env: Env): Promise<Set<string>> {
  const raw = await env.OW_STATE.get(KV_PROCESSED_KEY)
  if (!raw) return new Set()
  try {
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

async function saveProcessedSet(env: Env, set: Set<string>): Promise<void> {
  // Evict oldest entries if over cap (keep last MAX_PROCESSED)
  const arr   = [...set]
  const trimmed = arr.length > MAX_PROCESSED ? arr.slice(-MAX_PROCESSED) : arr
  await env.OW_STATE.put(KV_PROCESSED_KEY, JSON.stringify(trimmed))
}

// ── Main recorder ─────────────────────────────────────────────────────────────

export async function recordAgentLogs(env: Env, logs: TransferLog[]): Promise<void> {
  if (!logs.length) return

  const processed = await getProcessedSet(env)
  let   changed   = false

  // Process sequentially per agent to avoid nonce races
  for (const log of logs) {
    const txHash = log.transactionHash

    if (processed.has(txHash)) {
      console.log(`[recorder] Already processed ${txHash} — skipping`)
      continue
    }

    const agentAddress = ('0x' + log.topics[1].slice(26)).toLowerCase()
    const volumeWei    = BigInt(log.data).toString()

    console.log(`[recorder] Processing tx ${txHash} for agent ${agentAddress} volume=${volumeWei}`)

    try {
      // 1. Call oracle sign API
      const res = await fetch(`${env.ORACLE_API_BASE_URL}/api/agents/campaigns/record`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.ORACLE_SECRET}`,
        },
        body: JSON.stringify({
          address:    agentAddress,
          volumeWei,
          mwpHash:    null,
          campaignId: 0,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        console.error(`[recorder] Oracle API error (${res.status}) for ${agentAddress}:`, err)
        // Don't mark as processed — let it retry next run
        continue
      }

      const { signature, nonce, deadline } = await res.json() as {
        signature: string
        nonce:     string
        deadline:  string
      }

      // 2. Store pending signature in Supabase
      await supabaseInsert(env, 'ai_pending_signatures', {
        address:     agentAddress,
        tx_hash:     txHash,
        signature,
        nonce,
        deadline,
        volume_wei:  volumeWei,
        campaign_id: 0,
        claimed:     false,
      })

      // 3. Mark as processed
      processed.add(txHash)
      changed = true

      console.log(`[recorder] ✅ Signature stored for ${agentAddress} (tx: ${txHash})`)
    } catch (err) {
      console.error(`[recorder] Failed to process ${txHash}:`, err)
    }
  }

  if (changed) {
    await saveProcessedSet(env, processed)
  }
}
