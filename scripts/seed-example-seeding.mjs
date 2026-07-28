#!/usr/bin/env node
// =============================================================================
// scripts/seed-example-seeding.mjs
//
// Seeds an example fair-launch raise (vault_seeding + 2 contributions) on the
// existing "Example Vault (WETH/USDC)" so the SeedPanel renders live.
//
// Requires the 20260727000002_seed_schema migration applied first.
// Reversible: `node scripts/seed-example-seeding.mjs --remove`.
// Uses the Supabase REST API; reads env from .env.local.
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
if (!URL || !KEY) { console.error('✗ Missing Supabase env in .env.local'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(method, path, { body, prefer } = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { method, headers: prefer ? { ...H, Prefer: prefer } : H, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const VAULT_NAME = 'Example Vault (WETH/USDC)'
const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const remove = process.argv.includes('--remove')

async function main() {
  const [vault] = await rest('GET', `social_vaults?name=eq.${encodeURIComponent(VAULT_NAME)}&select=id`)
  if (!vault) { console.error(`✗ "${VAULT_NAME}" not found — run seed-example-vault.mjs first`); process.exit(1) }

  if (remove) {
    await rest('DELETE', `vault_seeding?vault_id=eq.${vault.id}`)
    console.log('✓ removed example seeding row (+ its contributions via cascade)')
    return
  }

  const existing = await rest('GET', `vault_seeding?vault_id=eq.${vault.id}&select=id`)
  if (existing?.length) { console.log(`· seeding already exists: ${existing[0].id}`); return }

  const deadline = new Date(Date.now() + 12 * 86_400_000).toISOString()
  const [seed] = await rest('POST', 'vault_seeding', {
    prefer: 'return=representation',
    body: {
      vault_id: vault.id, project_token: WETH, quote_token: USDC,
      token_reserve: 10_000, team_quote: 4_000, public_quote_target: 6_000, quote_target: 10_000,
      quote_raised: 5_500, deploy_threshold_bps: 5_000, threshold: 5_000,
      raise_deadline: deadline, chain_id: 84532, phase: 'seeding',
    },
  })
  await rest('POST', 'seed_contributions', {
    prefer: 'return=minimal',
    body: [
      { seeding_id: seed.id, contributor: '0x46bb4fea89dffc5a8a1187eb4a524275568f42d7', amount: 1_000 },
      { seeding_id: seed.id, contributor: '0x9c646c48a302f4725450669f1218d3fdb3e933ad', amount: 500 },
    ],
  })

  console.log('✓ seeded example fair-launch raise')
  console.log(`  vault:  ${vault.id}`)
  console.log(`  fill:   55% ($5.5K / $10K) · threshold 50% met`)
  console.log(`  view:   /vault/${vault.id}`)
  console.log('\n  remove with: node scripts/seed-example-seeding.mjs --remove')
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
