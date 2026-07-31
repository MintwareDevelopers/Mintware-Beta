#!/usr/bin/env node
// =============================================================================
// scripts/seed-demo-vaults.mjs
//
// Seeds 15 DEMO DeFi Social Vaults (+ an epoch-1 record each) so /vaults renders
// a full, lively grid for demos. These are FICTIONAL showcase rows — reversible:
//   node scripts/seed-demo-vaults.mjs            # insert all 15
//   node scripts/seed-demo-vaults.mjs --remove   # delete all 15 (by name)
//
// Same columns as POST /api/vaults/create and scripts/seed-example-vault.mjs.
// Uses the Supabase REST API via the SERVICE-ROLE key from .env.local (no deps).
// surface MUST be 'defi' or /api/vaults excludes the row from the list.
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

// Shared, safe references (points detail pages at the real, empty Base-Sepolia vault)
const SOCIAL_VAULT = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88'
const USDC         = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // Base USDC (display only)
const HOOK         = '0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4'
const TEAM         = '0x9c646c48a302f4725450669f1218d3fdb3e933ad'
const CHAIN_ID     = 84532

// [name, projectToken, tvlUsdc, epochPool, status]
const VAULTS = [
  ['ETH / USDC — Blue Chip',   '0x4200000000000000000000000000000000000006', 1_850_000, 12_400, 'active'],
  ['cbBTC / USDC',             '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 2_410_000, 18_900, 'active'],
  ['AERO / USDC',              '0x940181a94A35A4569E4529A3CDfB74e38FD98631',   980_000,  7_300, 'active'],
  ['DEGEN / USDC',             '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',   210_000,  2_100, 'active'],
  ['BRETT / USDC',             '0x532f27101965dd16442E59d40670FaF5eBB142E4',   155_000,  1_650, 'active'],
  ['VIRTUAL / USDC',           '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',   342_000,  3_050, 'active'],
  ['MORPHO / USDC',            '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842',   531_000,  4_400, 'active'],
  ['wstETH / ETH — LSD',       '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', 1_240_000,  9_800, 'active'],
  ['USDC / USDT — Stable',     '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 3_120_000,  6_200, 'active'],
  ['DAI / USDC — Stable',      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',   870_000,  3_400, 'active'],
  ['PENDLE / USDC',            '0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb3E',   280_000,  2_600, 'active'],
  ['OP / USDC',                '0x4200000000000000000000000000000000000042',   420_000,  3_900, 'active'],
  ['LINK / USDC',              '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',   615_000,  5_100, 'active'],
  ['TOSHI / USDC',             '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',    92_000,    900, 'seeding'],
  ['ZORA / USDC',              '0x1111111111166b7FE7bd91427724B487980aFc69',    64_000,    720, 'seeding'],
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
    console.log(`✓ removed ${removed} demo vault(s)`)
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
        surface:          'defi',
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
  console.log(`\n✓ seeded ${inserted} demo vault(s)${skipped ? ` · ${skipped} already existed` : ''}`)
  console.log(`  remove with: node scripts/seed-demo-vaults.mjs --remove`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
