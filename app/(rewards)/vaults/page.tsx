'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtUSD } from '@/lib/web2/api'
import { fetchVaults } from '@/lib/web2/vault/queries'
import { VaultCard } from '@/components/web2/vault/VaultCard'
import type { SocialVault, VaultStatus } from '@/lib/web2/vault/types'

type Filter = 'All' | 'Active' | 'Seeding' | 'Closed'

const FILTERS: Filter[] = ['All', 'Active', 'Seeding', 'Closed']

// ─── mock data for development / before DB is seeded ───────────────────────
const MOCK_VAULTS: SocialVault[] = [
  {
    id:               'mock-vault-1',
    name:             'PROJ/USDC Vault',
    team_wallet:      '0xcf2EA99639C038a475B710b2Be82b974D777C306',
    project_token:    '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    seed_amount:      100000,
    pool_key:         { token0: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', token1: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', fee: 3000, tickSpacing: 60, hooks: '0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4' },
    contract_address: '0xb9FB965Caa7197932b52631e0121Ea54586e2B88',
    status:           'active',
    chain_id:         84532,
    tick_lower:       -60000,
    tick_upper:       60000,
    tvl_usdc:         247500,
    created_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
    current_epoch:    { id: 'ep1', vault_id: 'mock-vault-1', epoch_number: 1, total_pool: 3840, bonus_pool: 0, total_claimed: 0, deadline: null, merkle_root: null, ipfs_cid: null, tx_hash: null, status: 'active', opened_at: new Date().toISOString(), closed_at: null },
  },
]

// ─── VaultsContent ──────────────────────────────────────────────────────────
const VAULTS_LOCKED = process.env.NEXT_PUBLIC_PHASE2_ENABLED !== 'true'

