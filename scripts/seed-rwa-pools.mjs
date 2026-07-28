#!/usr/bin/env node
// =============================================================================
// scripts/seed-rwa-pools.mjs
//
// Seeds 3 more example RWA deals end-to-end (issuer + vault + approved deal +
// data-room docs) so each renders as a full deal page at /vault/<id>:
//   · Sovereign T-Bill      (Ancora Treasury)
//   · Meridian Trade Finance(Meridian Capital)
//   · Verdant Carbon Note   (Verdant Climate)
//
// Requires the rwa_deal_schema + phase3_vault_registry migrations applied.
// Reversible: `node scripts/seed-rwa-pools.mjs --remove`.
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

const POOLS = [
  {
    issuer: {
      id: 'ancora', name: 'Ancora Treasury', address: '0x7a11000000000000000000000000000000000001',
      status: 'VERIFIED', since: '2025-11', attribution_score: 340, deals_completed: 12,
      total_raised_usd: 42_000_000, default_rate_pct: 0, on_time_settlement_pct: 100,
      transparency: [
        { label: 'Custody', value: 'BNY Mellon' },
        { label: 'Reserve attestation', value: 'Weekly · Chainlink PoR' },
        { label: 'Audit', value: 'Big-4 · quarterly' },
      ],
    },
    vault: { name: 'Sovereign T-Bill', tvl_usdc: 8_450_000, status: 'active' },
    deal: {
      description: 'A vault of short-duration US Treasury bills (4–13 week), rolled weekly, wrapped in a bankruptcy-remote SPV and tokenized as vRWA. Principal sits in segregated custody; the vault holds only the tokenized claim.',
      yield_source_explainer: 'Treasury-bill discount yield (~5% weighted-average), swept weekly into the reserve and distributed each epoch.',
      price_explainer: 'vRWA tracks the T-bill portfolio NAV, published weekly and attested by Chainlink Proof-of-Reserve. On-chain swaps are constrained to ±5% (core) / ±15% (spec) around NAV.',
      underlying_asset_class: 'treasuries', target_apy_pct: 5.1, min_investment_usd: 1000,
      reserve_pct: 40, yield_pct: 60, price_band: '±5/±15', settle_days: 7, kyc_tier_required: 'BASIC',
    },
    docs: [
      { label: 'Fund fact sheet', url: 'https://example.com/ancora-factsheet.pdf', kind: 'term_sheet' },
      { label: 'Custody attestation', url: 'https://example.com/ancora-custody.pdf', kind: 'audit' },
      { label: 'SPV structure', url: 'https://example.com/ancora-spv.pdf', kind: 'spv_structure' },
    ],
  },
  {
    issuer: {
      id: 'meridian', name: 'Meridian Capital', address: '0x7a11000000000000000000000000000000000002',
      status: 'VERIFIED', since: '2026-01', attribution_score: 298, deals_completed: 5,
      total_raised_usd: 6_800_000, default_rate_pct: 0.4, on_time_settlement_pct: 98,
      transparency: [
        { label: 'Legal opinion', value: 'On file' },
        { label: 'Reserve ratio', value: '122%' },
        { label: 'Audit', value: 'Semi-annual' },
      ],
    },
    vault: { name: 'Meridian Trade Finance', tvl_usdc: 2_240_000, status: 'active' },
    deal: {
      description: 'Senior-secured trade-finance receivables — 90-day invoice factoring across a diversified pool of investment-grade importers. SPV-wrapped, over-collateralized.',
      yield_source_explainer: 'A ~13% weighted coupon on factored invoices, collected monthly, net of servicing.',
      price_explainer: 'NAV derived from the live receivables book, attested monthly. On-chain swaps banded ±15% (core) / ±45% (spec) around NAV.',
      underlying_asset_class: 'trade-finance', target_apy_pct: 11.8, min_investment_usd: 2500,
      reserve_pct: 40, yield_pct: 60, price_band: '±15/±45', settle_days: 30, kyc_tier_required: 'BASIC',
    },
    docs: [
      { label: 'Note term sheet', url: 'https://example.com/meridian-term-sheet.pdf', kind: 'term_sheet' },
      { label: 'Legal opinion', url: 'https://example.com/meridian-legal.pdf', kind: 'legal_opinion' },
      { label: 'SPV structure', url: 'https://example.com/meridian-spv.pdf', kind: 'spv_structure' },
      { label: 'H1 audit', url: 'https://example.com/meridian-audit.pdf', kind: 'audit' },
    ],
  },
  {
    issuer: {
      id: 'verdant', name: 'Verdant Climate', address: '0x7a11000000000000000000000000000000000003',
      status: 'VERIFIED', since: '2026-03', attribution_score: 265, deals_completed: 2,
      total_raised_usd: 1_100_000, default_rate_pct: 0, on_time_settlement_pct: 100,
      transparency: [
        { label: 'Registry', value: 'Verra · Gold Standard' },
        { label: 'Verification', value: 'Third-party, annual' },
        { label: 'Legal opinion', value: 'On file' },
      ],
    },
    vault: { name: 'Verdant Carbon Note', tvl_usdc: 640_000, status: 'seeding' },
    deal: {
      description: 'Yield backed by a portfolio of verified carbon-offset forward purchase agreements (Verra / Gold Standard registered). A newer, higher-variance RWA surface.',
      yield_source_explainer: 'Offset price appreciation plus retirement premiums realized as credits are delivered and retired.',
      price_explainer: 'NAV from registry-verified offset inventory, marked monthly. Wider bands reflect the asset: ±20% (core) / ±60% (spec).',
      underlying_asset_class: 'energy', target_apy_pct: 7.2, min_investment_usd: 5000,
      reserve_pct: 40, yield_pct: 60, price_band: '±20/±60', settle_days: 45, kyc_tier_required: 'ACCREDITED',
    },
    docs: [
      { label: 'Registry attestation', url: 'https://example.com/verdant-registry.pdf', kind: 'audit' },
      { label: 'Verification report', url: 'https://example.com/verdant-verification.pdf', kind: 'audit' },
      { label: 'Legal opinion', url: 'https://example.com/verdant-legal.pdf', kind: 'legal_opinion' },
    ],
  },
]

