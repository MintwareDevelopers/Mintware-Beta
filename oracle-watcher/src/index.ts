// =============================================================================
// oracle-watcher — Cloudflare Worker entry point
//
// Cron: every 60 seconds
//   → Scans Base Sepolia for WETH transfers from registered AI agents
//   → Gets EIP-712 oracle signatures from Mintware API (oracle pays nothing)
//   → Stores pending signatures in Supabase for agents to pick up and submit
//
// HTTP: health check + manual trigger (for testing)
// =============================================================================

import type { Env }                          from './types.js'
import { scanForAgentActivity, saveLastBlock } from './scanner.js'
import { recordAgentLogs }                   from './recorder.js'
import { updateAgentPnl }                    from './pnl.js'

async function run(env: Env): Promise<void> {
  console.log('[oracle-watcher] Starting run...')
  try {
    const { logs, pnlLogs, newLastBlock } = await scanForAgentActivity(env)
    await recordAgentLogs(env, logs)
    await updateAgentPnl(env, pnlLogs)
    await saveLastBlock(env, newLastBlock)
    console.log(`[oracle-watcher] Run complete. Scored: ${logs.length}, PnL events: ${pnlLogs.length}, last block: ${newLastBlock}`)
  } catch (err) {
    console.error('[oracle-watcher] Run failed:', err)
  }
}

export default {
  // Cron trigger — fires every 60 seconds
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env))
  },

  // HTTP handler — health check + manual trigger for testing
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'oracle-watcher' })
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      // Verify internal secret to prevent unauthorized triggers
      const auth = request.headers.get('authorization')
      if (auth !== `Bearer ${env.ORACLE_SECRET}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      ctx.waitUntil(run(env))
      return Response.json({ ok: true, message: 'Run triggered' })
    }

    return new Response('oracle-watcher', { status: 200 })
  },
}
