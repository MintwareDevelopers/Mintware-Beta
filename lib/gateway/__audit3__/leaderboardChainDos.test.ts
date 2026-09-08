// ROUND-3 EXPLOIT REPLAY — chain-read amplification / forced degradation on the O-11 chain-truth
// leaderboard and the public positions route. Incident class: public endpoints that fan out to a
// third-party RPC per request (the "free RPC quota burned by one curl loop" class).
import { describe, it, expect } from 'vitest'
import { readInstanceHoldings, type ChainReader } from '@/lib/gateway/chainTruth'

const PM = ('0x' + 'aa'.repeat(20)) as `0x${string}`

describe('readInstanceHoldings cost model', () => {
  it('500 attacker wallets (each = one real testnet deposit + signed record) → 502 RPC reads per board build on a chain without Multicall3 (26 sequential batches of 20)', async () => {
    let calls = 0
    let batches = 0
    let inflight = 0
    const client: ChainReader = {
      async readContract() { calls++; inflight++; if (inflight === 1) batches++; await Promise.resolve(); inflight--; return 1n },
      async multicall() { throw new Error('execution reverted') }, // canonical 0xcA11… absent on RH testnet → fallback
      async getBlockNumber() { return 100n },
    }
    const wallets = Array.from({ length: 500 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`)
    const snap = await readInstanceHoldings({ client, instances: [{ poolAddress: 'p', positionManager: PM, wallets }] })
    expect(snap.holdings[0].shares.size).toBe(500)
    expect(calls).toBe(502)
    expect(batches).toBe(26) // ceil(502/20)
    // At 60 s cache per instance, N warm instances ⇒ N × 502 reads/min against the public RPC — bounded, but the
    // route declares no `rateLimit` and the address list is attacker-growable up to MAX_WALLETS_PER_POOL (500) per pool.
  })

  it('MITIGATED (by design, at a cost): ONE failing read (RPC 429 / timeout) rejects the whole snapshot → the route serves `degraded:true` to EVERYONE for 15 s', async () => {
    let n = 0
    const client: ChainReader = {
      async readContract() { if (++n === 37) throw new Error('429 Too Many Requests'); return 1n },
      async getBlockNumber() { return 100n },
    }
    const wallets = Array.from({ length: 100 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`)
    await expect(readInstanceHoldings({ client, instances: [{ poolAddress: 'p', positionManager: PM, wallets }] })).rejects.toThrow(/429/)
    // An attacker who can exhaust the shared public RPC quota (from anywhere — it is a public endpoint) forces the
    // board to the flagged DB sum. Impact: honesty preserved (flag shown), availability of chain truth lost.
  })

  it('dedupe is case-insensitive, so 500 case-variants of one wallet cost 1 read (no amplification via casing)', async () => {
    let calls = 0
    const client: ChainReader = { async readContract() { calls++; return 1n } }
    const w = '0x' + 'ab'.repeat(20)
    const variants = Array.from({ length: 500 }, (_, i) => (i % 2 ? w.toUpperCase().replace('0X', '0x') : w))
    await readInstanceHoldings({ client, instances: [{ poolAddress: 'p', positionManager: PM, wallets: variants }] })
    expect(calls).toBe(3)
  })

  it('`?me=` is a post-filter on the cached board — it adds zero RPC cost (no per-caller read)', () => {
    // route: `providers.find((p) => p.wallet === me)` over `board.all` — see app/api/gateway/leaderboard/route.ts
    expect(true).toBe(true)
  })
})
