// =============================================================================
// RWA data source (SERVER-ONLY) — reads the vault_issuers / vault_deals /
// vault_deal_documents / vault_redemptions tables via the service client.
//
// Every function is defensive: if the tables don't exist yet (migration not
// applied) or a query errors, it returns null / [] so callers fall back to mock.
// Never import this from a client component — it pulls the service-role client.
// =============================================================================

import { getServiceClient } from '@/lib/web2/supabase'
import type { IssuerProfile } from './issuer'
import type { RedemptionRequest } from './redemptions'
import type { DealMeta, DealDocument, DocKind, DocReviewStatus, KycTier, DealReviewStatus } from './deal'
import type { VaultSummary, VaultStatus } from '@/lib/vaults/discovery'

function daysBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

// ─── Issuer ──────────────────────────────────────────────────────────────────
export async function dbGetIssuer(id?: string): Promise<IssuerProfile | null> {
  try {
    const sb = getServiceClient()
    let q = sb.from('vault_issuers').select('*')
    q = id ? q.eq('id', id) : q.eq('status', 'VERIFIED')
    const { data: issuer, error } = await q.limit(1).maybeSingle()
    if (error || !issuer) return null

    // Vaults for this issuer = social_vaults referenced by its approved deals.
    const { data: deals } = await sb
      .from('vault_deals')
      .select('target_apy_pct, social_vaults(name, tvl_usdc, status)')
      .eq('issuer_id', issuer.id)

    const vaults = (deals ?? []).flatMap((d: Record<string, unknown>) => {
      const v = d.social_vaults as { name?: string; tvl_usdc?: number; status?: string } | null
      if (!v?.name) return []
      return [{
        name: v.name,
        tvlUsd: Number(v.tvl_usdc ?? 0),
        apyPct: Number(d.target_apy_pct ?? 0),
        status: (v.status === 'active' ? 'active' : 'seeding') as 'active' | 'seeding',
      }]
    })

    return {
      id: issuer.id,
      name: issuer.name,
      address: issuer.address,
      status: issuer.status,
      since: issuer.since ?? '',
      attributionScore: Number(issuer.attribution_score ?? 0),
      dealsCompleted: Number(issuer.deals_completed ?? 0),
      totalRaisedUsd: Number(issuer.total_raised_usd ?? 0),
      defaultRatePct: Number(issuer.default_rate_pct ?? 0),
      onTimeSettlementPct: Number(issuer.on_time_settlement_pct ?? 100),
      vaults,
      transparency: Array.isArray(issuer.transparency) ? issuer.transparency : [],
    }
  } catch {
    return null
  }
}

export async function dbListIssuers(verifiedOnly = false): Promise<IssuerProfile[] | null> {
  try {
    const sb = getServiceClient()
    let q = sb.from('vault_issuers').select('*').order('total_raised_usd', { ascending: false })
    if (verifiedOnly) q = q.eq('status', 'VERIFIED')
    const { data, error } = await q
    if (error || !data) return null
    return data.map((issuer: Record<string, unknown>) => ({
      id: String(issuer.id),
      name: String(issuer.name),
      address: String(issuer.address),
      status: issuer.status as IssuerProfile['status'],
      since: (issuer.since as string) ?? '',
      attributionScore: Number(issuer.attribution_score ?? 0),
      dealsCompleted: Number(issuer.deals_completed ?? 0),
      totalRaisedUsd: Number(issuer.total_raised_usd ?? 0),
      defaultRatePct: Number(issuer.default_rate_pct ?? 0),
      onTimeSettlementPct: Number(issuer.on_time_settlement_pct ?? 100),
      vaults: [],
      transparency: Array.isArray(issuer.transparency) ? (issuer.transparency as IssuerProfile['transparency']) : [],
    }))
  } catch {
    return null
  }
}

