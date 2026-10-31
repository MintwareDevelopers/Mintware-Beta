'use client'

// Team · Treasury Overview — the terminal's home, as an ILLUSTRATIVE preview for wallets without an org.
// Flow: total value → the four numbers a treasury lead checks → where the money sits → recent payments →
// market activity. Figures are examples only; the shapes match the real org pages (Activity, Cards).
//
// The "Top contributors" leaderboard widget that lived here was removed 2026-08-28 with the rest of the
// human-facing Attribution surface. See attribution_review_2026_08_28 memory.
//
// Once a wallet has an active org, this mock is stale — it redirects to the real /app/org/[slug] home
// instead of showing example numbers over a real treasury.

import Link from 'next/link'
import { useRedirectToActiveOrg } from '@/components/web2/useActiveOrg'
import { PageHead, KpiRow, SLabel, Panel, StatusChip, Note, IconOrg } from '@/components/web2/TeamKit'

const KPIS = [
  { k: 'Paid out this month', v: '$61.8k', s: 'vendors and payroll' },
  { k: 'Card balances', v: '$12.4k', s: 'prefunded, across 6 cards' },
  { k: 'In Treasury yield', v: '$5.80M', s: 'variable lending rate' },
  { k: 'Members', v: '12', s: '3 can approve payments' },
]

// Where the money sits. Solid = deployed, dotted = prefunded card balances, hatched = unallocated reserve.
const ALLOC = [
  { name: 'Treasury yield (USDC lending)', pct: 68, bg: '#7C7AF0', tex: '' },
  { name: 'Market liquidity (TSLA / USDG)', pct: 18, bg: '#A9A7FA', tex: '' },
  { name: 'Card balances', pct: 6, bg: '#E1DBFA', tex: 'mw-tex-dots' },
  { name: 'Reserve (unallocated)', pct: 8, bg: '#ECECF2', tex: 'mw-tex-hatch' },
]

const PAYMENTS = [
  { who: 'Amazon Web Services', type: 'Vendor', amt: '$4,182.00', when: '2h ago', status: 'recorded' as const },
  { who: 'October payroll · 9 people', type: 'Payroll', amt: '$48,600.00', when: 'Yesterday', status: 'recorded' as const },
  { who: 'Figma', type: 'Vendor', amt: '$960.00', when: '3 days ago', status: 'settled' as const },
  { who: 'Card · Travel', type: 'Card', amt: '$2,340.55', when: '4 days ago', status: 'settled' as const },
]

const MARKET = [
  { who: '0x8a1f…d9e0', what: 'added liquidity to TSLA / USDG', amt: '+$42,000', when: '2m ago' },
  { who: '0x2b7d…0819', what: 'swapped through the pool', amt: '$12,400', when: '9m ago' },
  { who: '0x1a2b…3c4d', what: 'added liquidity to TSLA / USDG', amt: '+$8,900', when: '34m ago' },
  { who: '0x6e7f…8091', what: 'swapped through the pool', amt: '$3,120', when: '1h ago' },
]

