#!/usr/bin/env node
// =============================================================================
// scripts/seed-demo-agents.mjs
//
// Seeds 25 DEMO AI agents (ai_agent_profiles + ai_agent_scores) so the
// /agents/leaderboard renders a full board. total_score + rank are computed by
// the ai_agent_leaderboard view (total_score is a GENERATED column — never insert
// it). FICTIONAL showcase rows — reversible:
//   node scripts/seed-demo-agents.mjs            # insert all 25
//   node scripts/seed-demo-agents.mjs --remove   # delete all 25
//
// Uses the Supabase REST API via the SERVICE-ROLE key from .env.local (no deps).
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fall back to process.env */ }
  return { ...env, ...process.env }
}

const env = loadEnv()
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(method, path, { body, prefer } = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// [address, erc8004_token_id|null, behavior, contribution, interpretability, risk, mwp_submissions, is_transparent]
// total_score = greatest(0, behavior + contribution + interpretability - risk) — computed by DB.
const AGENTS = [
  ['0x9c646c48a302f4725450669f1218d3fdb3e933ad', 37298, 42, 31, 22, 2, 14, true],
  ['0x7a3fbe1c9d2e4a5b6c8d0e1f2a3b4c5d6e7f8a90', 37301, 40, 28, 20, 3, 11, true],
  ['0x1f2e3d4c5b6a798887766554433221100ffeeadd', 37305, 38, 27, 19, 4, 9,  true],
  ['0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678', null,  36, 25, 18, 3, 8,  true],
  ['0xdead00fa11ce7b0c1d2e3f405162738495a6b7c8', 37310, 34, 24, 16, 4, 7,  false],
  ['0x0f1e2d3c4b5a69788796a5b4c3d2e1f00918273a', 37312, 33, 22, 17, 5, 7,  true],
  ['0xbeef1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b', null,  31, 21, 15, 4, 6,  false],
  ['0x2b4d6f8a0c1e3050708192a3b4c5d6e7f8091a2b', 37318, 30, 19, 16, 6, 6,  true],
  ['0xc0ffee254729296a45a3885639AC7E10F9d54979', null,  29, 20, 13, 5, 5,  false],
  ['0x3141592653589793238462643383279502884197', 37322, 28, 18, 14, 6, 5,  true],
  ['0x5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b', null,  27, 17, 12, 5, 4,  false],
  ['0x8badf00d1234567890abcdef1234567890abcdef', 37327, 25, 16, 13, 6, 4,  true],
  ['0x6f7e8d9c0b1a2938475665748392a1b0c9d8e7f6', null,  24, 15, 11, 5, 3,  false],
  ['0xfeedface00c0ffee00d15ea5e00b16b00c0de001', 37330, 23, 14, 10, 6, 3,  false],
  ['0x4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70', null,  22, 13, 11, 7, 3,  true],
  ['0xabad1deacafe1234567890abcdef1234567890ab', null,  20, 12, 9,  5, 2,  false],
  ['0x7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809', 37341, 19, 11, 8,  6, 2,  false],
  ['0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', null,  18, 10, 7,  6, 2,  false],
  ['0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d', null,  16, 9,  8,  7, 1,  false],
  ['0x0d1c2b3a49586776859403a2b1c0d9e8f7a6b5c4', 37350, 15, 8,  6,  6, 1,  false],
  ['0x5f6e7d8c9b0a19283746556473829100a1b2c3d4', null,  13, 7,  6,  7, 1,  false],
  ['0x2c3d4e5f60718293a4b5c6d7e8f901234567890a', null,  12, 6,  5,  7, 0,  false],
  ['0x8f9e0d1c2b3a4958677685940a3b2c1d0e9f8a7b', null,  10, 5,  5,  8, 0,  false],
  ['0x3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e', null,  9,  4,  4,  8, 0,  false],
  ['0x6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b', null,  7,  3,  4,  9, 0,  false],
]

const remove = process.argv.includes('--remove')

async function main() {
  if (remove) {
    let removed = 0
    for (const [address] of AGENTS) {
      const a = address.toLowerCase()
      await rest('DELETE', `ai_agent_scores?address=eq.${a}`)
      const gone = await rest('DELETE', `ai_agent_profiles?address=eq.${a}`, { prefer: 'return=representation' })
      if (gone?.length) removed++
    }
    console.log(`✓ removed ${removed} demo agent(s)`)
    return
  }

  let inserted = 0, skipped = 0
  for (const [address, tokenId, behavior, contribution, interpretability, risk, mwp, transparent] of AGENTS) {
    const a = address.toLowerCase()
    const existing = await rest('GET', `ai_agent_profiles?address=eq.${a}&select=address`)
    if (existing?.length) { skipped++; continue }

    await rest('POST', 'ai_agent_profiles', {
      body: { address: a, erc8004_token_id: tokenId },
      prefer: 'return=minimal',
    })
    await rest('POST', 'ai_agent_scores', {
      body: {
        address: a, behavior, contribution, interpretability, risk,
        mwp_submissions: mwp, is_transparent: transparent,
      },
      prefer: 'return=minimal',
    })
    inserted++
    const total = Math.max(0, behavior + contribution + interpretability - risk)
    console.log(`  + ${a.slice(0, 10)}…  total ${total}${transparent ? ' · transparent' : ''}`)
  }
  console.log(`\n✓ seeded ${inserted} demo agent(s)${skipped ? ` · ${skipped} already existed` : ''}`)
  console.log(`  remove with: node scripts/seed-demo-agents.mjs --remove`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
