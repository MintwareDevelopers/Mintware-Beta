'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { VaultCard } from '@/components/web2/vault/VaultCard'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'
import type { SocialVault, VaultStatus } from '@/lib/web2/vault/types'

type Filter = 'All' | 'Active' | 'Seeding' | 'Closed'
const FILTERS: Filter[] = ['All', 'Active', 'Seeding', 'Closed']

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px]'
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const CORAL_INK = '#5a1e12'

// ── mock data for development / before DB is seeded ───────────────────────
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

const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'

// ── Surface pitches (RWA is the default / first tab) ─────────────────────────
type Surface = 'rwa' | 'defi'
const SURFACES: Record<Surface, {
  eyName: string; acc: string; accInk: string; head: [string, string]; sub: string;
  bullets: string[]; base: number; featured: [string, string, string][]
}> = {
  rwa: {
    eyName: 'RWA surface', acc: '#FF8574', accInk: CORAL_INK,
    head: ['Institutional yield. ', 'No gatekeepers.'],
    sub: 'Real estate, credit, T-bills — as a bearer token. Deposit any amount, no KYC, no minimums. Hold it, trade it 24/7, or redeem the underlying only if you ever want to.',
    bullets: ['Any amount — no $50k minimum', 'No KYC to deposit — only at redemption', 'vRWA bearer token, trade on Uniswap 24/7', 'Oracle-banded, fair-valued pricing'],
    base: 9.0,
    featured: [['ATX Credit Facility', 'vRWA / USDC', '10.4%'], ['LiquidHectar Note', 'vRWA / USDC', '9.0%']],
  },
  defi: {
    eyName: 'DeFi surface', acc: '#006FCC', accInk: '#ffffff',
    head: ['Same deposit. Your reputation. ', 'More yield.'],
    sub: 'MEV-protected, auto-managed LP on Uniswap V4. Your Attribution score lifts your fee share up to 2× — so the exact same position earns you more than the wallet next to you.',
    bullets: ['MEV protection — V4 hooks route bot value back to LPs', 'Auto-managed range — no rebalancing', 'Idle capital routed to yield', 'Reputation fee share, up to 2×'],
    base: 8.5,
    featured: [['Social Blue-Chip', 'ETH / USDC', '11.0%'], ['Degen Emerging', 'ARB / USDC', '18.4%']],
  },
}
const TIERS: [string, number][] = [['Bronze', 1.0], ['Silver', 1.25], ['Gold', 1.5]]
const usd = (n: number) => '$' + Math.round(n).toLocaleString()