export default function TreasuryOverview() {
  const redirecting = useRedirectToActiveOrg('')
  if (redirecting) return null

  return (
    <>
      <PageHead
        icon={<IconOrg size={24} />}
        title="Treasury overview"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="What a team treasury looks like on Mintware. Create an org to replace these examples with your own."
        actions={<Link href="/app/org/new" className="mw-btn !min-h-[40px]">Create an org</Link>}
      />

      {/* Total value */}
      <div className="mw-raise-lg relative overflow-hidden rounded-[28px] p-[clamp(20px,3vw,32px)] mt-7">
        <div aria-hidden className="absolute -right-24 -top-28 w-[380px] h-[380px] rounded-full opacity-30 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[14px] text-ink-mid">Total treasury value</div>
            <div className="font-geist-mono text-[clamp(38px,5.6vw,56px)] tracking-[-0.04em] leading-none mt-2">$7,943,204</div>
            <div className="text-[13.5px] text-ink-mid mt-3"><span className="font-geist-mono" style={{ color: 'var(--mw-gain)' }}>+$48,102</span> past 30 days · example</div>
          </div>
          <div className="flex gap-0.5 p-1 rounded-[12px] text-[12.5px] font-semibold" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden>
            {['7D', '30D', '1Y'].map((t, i) => (
              <span key={t} className="px-3 py-1 rounded-[9px]" style={i === 1 ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}>{t}</span>
            ))}
          </div>
        </div>
        <svg viewBox="0 0 400 64" preserveAspectRatio="none" className="relative block w-full h-[72px] mt-5" aria-hidden>
          <defs>
            <linearGradient id="tov-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5B5BE6" /><stop offset="1" stopColor="#E8794F" /></linearGradient>
            <linearGradient id="tov-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A9A7FA" stopOpacity=".35" /><stop offset="1" stopColor="#A9A7FA" stopOpacity="0" /></linearGradient>
          </defs>
          <path d="M0,48 40,44 80,46 120,38 160,40 200,30 240,33 280,24 320,26 360,16 400,18 400,64 0,64Z" fill="url(#tov-a)" />
          <polyline points="0,48 40,44 80,46 120,38 160,40 200,30 240,33 280,24 320,26 360,16 400,18" fill="none" stroke="url(#tov-l)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <KpiRow items={KPIS} />

      {/* Where it sits */}
      <SLabel>Where the money sits</SLabel>
      <Panel>
        <div className="flex h-4 rounded-full overflow-hidden gap-[3px] p-[3px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden>
          {ALLOC.map((a) => <span key={a.name} className={`rounded-full ${a.tex}`} style={{ width: `${a.pct}%`, backgroundColor: a.bg }} />)}
        </div>
        <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-x-6 gap-y-3 mt-5">
          {ALLOC.map((a) => (
            <div key={a.name} className="flex items-center gap-3">
              <span className={`w-3.5 h-3.5 rounded-[4px] shrink-0 ${a.tex}`} style={{ backgroundColor: a.bg }} />
              <span className="text-[14px] text-ink-mid flex-1 truncate">{a.name}</span>
              <span className="font-geist-mono text-[14px] text-ink">{a.pct}%</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-[1.2fr_1fr] max-[880px]:grid-cols-1 gap-4 mt-4">
        {/* Recent payments — same shape as the real Activity ledger */}
        <Panel title="Recent payments" right={<Link href="/app/org" className="text-[13px] font-semibold no-underline" style={{ color: 'var(--mw-peri-deep)' }}>Activity →</Link>} pad={false}>
          {PAYMENTS.map((p) => (
            <div key={p.who} className="flex items-center gap-3 px-5 py-3.5 border-b border-[rgba(21,21,29,.06)] last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink truncate">{p.who}</div>
                <div className="text-[12.5px] text-ink-soft mt-0.5">{p.type} · {p.when}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-geist-mono text-[14px] text-ink">{p.amt}</div>
                <div className="mt-1"><StatusChip tone={p.status === 'settled' ? 'live' : 'building'} className="capitalize">{p.status}</StatusChip></div>
              </div>
            </div>
          ))}
        </Panel>

        {/* Market activity on the pool the treasury provides */}
        <Panel title="Market activity" right={<StatusChip tone="preview">Example</StatusChip>} pad={false}>
          {MARKET.map((m, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-[rgba(21,21,29,.06)] last:border-0">
              <span className="w-8 h-8 rounded-full shrink-0" style={{ background: i % 2 ? 'var(--mw-well)' : 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', boxShadow: i % 2 ? 'var(--mw-inset)' : 'inset 0 1px 0 #fff' }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-ink truncate"><span className="font-geist-mono">{m.who}</span> <span className="text-ink-mid">{m.what}</span></div>
                <div className="text-[12px] text-ink-soft mt-0.5">{m.when}</div>
              </div>
              <span className="font-geist-mono text-[13.5px] text-ink shrink-0">{m.amt}</span>
            </div>
          ))}
        </Panel>
      </div>

      <Note>Illustrative. Every figure on this page is an example; create an org to see your own treasury. Testnet only, unaudited.</Note>
    </>
  )
}
