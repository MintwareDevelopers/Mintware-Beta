'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { PageHero } from '@/components/web2/PageHero'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'
import { ULVMechanics } from '@/components/vaults/ULVMechanics'
import { fmtUSD } from '@/lib/web2/api'
import type { SocialVault, VaultStatus } from '@/lib/web2/vault/types'

type Filter = 'All' | 'Active' | 'Seeding' | 'Closed'
const FILTERS: Filter[] = ['All', 'Active', 'Seeding', 'Closed']

const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum', 8453: 'Base', 84532: 'Base Sepolia', 42161: 'Arbitrum', 10: 'Optimism', 137: 'Polygon', 56: 'BNB' }
const chainName = (id?: number) => (id != null ? CHAIN_NAMES[id] ?? `Chain ${id}` : '—')
const STATUS_META: Record<string, { label: string; cls: string; live: boolean }> = {
  active:  { label: 'Active',  cls: 'text-atx-mesquite border-atx-mesquite', live: true },
  seeding: { label: 'Seeding', cls: 'text-atx-clay border-atx-clay', live: false },
  closed:  { label: 'Closed',  cls: 'text-atx-ink/45 border-atx-ink/25', live: false },
}

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px]'

// ── mock data for development / before DB is seeded ───────────────────────
const MOCK_VAULTS: SocialVault[] = [
  {
    id:               'mock-vault-1',
    name:             'WETH/USDC Pair Vault',
    team_wallet:      '0xcf2EA99639C038a475B710b2Be82b974D777C306',
    project_token:    '0x4200000000000000000000000000000000000006',
    seed_amount:      100000,
    // token0 = USDC (6dp), token1 = WETH (18dp) — the live MintwareDeFiPairVault pool on Base Sepolia.
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

const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'

// ── DeFi vault pitch ─────────────────────────────────────────────────────────
type Surface = 'defi'
const SURFACES: Record<Surface, {
  eyName: string; acc: string; accInk: string; head: [string, string]; sub: string;
  bullets: string[]; base: number; featured: [string, string, string][]
}> = {
  defi: {
    eyName: 'DeFi surface', acc: '#006FCC', accInk: '#ffffff',
    head: ['Same deposit. Your reputation. ', 'More yield.'],
    sub: 'MEV-protected, auto-managed LP on Uniswap V4. Your Attribution score and lock tier lift your fee share — so the exact same position earns you more than the wallet next to you.',
    bullets: ['MEV protection — V4 hooks route bot value back to LPs', 'Auto-managed range — no rebalancing', 'Idle capital routed to yield', 'Reputation fee share, up to 1.95×'],
    base: 8.5,
    featured: [['Social Blue-Chip', 'ETH / USDC', '11.0%'], ['Degen Emerging', 'ARB / USDC', '18.4%']],
  },
}

// ── VaultsContent ────────────────────────────────────────────────────────────
function VaultsContent() {
  useAccount()
  const [vaults, setVaults]   = useState<SocialVault[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('All')
  const [useMock, setUseMock] = useState(false)
  const surface: Surface = 'defi'

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
  // Show only the selected surface's vaults; then apply the status filter within it.
  const filtered = vaults
    .filter(v => (v.surface ?? 'defi') === surface)
    .filter(v => filter === 'All' || v.status === statusFromFilter(filter))

  const S = SURFACES[surface]
  const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

  return (
    <div className="font-atx-display bg-atx-bone min-h-screen text-atx-ink [&_*]:rounded-none">
      <MwNav />

      {/* ── Testnet-beta notice — keeps the preview data honest ── */}
      <div className="border-b border-atx-ink bg-atx-ink text-white">
        <div className="max-w-[1100px] mx-auto px-7 py-2.5 max-[800px]:px-4 flex items-center gap-3 flex-wrap font-atx-mono text-[11px]">
          <span className="w-[8px] h-[8px] bg-atx-acid border border-white/40 inline-block shrink-0" />
          <span className="uppercase tracking-[0.14em] text-white/70">Base Sepolia · testnet beta</span>
          <span className="text-white/55 normal-case tracking-normal">
            Vaults run on a testnet contract — deposit test USDC to try the full flow. Figures shown are illustrative, not live TVL.
          </span>
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto underline underline-offset-2 text-atx-acid hover:text-white normal-case tracking-normal"
          >
            Get test USDC →
          </a>
        </div>
      </div>

      {/* ── HERO — surface pitch ── */}
      <PageHero
        size="compact"
        eyebrow={`${S.eyName} · reputation-weighted yield`}
        title={<>{S.head[0]}<span className="text-atx-blue">{S.head[1]}</span></>}
        sub={S.sub}
      >
        <div className="grid grid-cols-2 gap-y-2.5 gap-x-8 max-w-[760px] max-[560px]:grid-cols-1">
          {S.bullets.map(b => (
            <div key={b} className="flex gap-2.5 items-start text-[14px] leading-[1.4]">
              <span className="w-[9px] h-[9px] mt-1 border border-atx-ink inline-block shrink-0 bg-atx-blue" />
              {b}
            </div>
          ))}
        </div>

        {/* featured vaults — illustrative examples, not live offers */}
        <div className={`${ey} mt-8 mb-2.5`}>Example vaults · illustrative</div>
        <div className="grid grid-cols-2 gap-3 max-w-[760px] max-[560px]:grid-cols-1">
          {S.featured.map(([name, pair, apy]) => (
            <div key={name} className="border border-atx-ink bg-atx-panel p-[18px] border-t-4 border-t-atx-blue mw-lift">
              <div className="text-[17px] font-bold">{name}</div>
              <div className="font-atx-mono text-[11px] text-atx-ink/55 mt-1">{pair}</div>
              <div className="flex items-center justify-between mt-3.5 border-t border-atx-ink/15 pt-3">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-atx-mono text-[20px] font-bold text-atx-blue">{apy}</span>
                  <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-ink/45">example APY</span>
                </span>
                <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] border border-atx-ink/40 text-atx-ink/55 px-3 py-1.5">Example</span>
              </div>
            </div>
          ))}
        </div>
      </PageHero>

      {/* ── how the ULV works — the flagship mechanism ── */}
      <ULVMechanics />

      {/* ── vault list — the main event, straight after the hero ── */}
      <div className="max-w-[1100px] mx-auto px-7 pt-8 pb-[52px] max-[800px]:px-4 mw-reveal">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex border border-atx-ink">
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${filter === f ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink'}`}>
                {f}
              </button>
            ))}
          </div>
          <Link href="/app/vault/create" className="inline-flex items-center gap-1.5 px-4 py-2 bg-atx-blue text-white border border-atx-ink font-atx-mono text-[13px] font-semibold uppercase tracking-[0.04em] no-underline">
            + Create vault
          </Link>
        </div>

        {useMock && (
          <div className="bg-atx-panel border border-atx-ink/25 border-l-[3px] border-l-atx-clay px-3.5 py-2.5 text-[12px] text-atx-clay font-atx-mono mb-4 flex items-center gap-2">
            <Star className="w-3.5 h-3.5 shrink-0 text-atx-clay" />
            Showing example vault — no vaults have been seeded yet. Deploy a pool via the create flow to get started.
          </div>
        )}

        {loading ? (
          <div className="border border-atx-ink bg-atx-bone p-4 flex flex-col gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-11 bg-atx-panel border border-atx-ink/15 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-[60px] px-5 text-atx-ink/55 font-atx-display text-[14px]">
            <div className="flex justify-center mb-3"><Star className="w-8 h-8 text-atx-coral" /></div>
            <div>No DeFi {filter !== 'All' ? filter.toLowerCase() + ' ' : ''}vaults yet.</div>
          </div>
        ) : (
          <div className="border border-atx-ink bg-atx-bone overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[840px]">
              <thead>
                <tr className="border-b border-atx-ink bg-atx-panel">
                  {([['Vault', 'l'], ['Status', 'l'], ['TVL', 'r'], ['Reward pool', 'r'], ['Epoch', 'r'], ['Example APY', 'r'], ['Chain', 'l'], ['', 'r']] as const).map(([h, al], i) => (
                    <th key={i} className={`font-atx-mono text-[9.5px] uppercase tracking-[0.09em] text-atx-ink/55 px-4 py-3 whitespace-nowrap ${al === 'r' ? 'text-right' : 'text-left'} ${(i === 4 || i === 5) ? 'max-[820px]:hidden' : ''} ${i === 6 ? 'max-[680px]:hidden' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const st = STATUS_META[v.status ?? ''] ?? STATUS_META.closed
                  const ep = v.current_epoch
                  const tok = v.project_token ? `${v.project_token.slice(0, 6)}…${v.project_token.slice(-4)}` : ''
                  return (
                    <tr key={v.id} className="border-b border-atx-ink/15 last:border-b-0 hover:bg-atx-panel/60 transition-colors">
                      <td className="px-4 py-3.5 align-middle">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-8 h-8 border border-atx-ink bg-atx-bone grid place-items-center font-atx-mono text-[12px] font-bold shrink-0">{v.name.charAt(0)}</span>
                          <div className="min-w-0">
                            <div className="font-bold text-[14px] tracking-tight truncate flex items-center gap-1.5">
                              {v.name}
                              {v.is_sample && <span className="font-atx-mono text-[9px] uppercase tracking-[0.06em] text-atx-clay border border-atx-clay/50 px-1 py-0.5">example</span>}
                            </div>
                            <div className="font-atx-mono text-[11px] text-atx-ink/45 truncate">{tok}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 font-atx-mono text-[10px] uppercase tracking-[0.06em] border px-2 py-1 ${st.cls}`}>
                          {st.live && <span className="w-[6px] h-[6px] bg-atx-acid inline-block animate-pulse" />}{st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums">{v.tvl_usdc != null ? fmtUSD(v.tvl_usdc) : '—'}</td>
                      <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-mesquite">{ep?.total_pool != null ? fmtUSD(ep.total_pool) : '—'}</td>
                      <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-ink/70 max-[820px]:hidden">{ep ? `#${ep.epoch_number}` : '—'}</td>
                      <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-blue max-[820px]:hidden">{S.base.toFixed(1)}%</td>
                      <td className="px-4 py-3.5 font-atx-mono text-[12px] text-atx-ink/60 max-[680px]:hidden">{chainName(v.chain_id)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={`/app/vault/${v.id}`} className="inline-flex font-atx-mono text-[10.5px] uppercase tracking-[0.06em] border border-atx-ink px-3 py-1.5 no-underline text-atx-ink hover:bg-atx-ink hover:text-atx-bone transition-colors whitespace-nowrap">Open →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── educational deep-dive — the "why", below the vaults ── */}
      <VaultAmplify />
    </div>
  )
}

// ── Coming-soon overlay ──────────────────────────────────────────────────────
function VaultsComingSoon() {
  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center backdrop-blur-[14px] bg-atx-bone/70 font-atx-display [&_*]:rounded-none">
      <div className="text-center max-w-[380px] px-6">
        <div className="flex justify-center mb-4"><Star className="w-10 h-10 text-atx-coral" /></div>
        <div className="text-[24px] font-bold tracking-[-0.5px] text-atx-ink font-atx-display mb-2">Vaults — Coming Soon</div>
        <div className="text-[14px] text-atx-ink/55 leading-[1.6] font-atx-display mb-6">
          Social LP vaults with Attribution-weighted rewards. Earn more based on your on-chain reputation.
        </div>
        <span className="inline-flex items-center gap-1.5 bg-atx-bone border border-atx-ink/25 text-atx-blue px-4 py-1.5 text-[12px] font-semibold tracking-[0.5px] uppercase font-atx-mono">Phase 2</span>
      </div>
    </div>
  )
}

// Public front door — no wallet required to browse. Deposit/create actions live on
// their own guarded pages (/vault/[id], /vault/create), so funds still need a wallet.
export default function VaultsPage() {
  return (
    <>
      {VAULTS_LOCKED && <VaultsComingSoon />}
      <VaultsContent />
    </>
  )
}
