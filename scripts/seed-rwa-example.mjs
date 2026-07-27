#!/usr/bin/env node
// =============================================================================
// scripts/seed-rwa-example.mjs
//
// Seeds ONE example RWA deal end-to-end so the RWA surface renders live:
//   · a VERIFIED issuer (vault_issuers)          → enables the create flow
//   · an RWA vault row (social_vaults, surface=rwa)
//   · an APPROVED deal (vault_deals)             → deal page shows content
//   · approved data-room documents (vault_deal_documents)
//
// Requires the 20260727000001_rwa_deal_schema migration to be applied first.
// Reversible: `node scripts/seed-rwa-example.mjs --remove`.
//
// Uses the Supabase REST API directly via fetch — no npm deps.
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

const ISSUER_ID = 'liquidhectar'
const VAULT_NAME = 'LiquidHectar Note (example)'
const encName = encodeURIComponent(VAULT_NAME)

const ISSUER_ROW = {
  id: ISSUER_ID,
  name: 'LiquidHectar',
  address: '0x59a2000000000000000000000000000000000076',
  status: 'VERIFIED',
  since: '2026-02',
  attribution_score: 312,
  deals_completed: 7,
  total_raised_usd: 8_400_000,
  default_rate_pct: 0,
  on_time_settlement_pct: 100,
  transparency: [
    { label: 'Audited financials', value: 'Quarterly' },
    { label: 'Reserve attestation', value: 'Monthly · Chainlink' },
    { label: 'Legal opinion', value: 'On file' },
    { label: 'Collateral ratio', value: '128%' },
  ],
  links: [{ label: 'Website', url: 'https://example.com' }],
}

const VAULT_ROW = {
  name: VAULT_NAME,
  team_wallet: '0x59a2000000000000000000000000000000000076',
  surface: 'rwa',
  vault_standard: 'erc4626',
  provider: ISSUER_ID,
  status: 'active',
  chain_id: 8453,
  tvl_usdc: 4_180_000,
}

const DEAL_FIELDS = {
  issuer_id: ISSUER_ID,
  description:
    'A senior-secured private-credit note backed by a diversified pool of ' +
    'short-duration real-estate bridge loans originated by LiquidHectar. ' +
    'Wrapped in a bankruptcy-remote SPV; tokenized as vRWA on Base.',
  yield_source_explainer:
    'Interest on the underlying bridge loans (weighted-avg 12% coupon), paid ' +
    'monthly into the reserve. Net of servicing, distributed to holders each epoch.',
  price_explainer:
    'vRWA tracks the SPV NAV, published monthly and attested by Chainlink Proof ' +
    'of Reserve. On-chain swaps are constrained to ±15% (core) / ±45% (spec) bands ' +
    'around the oracle price; trades outside the spec band revert.',
  underlying_asset_class: 'private-credit',
  target_apy_pct: 9,
  min_investment_usd: 1000,
  reserve_pct: 40,
  yield_pct: 60,
  price_band: '±15/±45',
  settle_days: 30,
  kyc_tier_required: 'BASIC',
  review_status: 'approved',
}

const DOCS = [
  { label: 'Note term sheet', url: 'https://example.com/term-sheet.pdf', kind: 'term_sheet' },
  { label: 'Legal opinion (SPV)', url: 'https://example.com/legal.pdf', kind: 'legal_opinion' },
  { label: 'SPV structure diagram', url: 'https://example.com/spv.pdf', kind: 'spv_structure' },
  { label: 'Q2 2026 audit', url: 'https://example.com/audit.pdf', kind: 'audit' },
]

const remove = process.argv.includes('--remove')

async function main() {
  const existing = await rest('GET', `social_vaults?name=eq.${encName}&select=id`)

  if (remove) {
    for (const row of existing ?? []) {
      const deals = await rest('GET', `vault_deals?vault_id=eq.${row.id}&select=id`)
      for (const d of deals ?? []) await rest('DELETE', `vault_deal_documents?deal_id=eq.${d.id}`)
      await rest('DELETE', `vault_deals?vault_id=eq.${row.id}`)
      await rest('DELETE', `social_vaults?id=eq.${row.id}`)
    }
    await rest('DELETE', `vault_issuers?id=eq.${ISSUER_ID}`)
    console.log(`✓ removed example RWA deal + issuer (${existing?.length ?? 0} vault row(s))`)
    return
  }

  if (existing?.length) {
    console.log(`· example RWA vault already exists: ${existing[0].id}`)
    console.log(`  view: /style/vaults/${existing[0].id}`)
    return
  }

  // 1) issuer (VERIFIED) — upsert so re-running is safe
  await rest('POST', 'vault_issuers', { body: ISSUER_ROW, prefer: 'resolution=merge-duplicates,return=minimal' })

  // 2) vault (RWA)
  const [vault] = await rest('POST', 'social_vaults', { body: VAULT_ROW, prefer: 'return=representation' })

  // 3) deal (approved)
  const [deal] = await rest('POST', 'vault_deals', {
    body: { ...DEAL_FIELDS, vault_id: vault.id },
    prefer: 'return=representation',
  })

  // 4) data-room documents (approved)
  await rest('POST', 'vault_deal_documents', {
    body: DOCS.map((d, i) => ({ ...d, deal_id: deal.id, review_status: 'approved', sort_order: i })),
    prefer: 'return=minimal',
  })

  console.log(`✓ seeded example RWA deal`)
  console.log(`  issuer:   ${ISSUER_ID} (VERIFIED)`)
  console.log(`  vault:    ${vault.id}`)
  console.log(`  deal:     ${deal.id} (approved) · ${DOCS.length} documents`)
  console.log(`  view:     /style/vaults/${vault.id}`)
  console.log(`\n  remove with: node scripts/seed-rwa-example.mjs --remove`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