// ── VaultsContent ────────────────────────────────────────────────────────────
function VaultsContent() {
  useAccount()
  const [vaults, setVaults]   = useState<SocialVault[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('All')
  const [useMock, setUseMock] = useState(false)
  const [surface, setSurface] = useState<Surface>('rwa')
  const [deposit, setDeposit] = useState(10000)

  useEffect(() => {
    fetch('/api/vaults')
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
  const filtered = filter === 'All' ? vaults : vaults.filter(v => v.status === statusFromFilter(filter))

  const S = SURFACES[surface]
  const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

  return (
    <div className="font-atx-display bg-atx-bone min-h-screen text-atx-ink [&_*]:rounded-none">
      <MwNav />

      {/* ── HERO — two-surface toggle + surface pitch ── */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="max-w-[1100px] mx-auto px-7 pt-10 pb-9 max-[800px]:px-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className={ey}>✴ Two-surface vaults · {S.eyName}</div>
            <div className="inline-flex border border-atx-ink">
              {(['rwa', 'defi'] as Surface[]).map((s, i) => (
                <button
                  key={s}
                  onClick={() => setSurface(s)}
                  className={`font-atx-mono text-[12px] uppercase tracking-[0.12em] px-6 py-2.5 cursor-pointer ${i === 0 ? 'border-r border-atx-ink' : ''} ${surface === s ? 'bg-atx-ink text-atx-bone' : 'bg-atx-bone text-atx-ink/55'}`}
                >
                  {s === 'rwa' ? 'RWA' : 'DeFi'}
                </button>
              ))}
            </div>
          </div>

          <h1 className="font-bold tracking-[-0.02em] leading-[0.98] text-[clamp(32px,5vw,62px)] mt-6 max-w-[16ch] text-wrap-balance">
            {S.head[0]}<span style={{ color: S.acc }}>{S.head[1]}</span>
          </h1>
          <p className="text-[clamp(15px,1.8vw,19px)] leading-[1.5] text-atx-ink/70 max-w-[54ch] mt-5">{S.sub}</p>

          <div className="grid grid-cols-2 gap-y-2.5 gap-x-8 mt-6 max-w-[760px] max-[560px]:grid-cols-1">
            {S.bullets.map(b => (
              <div key={b} className="flex gap-2.5 items-start text-[14px] leading-[1.4]">
                <span className="w-[9px] h-[9px] mt-1 border border-atx-ink inline-block shrink-0" style={{ background: S.acc }} />
                {b}
              </div>
            ))}
          </div>

          {/* featured vaults for this surface */}
          <div className="grid grid-cols-2 gap-3 mt-8 max-w-[760px] max-[560px]:grid-cols-1">
            {S.featured.map(([name, pair, apy]) => (
              <div key={name} className="border border-atx-ink bg-atx-panel p-[18px]" style={{ borderTop: `4px solid ${S.acc}` }}>
                <div className="text-[17px] font-bold">{name}</div>
                <div className="font-atx-mono text-[11px] text-atx-ink/55 mt-1">{pair}</div>
                <div className="flex items-center justify-between mt-3.5 border-t border-atx-ink/15 pt-3">
                  <span className="font-atx-mono text-[20px] font-bold" style={{ color: S.accInk === '#ffffff' ? S.acc : S.accInk }}>{apy}</span>
                  <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] border border-atx-ink px-3 py-1.5">Deposit →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE WOW — reputation calculator ── */}
      <section className="border-b border-atx-ink bg-atx-panel">
        <div className="max-w-[1100px] mx-auto px-7 py-9 max-[800px]:px-4">
          <div className="text-[clamp(18px,2.3vw,28px)] font-bold tracking-[-0.5px] leading-[1.15] max-w-[24ch]">
            Same deposit. Your reputation. <span style={{ color: S.acc }}>Different yield.</span>
          </div>
          <div className="flex items-center gap-3 mt-5 max-w-[520px]">
            <span className={`${ey} whitespace-nowrap`}>Your deposit</span>
            <input type="range" min={1000} max={500000} step={1000} value={deposit} onChange={e => setDeposit(Number(e.target.value))}
              className="flex-1 h-2 border border-atx-ink bg-atx-bone appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:bg-atx-ink [&::-webkit-slider-thumb]:cursor-pointer" />
            <span className="font-atx-mono text-[18px] font-bold w-[92px] text-right">{usd(deposit)}</span>
          </div>
          <div className="grid grid-cols-3 border border-atx-ink mt-6 max-[560px]:grid-cols-1">
            {TIERS.map(([name, mult], i) => {
              const amt = deposit * (S.base / 100) * mult
              const isGold = i === 2
              return (
                <div key={name} className={`p-5 ${i < 2 ? 'border-r border-atx-ink max-[560px]:border-r-0 max-[560px]:border-b' : ''}`}
                  style={isGold ? { background: S.acc, color: S.accInk } : undefined}>
                  <div className="font-atx-mono text-[11px] uppercase tracking-[0.12em] opacity-70">{name} · {mult.toFixed(2)}×</div>
                  <div className="font-atx-mono text-[clamp(26px,3vw,34px)] font-bold tracking-[-1px] mt-2.5 tabular-nums">{usd(amt)}</div>
                  <div className="font-atx-mono text-[10px] uppercase tracking-[0.1em] opacity-60 mt-0.5">per year</div>
                </div>
              )
            })}
          </div>
          <div className="font-atx-mono text-[12px] text-atx-mesquite mt-4">
            <b style={{ color: S.acc }}>↳</b> {usd(deposit * (S.base / 100) * 0.5)} more per year — same deposit, same vault. That gap is your Attribution score, paid.
          </div>
        </div>
      </section>

      {/* ── vault list ── */}
      <div className="max-w-[1100px] mx-auto px-7 pt-8 pb-[52px] max-[800px]:px-4">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex border border-atx-ink">
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${filter === f ? 'bg-atx-ink text-atx-bone' : 'bg-transparent text-atx-ink'}`}>
                {f}
              </button>
            ))}
          </div>
          <Link href="/vault/create" className="inline-flex items-center gap-1.5 px-4 py-2 bg-atx-blue text-white border border-atx-ink font-atx-mono text-[13px] font-semibold uppercase tracking-[0.04em] no-underline">
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

      {/* ── RWA · why DeFi ── */}
      <RwaWhyDefi />

      {/* ── educational deep-dive ── */}
      <VaultAmplify />
    </div>
  )
}

// ── RWA "why DeFi" section ───────────────────────────────────────────────────
function RwaWhyDefi() {
  const GAP = [
    ['Gated.', 'Same accreditation wall, new wrapper — accredited investors only.'],
    ['Illiquid.', 'Redemption by request, quarterly windows, thin-to-no secondary market.'],
    ['Siloed.', 'A token that can’t touch the rest of DeFi — no collateral, no composability.'],
    ['Paper ownership.', 'Still a database entry on someone else’s cap table.'],
  ]
  const FIX = [
    ['Permissionless.', 'Any wallet, any amount. KYC only if you redeem the underlying.', false],
    ['Liquid.', 'Trade vRWA 24/7 on Uniswap — no phone calls, no lockups.', false],
    ['Composable.', 'Use vRWA as collateral, in strategies, in other vaults.', false],
    ['Bearer ownership.', 'A token you actually hold, in your wallet.', false],
    ['Reputation-weighted yield.', '', true],
  ]
  return (
    <section className="border-b border-atx-ink">
      <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
        <div className="flex items-center gap-2.5">
          <span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />
          <span className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55">Why real-world assets belong on DeFi</span>
        </div>
        <h2 className="font-bold tracking-[-0.02em] text-[clamp(26px,3.6vw,44px)] leading-[1.02] max-w-[20ch] mt-4">
          Tokenizing was the easy part. <span className="text-atx-blue">DeFi is where RWAs come alive.</span>
        </h2>
        <p className="text-[16px] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-4">
          Trillions got “tokenized” this cycle — and most of it just sits there: gated, illiquid, and no more useful than the spreadsheet it replaced. Wrapping an asset in a token was never the point. What the token can <i>do</i> is.
        </p>
        <div className="grid grid-cols-2 border border-atx-ink mt-8 max-[720px]:grid-cols-1">
          <div className="p-6 border-r border-atx-ink bg-atx-panel max-[720px]:border-r-0 max-[720px]:border-b">
            <div className="font-atx-mono text-[12px] uppercase tracking-[0.12em] text-atx-ink/45 mb-4">✕ Tokenized — still stuck</div>
            {GAP.map(([h, d]) => (
              <div key={h} className="flex gap-3 items-start py-3 border-b border-atx-ink/10 last:border-b-0">
                <span className="font-atx-mono font-bold text-atx-ink/35">✕</span>
                <span className="text-[14px] leading-[1.45]"><b>{h}</b> {d}</span>
              </div>
            ))}
          </div>
          <div className="p-6">
            <div className="font-atx-mono text-[12px] uppercase tracking-[0.12em] mb-4 text-atx-blue">✴ On Mintware — unlocked</div>
            {FIX.map(([h, d, hot]) => (
              <div key={h as string} className="flex gap-3 items-start py-3 border-b border-atx-ink/10 last:border-b-0">
                <span className="font-atx-mono font-bold text-atx-blue">✓</span>
                <span className="text-[14px] leading-[1.45]">
                  <b>{h}</b> {d}
                  {hot && <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] bg-atx-acid border border-atx-ink px-1.5 py-0.5 ml-2 whitespace-nowrap">only on Mintware</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[clamp(19px,2.4vw,28px)] font-bold tracking-[-0.4px] leading-[1.25] max-w-[26ch] mt-9">
          Real-world assets don’t need a blockchain to exist. <span className="text-atx-blue">They need DeFi to finally move.</span>
        </div>
      </div>
    </section>
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
