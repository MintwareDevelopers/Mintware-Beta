'use client'

// /app/vaults — the functional vault browse (app tier). Design v2. Public to view;
// deposit/create actions live on their own guarded pages. Educational Vaults page
// lives at /vaults (marketing tier).

import { MwNav } from '@/components/web2/MwNav'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtUSD } from '@/lib/web2/api'
import type { SocialVault, VaultStatus } from '@/lib/web2/vault/types'

type Filter = 'All' | 'Active' | 'Seeding' | 'Closed'
const FILTERS: Filter[] = ['All', 'Active', 'Seeding', 'Closed']
const BASE_APY = 8.5

const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum', 8453: 'Base', 84532: 'Base Sepolia', 42161: 'Arbitrum', 10: 'Optimism', 137: 'Polygon', 56: 'BNB' }
const chainName = (id?: number) => (id != null ? CHAIN_NAMES[id] ?? `Chain ${id}` : '—')
const STATUS_META: Record<string, { label: string; cls: string; live: boolean }> = {
  active:  { label: 'Active',  cls: 'text-peri-deep border-[rgba(108,108,240,0.4)]', live: true },
  seeding: { label: 'Seeding', cls: 'text-[#D14343] border-[rgba(209,67,67,0.35)]', live: false },
  closed:  { label: 'Closed',  cls: 'text-ink-soft border-hair', live: false },
}