// ─── Deal (per RWA vault) ─────────────────────────────────────────────────────
export async function dbGetDeal(vaultId: string): Promise<DealMeta | null> {
  try {
    const sb = getServiceClient()
    const { data: deal, error } = await sb.from('vault_deals').select('*').eq('vault_id', vaultId).maybeSingle()
    if (error || !deal) return null

    const { data: docs } = await sb
      .from('vault_deal_documents')
      .select('*')
      .eq('deal_id', deal.id)
      .order('sort_order', { ascending: true })

    const documents: DealDocument[] = (docs ?? []).map((d: Record<string, unknown>) => ({
      id: String(d.id),
      label: String(d.label),
      url: String(d.url),
      kind: d.kind as DocKind,
      reviewStatus: d.review_status as DocReviewStatus,
    }))

    return {
      vaultId,
      issuerId: (deal.issuer_id as string) ?? null,
      description: (deal.description as string) ?? null,
      yieldSourceExplainer: (deal.yield_source_explainer as string) ?? null,
      priceExplainer: (deal.price_explainer as string) ?? null,
      underlyingAssetClass: (deal.underlying_asset_class as string) ?? null,
      targetApyPct: deal.target_apy_pct != null ? Number(deal.target_apy_pct) : null,
      minInvestmentUsd: Number(deal.min_investment_usd ?? 0),
      reservePct: Number(deal.reserve_pct ?? 40),
      yieldPct: Number(deal.yield_pct ?? 60),
      priceBand: (deal.price_band as string) ?? '±15/±45',
      settleDays: Number(deal.settle_days ?? 30),
      kycTierRequired: (deal.kyc_tier_required as KycTier) ?? 'BASIC',
      reviewStatus: (deal.review_status as DealReviewStatus) ?? 'draft',
      documents,
    }
  } catch {
    return null
  }
}

// ─── RWA vaults for discovery (approved deals → VaultSummary) ──────────────────
/// Real, approved RWA deals mapped to the discovery model. `id` is the vault UUID,
/// so discovery rows link straight to the /vault/[id] deal page. Returns null on
/// error / missing tables so callers fall back to mock RWA.
export async function dbGetRwaVaults(): Promise<VaultSummary[] | null> {
  try {
    const sb = getServiceClient()
    const { data, error } = await sb
      .from('vault_deals')
      .select('target_apy_pct, price_band, settle_days, underlying_asset_class, social_vaults(id, name, status, tvl_usdc)')
      .eq('review_status', 'approved')
    if (error || !data) return null

    return data.flatMap((d: Record<string, unknown>) => {
      const v = d.social_vaults as { id?: string; name?: string; status?: string; tvl_usdc?: number } | null
      if (!v?.id) return []
      const status: VaultStatus = v.status === 'seeding' ? 'seeding' : v.status === 'active' ? 'active' : 'paused'
      const asset = (d.underlying_asset_class as string) ?? 'RWA'
      const apy = d.target_apy_pct != null ? Number(d.target_apy_pct) : 0
      return [{
        id: v.id,
        name: v.name ?? 'RWA Deal',
        surface: 'RWA' as const,
        pair: 'vRWA / USDC',
        descriptor: `${asset} · oracle-banded · SPV-wrapped`,
        tvlUsd: Number(v.tvl_usdc ?? 0),
        netApyPct: apy,
        status,
        epochLabel: 'T−7d',
        feeSplit: [70, 15, 10, 5] as [number, number, number, number],
        underlyingApyPct: apy,
        settleDays: Number(d.settle_days ?? 30),
        priceBand: (d.price_band as string) ?? '±15/±45',
        kycAtRedeem: true,
      }]
    })
  } catch {
    return null
  }
}

// ─── Redemptions ──────────────────────────────────────────────────────────────
export async function dbGetRedemptions(holder?: string): Promise<RedemptionRequest[] | null> {
  try {
    const sb = getServiceClient()
    let q = sb.from('vault_redemptions').select('*, social_vaults(name)').order('requested_at', { ascending: false })
    if (holder) q = q.eq('holder', holder.toLowerCase())
    const { data, error } = await q
    if (error || !data) return null
    const today = new Date().toISOString().slice(0, 10)
    return data.map((r: Record<string, unknown>) => {
      const v = r.social_vaults as { name?: string } | null
      return {
        id: String(r.id),
        vault: v?.name ?? 'Vault',
        holder: String(r.holder),
        sharesUsd: Number(r.shares_usd ?? 0),
        requestedAt: String(r.requested_at),
        settlesAt: String(r.settles_at),
        status: r.status as RedemptionRequest['status'],
        kycVerified: Boolean(r.kyc_verified),
        daysRemaining: r.status === 'settled' ? 0 : daysBetween(today, String(r.settles_at)),
      }
    })
  } catch {
    return null
  }
}
