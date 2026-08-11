'use client'

import Link from 'next/link'
import type { SocialVault } from '@/lib/web2/vault/types'

const LABEL = 'font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

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

function StatusPill({ status }: { status: SocialVault['status'] }) {
  const map = {
    active:  { label: 'Active',  dot: 'bg-atx-acid' },
    seeding: { label: 'Seeding', dot: 'bg-atx-coral' },
    paused:  { label: 'Paused',  dot: 'bg-atx-grey' },
    closed:  { label: 'Closed',  dot: 'bg-atx-grey' },
  }
  const { label, dot } = map[status] ?? map.paused
  return (
    <span className="shrink-0 flex items-center gap-1.5 border border-atx-ink px-[7px] py-[2px] font-atx-mono text-[10px] uppercase tracking-[0.08em]">
      <span className={`w-[7px] h-[7px] border border-atx-ink inline-block ${dot}`} />
      {label}
    </span>
  )
}

// A deliberately loud tag so a showcase vault is never mistaken for a real one.
function SampleBadge() {
  return (
    <span className="shrink-0 flex items-center gap-1.5 border border-dashed border-atx-mesquite bg-atx-mesquite/10 text-atx-mesquite px-[7px] py-[2px] font-atx-mono text-[10px] uppercase tracking-[0.08em] font-semibold">
      Sample
    </span>
  )
}

const CHAIN_NAME: Record<number, string> = {
  1: 'Ethereum', 8453: 'Base', 84532: 'Base Sepolia', 42161: 'Arbitrum', 10: 'Optimism',
}

function LockMultiBar() {
  // Visual representation of lock tier multipliers
  const tiers = [
    { label: 'Flex', w: '25%', color: 'bg-atx-grey' },
    { label: '1.15×', w: '25%', color: 'bg-atx-blue' },
    { label: '1.3×', w: '25%', color: 'bg-atx-mesquite' },
    { label: '1.5×', w: '25%', color: 'bg-atx-clay' },
  ]
  return (
    <div className="flex h-[8px] border border-atx-ink overflow-hidden">
      {tiers.map((t, i) => (
        <div key={t.label} className={`${t.color} ${i ? 'border-l border-atx-ink' : ''}`} style={{ width: t.w }} />
      ))}
    </div>
  )
}

export function VaultCard({ vault }: { vault: SocialVault }) {
  // Default to SAMPLE unless a vault is explicitly marked real — never present
  // showcase data as a live vault.
  const sample = vault.is_sample !== false
  return (
    <Link
      href={`/vault/${vault.id}`}
      className={`font-atx-display bg-atx-panel border border-atx-ink border-l-[3px] flex flex-col gap-[14px] p-5 no-underline text-inherit transition-shadow duration-200 hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)] [&_*]:rounded-none ${sample ? 'border-l-atx-mesquite' : 'border-l-atx-blue'}`}
    >
      <div className="flex items-start justify-between gap-[10px]">
        <div className="flex items-start gap-[10px] flex-1">
          <div className="w-10 h-10 border border-atx-ink bg-atx-bone flex items-center justify-center shrink-0">
            <Star className="w-5 h-5 text-atx-blue" />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-atx-ink font-atx-display leading-[1.3]">{vault.name}</div>
            <div className="text-[11px] text-atx-ink/55 font-atx-mono mt-[2px]">
              {vault.pool_key?.token0 && vault.pool_key?.token1
                ? `${short(vault.pool_key.token0)} / ${short(vault.pool_key.token1)}`
                : vault.project_token ? short(vault.project_token) : '—'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sample && <SampleBadge />}
          <StatusPill status={vault.status} />
        </div>
      </div>

      {sample ? (
        /* Sample: no fabricated TVL/pool dollars — honest illustrative framing. */
        <div className="grid grid-cols-2 gap-[10px]">
          <div className="flex flex-col gap-[2px]">
            <span className="text-[15px] font-bold font-atx-mono text-atx-ink/70">Illustrative</span>
            <span className={LABEL}>Example vault</span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <span className="text-[15px] font-bold font-atx-mono text-atx-mesquite">Not live</span>
            <span className={LABEL}>Preview only</span>
          </div>
        </div>
      ) : (
        /* Real vault: show actual TVL + network. */
        <div className="grid grid-cols-2 gap-[10px]">
          <div className="flex flex-col gap-[2px]">
            <span className="text-[15px] font-bold font-atx-mono text-atx-ink/70">${vault.tvl_usdc.toLocaleString()}</span>
            <span className={LABEL}>TVL</span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <span className="text-[15px] font-bold font-atx-mono text-atx-blue">{CHAIN_NAME[vault.chain_id] ?? 'Chain'}</span>
            <span className={LABEL}>Network</span>
          </div>
        </div>
      )}

      <div>
        <div className={`${LABEL} mb-[6px]`}>Lock tier multipliers</div>
        <LockMultiBar />
        <div className="flex justify-between mt-1">
          {['1.0×', '1.15×', '1.3×', '1.5×'].map(m => (
            <span key={m} className="text-[10px] text-atx-ink/45 font-atx-mono">{m}</span>
          ))}
        </div>
      </div>

      <div className={`flex items-center justify-between pt-[10px] border-t ${LINE}`}>
        <span className="text-[11px] text-atx-ink/45 font-atx-mono">Attribution-weighted rewards</span>
        <span className="text-[12px] font-semibold text-atx-blue font-atx-mono">Deposit →</span>
      </div>
    </Link>
  )
}