function VaultsContent() {
  const { address } = useAccount()

  const [vaults, setVaults]   = useState<SocialVault[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('All')
  const [useMock, setUseMock] = useState(false)

  useEffect(() => {
    fetchVaults()
      .then(data => {
        if (data.length === 0) {
          // No vaults in DB yet — show mock data in dev
          setVaults(MOCK_VAULTS)
          setUseMock(true)
        } else {
          setVaults(data)
        }
      })
      .catch(() => {
        setVaults(MOCK_VAULTS)
        setUseMock(true)
      })
      .finally(() => setLoading(false))
  }, [])

  // Derived stats
  const activeVaults = vaults.filter(v => v.status === 'active')
  const totalTvl     = vaults.reduce((s, v) => s + (v.tvl_usdc ?? 0), 0)
  const totalEpoch   = vaults.reduce((s, v) => s + (v.current_epoch?.total_pool ?? 0), 0)

  function statusFromFilter(f: Filter): VaultStatus | undefined {
    if (f === 'Active')  return 'active'
    if (f === 'Seeding') return 'seeding'
    if (f === 'Closed')  return 'closed'
    return undefined
  }

  const filtered = filter === 'All'
    ? vaults
    : vaults.filter(v => v.status === statusFromFilter(filter))

  return (
    <>
      <style>{`
        .vaults-page {
          background: var(--color-mw-surface, #f5f5f7);
          min-height: 100vh;
        }
        .vaults-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 28px 60px;
        }
        @media (max-width: 800px) {
          .vaults-inner { padding: 20px 16px 48px; }
        }

        /* ── Hero ── */
        .vaults-hero {
          background: var(--color-mw-dark);
          border-radius: var(--radius-lg);
          padding: 36px 40px;
          margin-bottom: 28px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          overflow: hidden;
          position: relative;
        }
        .vaults-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 80% 50%, rgba(79,126,247,0.12) 0%, transparent 65%);
          pointer-events: none;
        }
        .vaults-hero-left { position: relative; }
        .vaults-hero-eyebrow {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
        }
        .vaults-hero-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--color-mw-live);
        }
        .vaults-hero-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-mw-live);
          font-family: var(--font-jakarta);
        }
        .vaults-hero-title {
          font-size: 32px;
          font-weight: 800;
          color: var(--color-mw-dark-text);
          font-family: var(--font-jakarta);
          line-height: 1.15;
          margin-bottom: 8px;
        }
        .vaults-hero-sub {
          font-size: 14px;
          color: var(--color-mw-dark-sub);
          font-family: var(--font-jakarta);
          max-width: 420px;
          line-height: 1.5;
        }
        .vaults-hero-stats {
          display: flex;
          gap: 32px;
          position: relative;
          flex-shrink: 0;
        }
        @media (max-width: 720px) {
          .vaults-hero { flex-direction: column; padding: 24px 20px; }
          .vaults-hero-stats { gap: 20px; }
          .vaults-hero-title { font-size: 24px; }
        }
        .vaults-hero-stat { display: flex; flex-direction: column; gap: 2px; }
        .vaults-hero-stat-val {
          font-size: 26px;
          font-weight: 700;
          font-family: var(--font-mono);
          color: var(--color-mw-dark-text);
        }
        .vaults-hero-stat-lbl {
          font-size: 11px;
          color: var(--color-mw-dark-sub);
          font-family: var(--font-jakarta);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 500;
        }

        /* ── Toolbar ── */
        .vaults-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .vaults-filters {
          display: flex;
          gap: 4px;
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-sm);
          padding: 3px;
        }
        .vaults-filter-btn {
          padding: 5px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-jakarta);
          border: none;
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
          color: var(--color-mw-ink-3);
          background: transparent;
        }
        .vaults-filter-btn.active {
          background: var(--color-mw-brand);
          color: white;
        }
        .vaults-filter-btn:not(.active):hover {
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
        }
        .vaults-create-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: var(--color-mw-brand);
          color: white;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-weight: 600;
          font-family: var(--font-jakarta);
          text-decoration: none;
          transition: background var(--transition-fast);
        }
        .vaults-create-btn:hover {
          background: var(--color-mw-brand-deep);
        }

        /* ── Grid ── */
        .vaults-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }
        @media (max-width: 680px) {
          .vaults-grid { grid-template-columns: 1fr; }
        }

        /* ── Empty / Loading ── */
        .vaults-empty {
          text-align: center;
          padding: 60px 20px;
          color: var(--color-mw-ink-3);
          font-family: var(--font-jakarta);
          font-size: 14px;
        }
        .vaults-empty-icon {
          font-size: 32px;
          margin-bottom: 12px;
        }
        .vaults-skeleton {
          height: 200px;
          background: linear-gradient(90deg, var(--color-mw-border) 25%, rgba(0,0,0,0.04) 50%, var(--color-mw-border) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
          border-radius: var(--radius-md);
        }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* ── Mock banner ── */
        .vaults-mock-banner {
          background: rgba(193,119,0,0.08);
          border: 1px solid rgba(193,119,0,0.2);
          border-radius: var(--radius-sm);
          padding: 10px 14px;
          font-size: 12px;
          color: var(--color-mw-amber);
          font-family: var(--font-jakarta);
          font-weight: 500;
          margin-bottom: 16px;
        }
      `}</style>

      <div className="vaults-page">
        <MwNav />
        <div className="vaults-inner">

          {/* ── Hero ── */}
          <div className="vaults-hero">
            <div className="vaults-hero-left">
              <div className="vaults-hero-eyebrow">
                <div className="vaults-hero-dot" />
                <span className="vaults-hero-label">Social LP Vaults</span>
              </div>
              <div className="vaults-hero-title">
                Earn while you<br />provide liquidity
              </div>
              <div className="vaults-hero-sub">
                Attribution-weighted rewards. The better your on-chain reputation, the more you earn from the same deposit.
              </div>
            </div>
            <div className="vaults-hero-stats">
              <div className="vaults-hero-stat">
                <span className="vaults-hero-stat-val">
                  {totalTvl > 0 ? fmtUSD(totalTvl) : '—'}
                </span>
                <span className="vaults-hero-stat-lbl">Total TVL</span>
              </div>
              <div className="vaults-hero-stat">
                <span className="vaults-hero-stat-val">
                  {totalEpoch > 0 ? fmtUSD(totalEpoch) : '—'}
                </span>
                <span className="vaults-hero-stat-lbl">This epoch</span>
              </div>
              <div className="vaults-hero-stat">
                <span className="vaults-hero-stat-val">{activeVaults.length}</span>
                <span className="vaults-hero-stat-lbl">Active vaults</span>
              </div>
            </div>
          </div>

          {/* ── Toolbar ── */}
          <div className="vaults-toolbar">
            <div className="vaults-filters">
              {FILTERS.map(f => (
                <button
                  key={f}
                  className={`vaults-filter-btn${filter === f ? ' active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <Link href="/vault/create" className="vaults-create-btn">
              + Create vault
            </Link>
          </div>

          {/* ── Mock banner ── */}
          {useMock && (
            <div className="vaults-mock-banner">
              ⚠ Showing example vault — no vaults have been seeded yet. Deploy a pool via the create flow to get started.
            </div>
          )}

          {/* ── Grid ── */}
          {loading ? (
            <div className="vaults-grid">
              {[1, 2, 3].map(i => <div key={i} className="vaults-skeleton" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="vaults-empty">
              <div className="vaults-empty-icon">⬡</div>
              <div>No {filter !== 'All' ? filter.toLowerCase() + ' ' : ''}vaults yet.</div>
            </div>
          ) : (
            <div className="vaults-grid">
              {filtered.map(v => <VaultCard key={v.id} vault={v} />)}
            </div>
          )}

        </div>
      </div>
    </>
  )
}

// ─── Coming-soon overlay (shown when NEXT_PUBLIC_PHASE2_ENABLED !== 'true') ──
function VaultsComingSoon() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: 'rgba(245,245,247,0.72)', pointerEvents: 'all' }}>
      <style>{`
        @keyframes vaults-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.7; transform: scale(0.97); }
        }
      `}</style>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: '0 24px', animation: 'vaults-pulse 3s ease-in-out infinite' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⬡</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', marginBottom: 8 }}>
          Vaults — Coming Soon
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-mw-ink-3)', lineHeight: 1.6, fontFamily: 'var(--font-jakarta)', marginBottom: 24 }}>
          Social LP vaults with Attribution-weighted rewards. Earn more based on your on-chain reputation.
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-mw-brand-dim)', color: 'var(--color-mw-brand)', borderRadius: 'var(--radius-xl)', padding: '6px 16px', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'var(--font-jakarta)' }}>
          Phase 2
        </span>
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function VaultsPage() {
  return (
    <MwAuthGuard>
      {VAULTS_LOCKED && <VaultsComingSoon />}
      <VaultsContent />
    </MwAuthGuard>
  )
}