const MOCK_VAULTS: SocialVault[] = [
  {
    id:               'mock-vault-1',
    name:             'WETH/USDC Pair Vault',
    team_wallet:      '0xcf2EA99639C038a475B710b2Be82b974D777C306',
    project_token:    '0x4200000000000000000000000000000000000006',
    seed_amount:      100000,
    pool_key:         { token0: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', token1: '0x4200000000000000000000000000000000000006', fee: 3000, tickSpacing: 60, hooks: '0xe752305538189D2A56A067106373CD6d36dC8aC8' },
    contract_address: '0x983c11b4afb39766ada3a69c66addbc73b456f6e',
    status:           'active',
    chain_id:         84532,
    tick_lower:       -60000,
    tick_upper:       60000,
    tvl_usdc:         247500,
    is_sample:        true,
    created_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
    current_epoch:    { id: 'ep1', vault_id: 'mock-vault-1', epoch_number: 1, total_pool: 3840, bonus_pool: 0, total_claimed: 0, deadline: null, merkle_root: null, ipfs_cid: null, tx_hash: null, status: 'active', opened_at: new Date().toISOString(), closed_at: null },
  },
]

export default function AppVaultsPage() {
  const [vaults, setVaults]   = useState<SocialVault[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('All')
  const [useMock, setUseMock] = useState(false)

  useEffect(() => {
    fetch('/api/vaults?surface=all')
      .then(r => r.json())
      .then((data: SocialVault[]) => {
        if (!Array.isArray(data) || data.length === 0) { setVaults(MOCK_VAULTS); setUseMock(true) }
        else setVaults(data)
      })
      .catch(() => { setVaults(MOCK_VAULTS); setUseMock(true) })
      .finally(() => setLoading(false))
  }, [])

  function statusFromFilter(f: Filter): VaultStatus | undefined {
    if (f === 'Active') return 'active'
    if (f === 'Seeding') return 'seeding'
    if (f === 'Closed') return 'closed'
    return undefined
  }
  const filtered = vaults
    .filter(v => (v.surface ?? 'defi') === 'defi')
    .filter(v => filter === 'All' || v.status === statusFromFilter(filter))

  return (
    <div className="font-atx-display bg-white min-h-screen text-ink overflow-x-clip">
      <MwNav />

      {/* ── Testnet-beta notice ── */}
      <div className="border-b border-hair-soft bg-[rgba(108,108,240,0.06)]">
        <div className="max-w-[1100px] mx-auto px-6 py-2.5 max-[800px]:px-4 flex items-center gap-3 flex-wrap text-[11px]">
          <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block shrink-0" />
          <span className="uppercase tracking-[0.14em] font-semibold text-peri-deep">Base Sepolia · testnet beta</span>
          <span className="text-ink-mid">
            Vaults run on a testnet contract — deposit test USDC to try the full flow. Figures shown are illustrative, not live TVL.
          </span>
          <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="ml-auto underline underline-offset-2 text-peri-deep hover:text-ink font-medium">
            Get test USDC →
          </a>
        </div>
      </div>

      {/* ── header ── */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <div className="max-w-[1100px] mx-auto px-6 py-8 max-[800px]:px-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-peri-deep">DeFi surface · reputation-weighted yield</div>
            <h1 className="font-atx-display font-medium tracking-[-0.03em] text-[clamp(26px,3.4vw,38px)] mt-2 text-ink">Vaults</h1>
          </div>
          <Link href="/vaults" className="text-[12px] font-semibold text-peri-deep no-underline hover:underline">How vaults work →</Link>
        </div>
      </div>

      {/* ── vault list ── */}
      <div className="max-w-[1100px] mx-auto px-6 pt-8 pb-[52px] max-[800px]:px-4">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex gap-1 rounded-full bg-ground-cool border border-hair p-1">
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[12px] uppercase tracking-[0.08em] font-semibold rounded-full px-3.5 py-1.5 transition-colors ${filter === f ? 'bg-peri text-white' : 'bg-transparent text-ink-mid hover:text-ink'}`}>
                {f}
              </button>
            ))}
          </div>
          <Link href="/app/vault/create" className="glass-pill glass-pill-sm">+ Create vault</Link>
        </div>

        {useMock && (
          <div className="rounded-2xl bg-white border border-hair px-3.5 py-2.5 text-[12px] text-[#D14343] mb-4 flex items-center gap-2" style={{ borderLeft: '3px solid #D14343' }}>
            Showing example vault — no vaults have been seeded yet. Deploy a pool via the create flow to get started.
          </div>
        )}

        {loading ? (
          <div className="soft-card p-4 flex flex-col gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-11 rounded-xl bg-ground-cool mw-shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-[60px] px-5 text-ink-mid text-[14px]">
            <div>No DeFi {filter !== 'All' ? filter.toLowerCase() + ' ' : ''}vaults yet.</div>
          </div>
        ) : (
          <div className="soft-card overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[840px]">
              <thead>
                <tr className="border-b border-hair-soft bg-ground-cool">
                  {([['Vault', 'l'], ['Status', 'l'], ['TVL', 'r'], ['Reward pool', 'r'], ['Epoch', 'r'], ['Example APY', 'r'], ['Chain', 'l'], ['', 'r']] as const).map(([h, al], i) => (
                    <th key={i} className={`text-[9.5px] uppercase tracking-[0.09em] font-semibold text-ink-soft px-4 py-3 whitespace-nowrap ${al === 'r' ? 'text-right' : 'text-left'} ${(i === 4 || i === 5) ? 'max-[820px]:hidden' : ''} ${i === 6 ? 'max-[680px]:hidden' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const st = STATUS_META[v.status ?? ''] ?? STATUS_META.closed
                  const ep = v.current_epoch
                  const tok = v.project_token ? `${v.project_token.slice(0, 6)}…${v.project_token.slice(-4)}` : ''
                  return (
                    <tr key={v.id} className="border-b border-hair-soft last:border-b-0 hover:bg-ground-cool transition-colors">
                      <td className="px-4 py-3.5 align-middle">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-8 h-8 rounded-lg border border-hair bg-ground-cool grid place-items-center font-atx-display text-[12px] font-medium shrink-0 text-ink">{v.name.charAt(0)}</span>
                          <div className="min-w-0">
                            <div className="font-atx-display font-medium text-[14px] tracking-tight truncate flex items-center gap-1.5 text-ink">
                              {v.name}
                              {v.is_sample && <span className="text-[9px] uppercase tracking-[0.06em] font-semibold text-[#D14343] rounded-full border border-[rgba(209,67,67,0.35)] px-1.5 py-0.5">example</span>}
                            </div>
                            <div className="font-mono text-[11px] text-ink-soft truncate">{tok}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full border px-2 py-1 ${st.cls}`}>
                          {st.live && <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block animate-pulse" />}{st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-ink">{v.tvl_usdc != null ? fmtUSD(v.tvl_usdc) : '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-coral2-deep">{ep?.total_pool != null ? fmtUSD(ep.total_pool) : '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-ink-mid max-[820px]:hidden">{ep ? `#${ep.epoch_number}` : '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-peri-deep max-[820px]:hidden">{BASE_APY.toFixed(1)}%</td>
                      <td className="px-4 py-3.5 text-[12px] text-ink-mid max-[680px]:hidden">{chainName(v.chain_id)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={`/app/vault/${v.id}`} className="glass-pill glass-pill-sm whitespace-nowrap">Open →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
