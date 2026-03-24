'use client'

import Link from 'next/link'
import type { SocialVault } from '@/lib/web2/vault/types'
import { fmtUSD } from '@/lib/web2/api'

function StatusPill({ status }: { status: SocialVault['status'] }) {
  const map = {
    active:  { label: 'Active',  cls: 'mw-pill-live' },
    seeding: { label: 'Seeding', cls: 'mw-pill-soon' },
    paused:  { label: 'Paused',  cls: 'mw-pill-ended' },
    closed:  { label: 'Closed',  cls: 'mw-pill-ended' },
  }
  const { label, cls } = map[status] ?? map.paused
  return <span className={`mw-pill ${cls}`}>{label}</span>
}

function LockMultiBar() {
  // Visual representation of lock tier multipliers
  const tiers = [
    { label: 'Flex', w: '25%', color: 'var(--color-mw-ink-3)' },
    { label: '1.15×', w: '25%', color: 'var(--color-mw-brand)' },
    { label: '1.3×', w: '25%', color: 'var(--color-mw-teal)' },
    { label: '1.5×', w: '25%', color: 'var(--color-mw-amber)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, height: 3, borderRadius: 2, overflow: 'hidden' }}>
      {tiers.map(t => (
        <div key={t.label} style={{ width: t.w, background: t.color, opacity: 0.7 }} />
      ))}
    </div>
  )
}

export function VaultCard({ vault }: { vault: SocialVault }) {
  const tvl       = vault.tvl_usdc ?? 0
  const epochPool = vault.current_epoch?.total_pool ?? 0

  return (
    <>
      <style>{`
        .vault-card {
          background: var(--color-mw-surface-card);
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-md);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
          cursor: pointer;
          text-decoration: none;
          color: inherit;
        }
        .vault-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--color-mw-border-mid);
        }
        .vault-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        .vault-card-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-sm);
          background: var(--color-mw-brand-dim);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }
        .vault-card-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--color-mw-ink);
          font-family: var(--font-jakarta);
          line-height: 1.3;
          flex: 1;
        }
        .vault-card-token {
          font-size: 11px;
          color: var(--color-mw-ink-3);
          font-family: var(--font-mono);
          margin-top: 2px;
        }
        .vault-card-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .vault-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vault-stat-val {
          font-size: 17px;
          font-weight: 700;
          font-family: var(--font-mono);
          color: var(--color-mw-ink);
        }
        .vault-stat-val.green { color: var(--color-mw-green); }
        .vault-stat-val.brand { color: var(--color-mw-brand); }
        .vault-stat-lbl {
          font-size: 11px;
          color: var(--color-mw-ink-3);
          font-family: var(--font-jakarta);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .vault-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 10px;
          border-top: 1px solid var(--color-mw-border);
        }
        .vault-footer-label {
          font-size: 11px;
          color: var(--color-mw-ink-4);
          font-family: var(--font-jakarta);
          font-weight: 500;
        }
        .vault-card-cta {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-mw-brand);
          font-family: var(--font-jakarta);
        }
      `}</style>
      <Link href={`/vault/${vault.id}`} className="vault-card">
        <div className="vault-card-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
            <div className="vault-card-icon">⬡</div>
            <div>
              <div className="vault-card-name">{vault.name}</div>
              <div className="vault-card-token">
                {vault.project_token.slice(0, 6)}…{vault.project_token.slice(-4)}
              </div>
            </div>
          </div>
          <StatusPill status={vault.status} />
        </div>

        <div className="vault-card-stats">
          <div className="vault-stat">
            <span className="vault-stat-val brand">{tvl > 0 ? fmtUSD(tvl) : '—'}</span>
            <span className="vault-stat-lbl">TVL</span>
          </div>
          <div className="vault-stat">
            <span className="vault-stat-val green">{epochPool > 0 ? fmtUSD(epochPool) : '—'}</span>
            <span className="vault-stat-lbl">Epoch pool</span>
          </div>
        </div>

        <div>
          <div className="vault-footer-label" style={{ marginBottom: 6 }}>Lock tier multipliers</div>
          <LockMultiBar />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {['1.0×', '1.15×', '1.3×', '1.5×'].map(m => (
              <span key={m} style={{ fontSize: 10, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-mono)' }}>{m}</span>
            ))}
          </div>
        </div>

        <div className="vault-card-footer">
          <span className="vault-footer-label">Attribution-weighted rewards</span>
          <span className="vault-card-cta">Deposit →</span>
        </div>
      </Link>
    </>
  )
}
