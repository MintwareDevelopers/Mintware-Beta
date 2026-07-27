#!/usr/bin/env node
// =============================================================================
// scripts/seed-example-vault.mjs
//
// Seeds ONE example Social Vault row (+ its epoch-1 record) that points at the
// REAL deployed SocialVault on Base Sepolia, so /vaults and /vault/[id] render
// live and the on-chain position panel (positions()/totalLiquidity()) resolves.
//
// Mirrors exactly what POST /api/vaults/create writes — same columns. Fully
// reversible: `node scripts/seed-example-vault.mjs --remove`.
//
// Uses the Supabase REST API (PostgREST) directly via fetch — no npm deps.
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
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

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

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

// ── the example vault (points at the real Base-Sepolia SocialVault) ──────────
const SOCIAL_VAULT  = '0xb9FB965Caa7197932b52631e0121Ea54586e2B88' // deployed + verified
const USDC          = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Base Sepolia USDC
const HOOK          = '0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4' // MWSocialHook
const PROJECT_TOKEN = '0x4200000000000000000000000000000000000006' // WETH — example pair
const NAME = 'Example Vault (WETH/USDC)'

const c0 = USDC.toLowerCase() < PROJECT_TOKEN.toLowerCase() ? USDC : PROJECT_TOKEN
const c1 = USDC.toLowerCase() < PROJECT_TOKEN.toLowerCase() ? PROJECT_TOKEN : USDC

const VAULT_ROW = {
  name:             NAME,
  team_wallet:      '0x9c646c48a302f4725450669f1218d3fdb3e933ad',
  project_token:    PROJECT_TOKEN.toLowerCase(),
  seed_amount:      1000,
  pool_key:         { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: HOOK },
  chain_id:         84532,
  contract_address: SOCIAL_VAULT,
  status:           'active',
  tvl_usdc:         0,
}

const remove = process.argv.includes('--remove')
const encName = encodeURIComponent(NAME)

async function main() {
  const existing = await rest('GET', `social_vaults?name=eq.${encName}&select=id`)

  if (remove) {
    if (!existing?.length) { console.log('· nothing to remove — no example vault found'); return }
    for (const row of existing) {
      await rest('DELETE', `vault_epochs?vault_id=eq.${row.id}`)
      await rest('DELETE', `social_vaults?id=eq.${row.id}`)
    }
    console.log(`✓ removed example vault(s): ${existing.map(r => r.id).join(', ')}`)
    return
  }

  if (existing?.length) {
    console.log(`· example vault already exists: ${existing[0].id}`)
    console.log(`  view: /vault/${existing[0].id}`)
    return
  }

  const [row] = await rest('POST', 'social_vaults', { body: VAULT_ROW, prefer: 'return=representation' })
  await rest('POST', 'vault_epochs', {
    body: { vault_id: row.id, epoch_number: 1, total_pool: 0, bonus_pool: 0, status: 'active' },
    prefer: 'return=minimal',
  })

  console.log(`✓ seeded "${row.name}" (${row.status})`)
  console.log(`  id:       ${row.id}`)
  console.log(`  view:     /vault/${row.id}`)
  console.log(`  contract: ${SOCIAL_VAULT} (Base Sepolia)`)
  console.log(`\n  remove with: node scripts/seed-example-vault.mjs --remove`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