const remove = process.argv.includes('--remove')

async function main() {
  if (remove) {
    for (const p of POOLS) {
      const vs = await rest('GET', `social_vaults?name=eq.${encodeURIComponent(p.vault.name)}&select=id`)
      for (const v of vs ?? []) {
        const deals = await rest('GET', `vault_deals?vault_id=eq.${v.id}&select=id`)
        for (const d of deals ?? []) await rest('DELETE', `vault_deal_documents?deal_id=eq.${d.id}`)
        await rest('DELETE', `vault_deals?vault_id=eq.${v.id}`)
        await rest('DELETE', `social_vaults?id=eq.${v.id}`)
      }
      await rest('DELETE', `vault_issuers?id=eq.${p.issuer.id}`)
    }
    console.log('✓ removed 3 example RWA pools + their issuers')
    return
  }

  for (const p of POOLS) {
    const exists = await rest('GET', `social_vaults?name=eq.${encodeURIComponent(p.vault.name)}&select=id`)
    if (exists?.length) { console.log(`· "${p.vault.name}" already exists: ${exists[0].id}`); continue }

    await rest('POST', 'vault_issuers', { prefer: 'resolution=merge-duplicates,return=minimal', body: p.issuer })
    const [vault] = await rest('POST', 'social_vaults', {
      prefer: 'return=representation',
      body: {
        name: p.vault.name, team_wallet: p.issuer.address, surface: 'rwa', vault_standard: 'erc4626',
        provider: p.issuer.id, status: p.vault.status, chain_id: 8453, tvl_usdc: p.vault.tvl_usdc,
      },
    })
    const [deal] = await rest('POST', 'vault_deals', {
      prefer: 'return=representation',
      body: { ...p.deal, vault_id: vault.id, issuer_id: p.issuer.id, review_status: 'approved' },
    })
    await rest('POST', 'vault_deal_documents', {
      prefer: 'return=minimal',
      body: p.docs.map((d, i) => ({ ...d, deal_id: deal.id, review_status: 'approved', sort_order: i })),
    })
    console.log(`✓ ${p.vault.name}  →  /vault/${vault.id}`)
  }
  console.log('\n  remove with: node scripts/seed-rwa-pools.mjs --remove')
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
