'use client'

// =============================================================================
// app/dashboard/page.tsx — Campaign list page
//
// Layout: header + filter tabs (All | Live | Upcoming | Ended) + card grid
// Data:   GET /campaigns
// Auth:   MwAuthGuard (wallet required)
// Inline styles only — no Tailwind.
// =============================================================================

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API } from '@/lib/api'
import { CampaignCard } from '@/components/campaigns/CampaignCard'
import type { Campaign } from '@/components/campaigns/CampaignCard'

type FilterTab = 'all' | 'live' | 'upcoming' | 'ended'

// ── Loading skeleton ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E0DFFF', borderRadius: 16,
      padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#F0EFFF' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 16, background: '#F0EFFF', borderRadius: 6, marginBottom: 8, width: '55%' }} />
          <div style={{ height: 12, background: '#F0EFFF', borderRadius: 4, width: '40%' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ height: 34, background: '#F0EFFF', borderRadius: 6, flex: 1 }} />
        <div style={{ height: 34, background: '#F0EFFF', borderRadius: 6, flex: 1 }} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ height: 22, width: 70, background: '#F0EFFF', borderRadius: 20 }} />
        <div style={{ height: 22, width: 80, background: '#F0EFFF', borderRadius: 20 }} />
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ filter }: { filter: FilterTab }) {
  const msgs: Record<FilterTab, { icon: string; title: string; sub: string }> = {
    all:      { icon: '◎', title: 'No campaigns yet',         sub: 'Campaigns will appear here once teams launch them.' },
    live:     { icon: '●', title: 'No live campaigns',        sub: 'Check back soon — new campaigns launch regularly.' },
    upcoming: { icon: '◷', title: 'Nothing scheduled',       sub: 'Upcoming campaigns will appear here before launch.' },
    ended:    { icon: '✓', title: 'No ended campaigns',       sub: 'Past campaigns will show their results here.' },
  }
  const m = msgs[filter]
  return (
    <div style={{
      textAlign: 'center', padding: '64px 24px',
      background: '#fff', border: '1px solid #E0DFFF',
      borderRadius: 16, gridColumn: '1 / -1',
    }}>
      <div style={{ fontSize: 36, marginBottom: 12, color: '#C4C3F0' }}>{m.icon}</div>
      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 16, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
        {m.title}
      </div>
      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', maxWidth: 300, margin: '0 auto' }}>
        {m.sub}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
function DashboardContent() {
  const { address } = useAccount()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [filter,    setFilter]    = useState<FilterTab>('all')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/campaigns`)
      .then(r => r.json())
      .then(data => {
        const list: Campaign[] = Array.isArray(data) ? data : (data.campaigns ?? [])
        setCampaigns(list)
      })
      .catch(err => setError(err.message ?? 'Failed to load campaigns'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all'
    ? campaigns
    : campaigns.filter(c => c.status === filter)

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'live',     label: 'Live' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'ended',    label: 'Ended' },
  ]

  return (
    <>
      <style>{`
        @keyframes dash-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .dash-tab-btn {
          background: none; border: none; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 600;
          padding: 8px 16px; border-radius: 8px;
          transition: background 0.15s, color 0.15s;
          color: #8A8C9E;
        }
        .dash-tab-btn:hover { background: #EEF1FF; color: #3A5CE8; }
        .dash-tab-btn.active {
          color: #3A5CE8;
          border-bottom: 2px solid #3A5CE8;
          border-radius: 0;
          padding-bottom: 6px;
        }
        .dash-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        @media (max-width: 640px) {
          .dash-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{
        minHeight: '100vh', background: '#F7F6FF',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
      }}>
        <MwNav />

        <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 16px' }}>

          {/* ── Page header ── */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 28, fontWeight: 800, color: '#1A1A2E', margin: 0, marginBottom: 6,
            }}>
              Campaigns
            </h1>
            <p style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, color: '#8A8C9E', margin: 0 }}>
              Browse active campaigns, join to earn points and token rewards.
            </p>
          </div>

          {/* ── Filter tabs ── */}
          <div style={{
            display: 'flex', gap: 4, marginBottom: 24,
            borderBottom: '1px solid #E0DFFF', paddingBottom: 0,
          }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`dash-tab-btn${filter === tab.key ? ' active' : ''}`}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
                {tab.key !== 'all' && !loading && (
                  <span style={{
                    marginLeft: 5,
                    fontFamily: 'DM Mono, monospace',
                    fontSize: 11, fontWeight: 700,
                    color: filter === tab.key ? '#3A5CE8' : '#C4C3F0',
                  }}>
                    {campaigns.filter(c => c.status === tab.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{
              padding: '16px 20px', background: 'rgba(194,83,122,0.06)',
              border: '1px solid rgba(194,83,122,0.15)', borderRadius: 12,
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C2537A',
              marginBottom: 20,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Campaign grid ── */}
          <div className="dash-grid">
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : filtered.length === 0 ? (
              <EmptyState filter={filter} />
            ) : (
              filtered.map(c => (
                <CampaignCard key={c.id} campaign={c} />
              ))
            )}
          </div>

        </main>
      </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <MwAuthGuard>
      <DashboardContent />
    </MwAuthGuard>
  )
}
