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

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px]'

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
// Vaults are ungated by default (Phase-3). Set NEXT_PUBLIC_VAULTS_LOCKED='true'
// to re-show the coming-soon overlay (kill-switch).
const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'

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
    <div className="font-atx-display bg-atx-bone min-h-screen text-atx-ink">
      <MwNav />
      <div className="max-w-[1100px] mx-auto px-7 pt-7 pb-[60px] max-[800px]:px-4 max-[800px]:pt-5 [&_*]:rounded-none">

        {/* ── Hero ── */}
        <div className="bg-atx-ink text-white border border-atx-ink px-10 py-9 mb-7 flex items-start justify-between gap-6 max-[720px]:flex-col max-[720px]:px-5 max-[720px]:py-6">
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />
              <span className={`${LABEL} tracking-[0.12em] text-atx-acid`}>Social LP Vaults</span>
            </div>
            <div className="text-[32px] font-extrabold leading-[1.15] mb-2 font-atx-display max-[720px]:text-[24px]">
              Earn while you<br />provide liquidity
            </div>
            <div className="text-[14px] text-white/60 max-w-[420px] leading-[1.5] font-atx-display">
              Attribution-weighted rewards. The better your on-chain reputation, the more you earn from the same deposit.
            </div>
          </div>
          <div className="flex gap-8 shrink-0 max-[720px]:gap-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[26px] font-bold font-atx-mono text-white">
                {totalTvl > 0 ? fmtUSD(totalTvl) : '—'}
              </span>
              <span className={`${LABEL} text-white/55`}>Total TVL</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[26px] font-bold font-atx-mono text-white">
                {totalEpoch > 0 ? fmtUSD(totalEpoch) : '—'}
              </span>
              <span className={`${LABEL} text-white/55`}>This epoch</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[26px] font-bold font-atx-mono text-white">{activeVaults.length}</span>
              <span className={`${LABEL} text-white/55`}>Active vaults</span>
            </div>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex border border-atx-ink">
            {FILTERS.map(f => (
              <button
                key={f}
                className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${filter === f ? 'bg-atx-ink text-atx-bone' : 'bg-transparent text-atx-ink'}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <Link
            href="/vault/create"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-atx-blue text-white border border-atx-ink font-atx-mono text-[13px] font-semibold uppercase tracking-[0.04em] no-underline"
          >
            + Create vault
          </Link>
        </div>

        {/* ── Mock banner ── */}
        {useMock && (
          <div className="bg-atx-panel border border-atx-ink/25 border-l-[3px] border-l-atx-clay px-3.5 py-2.5 text-[12px] text-atx-clay font-atx-mono mb-4 flex items-center gap-2">
            <Star className="w-3.5 h-3.5 shrink-0 text-atx-clay" />
            Showing example vault — no vaults have been seeded yet. Deploy a pool via the create flow to get started.
          </div>
        )}

        {/* ── Grid ── */}
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 max-[680px]:grid-cols-1">
            {[1, 2, 3].map(i => <div key={i} className="h-[200px] bg-atx-panel border border-atx-ink/20 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-[60px] px-5 text-atx-ink/55 font-atx-display text-[14px]">
            <div className="flex justify-center mb-3"><Star className="w-8 h-8 text-atx-coral" /></div>
            <div>No {filter !== 'All' ? filter.toLowerCase() + ' ' : ''}vaults yet.</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 max-[680px]:grid-cols-1">
            {filtered.map(v => <VaultCard key={v.id} vault={v} />)}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Coming-soon overlay (shown only when NEXT_PUBLIC_VAULTS_LOCKED === 'true') ──
function VaultsComingSoon() {
  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center backdrop-blur-[14px] bg-atx-bone/70 font-atx-display [&_*]:rounded-none">
      <div className="text-center max-w-[380px] px-6">
        <div className="flex justify-center mb-4"><Star className="w-10 h-10 text-atx-coral" /></div>
        <div className="text-[24px] font-bold tracking-[-0.5px] text-atx-ink font-atx-display mb-2">
          Vaults — Coming Soon
        </div>
        <div className="text-[14px] text-atx-ink/55 leading-[1.6] font-atx-display mb-6">
          Social LP vaults with Attribution-weighted rewards. Earn more based on your on-chain reputation.
        </div>
        <span className="inline-flex items-center gap-1.5 bg-atx-bone border border-atx-ink/25 text-atx-blue px-4 py-1.5 text-[12px] font-semibold tracking-[0.5px] uppercase font-atx-mono">
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
