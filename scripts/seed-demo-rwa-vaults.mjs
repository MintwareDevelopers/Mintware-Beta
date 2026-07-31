#!/usr/bin/env node
// =============================================================================
// scripts/seed-demo-rwa-vaults.mjs
//
// Seeds 7 DEMO RWA vaults (social_vaults with surface='rwa') + an epoch each, so
// the /vaults RWA toggle shows real RWA cards (credit, T-bills, trade finance,
// real estate, energy). FICTIONAL showcase rows — reversible:
//   node scripts/seed-demo-rwa-vaults.mjs            # insert all 7
//   node scripts/seed-demo-rwa-vaults.mjs --remove   # delete all 7 (by name)
//
// Same shape/columns as the DeFi seed (scripts/seed-demo-vaults.mjs); only the
// surface differs. Uses the Supabase REST API + SERVICE-ROLE key from .env.local.
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

const SOCIAL_VAULT = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88'
const USDC         = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const HOOK         = '0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4'
const TEAM         = '0x9c646c48a302f4725450669f1218d3fdb3e933ad'
const CHAIN_ID     = 84532

// [name, vRWA token (display only), tvlUsdc, epochPool, status]
const VAULTS = [
  ['ATX Credit Facility',      '0x7a11e5c0ffee1111222233334444555566667777', 4_200_000, 21_600, 'active'],
  ['Sovereign T-Bill Ladder',  '0x7b12e5c0ffee1111222233334444555566668888', 8_640_000, 12_900, 'active'],
  ['LiquidHectar Note',        '0x7c13e5c0ffee1111222233334444555566669999', 1_920_000,  9_400, 'active'],
  ['Aspen Real-Estate Note',   '0x7d14e5c0ffee111122223333444455556666aaaa', 3_150_000, 14_800, 'active'],
  ['Meridian Trade Finance',   '0x7e15e5c0ffee111122223333444455556666bbbb', 2_430_000, 11_200, 'active'],
  ['Cascade Bridge Loan',      '0x7f16e5c0ffee111122223333444455556666cccc', 2_780_000, 12_100, 'active'],
  ['Helios Solar Off-take',    '0x7017e5c0ffee111122223333444455556666dddd', 1_180_000,  5_600, 'seeding'],
]

const remove = process.argv.includes('--remove')

function poolKey(token) {
  const lo = USDC.toLowerCase() < token.toLowerCase()
  return {
    currency0: lo ? USDC : token,
    currency1: lo ? token : USDC,
    fee: 3000, tickSpacing: 60, hooks: HOOK,
  }
}

async function main() {
  if (remove) {
    let removed = 0
    for (const [name] of VAULTS) {
      const rows = await rest('GET', `social_vaults?name=eq.${encodeURIComponent(name)}&select=id`)
      for (const row of rows ?? []) {
        await rest('DELETE', `vault_epochs?vault_id=eq.${row.id}`)
        await rest('DELETE', `social_vaults?id=eq.${row.id}`)
        removed++
      }
    }
    console.log(`✓ removed ${removed} demo RWA vault(s)`)
    return
  }

  let inserted = 0, skipped = 0
  for (const [name, token, tvl, pool, status] of VAULTS) {
    const existing = await rest('GET', `social_vaults?name=eq.${encodeURIComponent(name)}&select=id`)
    if (existing?.length) { skipped++; continue }

    const [row] = await rest('POST', 'social_vaults', {
      body: {
        name,
        team_wallet:      TEAM,
        project_token:    token.toLowerCase(),
        seed_amount:      Math.round(tvl / 20),
        pool_key:         poolKey(token),
        chain_id:         CHAIN_ID,
        contract_address: SOCIAL_VAULT,
        surface:          'rwa',
        status,
        tvl_usdc:         tvl,
      },
      prefer: 'return=representation',
    })
    await rest('POST', 'vault_epochs', {
      body: { vault_id: row.id, epoch_number: 1, total_pool: pool, bonus_pool: Math.round(pool * 0.1), status: 'active' },
      prefer: 'return=minimal',
    })
    inserted++
    console.log(`  + ${name}  ($${tvl.toLocaleString()} TVL · ${status})`)
  }
  console.log(`\n✓ seeded ${inserted} demo RWA vault(s)${skipped ? ` · ${skipped} already existed` : ''}`)
  console.log(`  remove with: node scripts/seed-demo-rwa-vaults.mjs --remove`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
