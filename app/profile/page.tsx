'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr } from '@/lib/api'
import { WalletDisplay } from '@/components/WalletDisplay'
import { useReferral } from '@/lib/referral/useReferral'
import { ReferralSheet } from '@/components/referral/ReferralSheet'
import { InviteTab } from '@/components/referral/InviteTab'
import { ClaimCard } from '@/components/campaigns/ClaimCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Signal {
  key: string
  name: string
  icon: string
  max: number
  color: string
  score: number
  insights: string[]
}

interface ScoreResponse {
  address: string
  score: number
  tier: string
  percentile: number
  signals: Signal[]
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  character: { label: string; color: string; desc: string; icon: string }
  uvOpportunities: {
    name: string; cat: string; icon: string
    type: string; typeColor: string; accentColor: string
    mechanic: string; lo: number; hi: number; reason: string
  }[]
  totalLo: number
  totalHi: number
}

type Tab = 'portfolio' | 'score' | 'badge' | 'invite' | 'rewards'

// ─── Profile content ──────────────────────────────────────────────────────────
function ProfileContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData] = useState<ScoreResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [easAttestation, setEasAttestation] = useState<{ uid: string; eas_explorer_url: string; attested_at?: string } | null>(null)
  const [easLoading, setEasLoading]         = useState(false)

  const {
    stats: refStats,
    referralRecords,
    refCode,
    isFirstConnect,
    isLoading: refLoading,
  } = useReferral(wallet || undefined)

  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [wallet])

  // Fetch (or create) EAS attestation when the Score tab becomes active
  useEffect(() => {
    if (activeTab !== 'score' || !wallet || easAttestation || easLoading) return
    setEasLoading(true)
    fetch(`/api/eas/attest-score?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        if (d?.uid) setEasAttestation(d)
      })
      .catch(() => {})
      .finally(() => setEasLoading(false))
  }, [activeTab, wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const score = data?.score ?? 0
  const tier = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const maxScore = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925

  return (
    <div className="min-h-screen">
      <ReferralSheet
        stats={refStats}
        trigger={isFirstConnect && !loading && !!data}
      />
      {/* Dark hero header */}
      <div className="mw-grid-overlay bg-mw-ink relative overflow-hidden pt-9 animate-fade-up max-sm:pt-6">
        <div className="absolute top-[-60px] right-[10%] w-[320px] h-[320px] rounded-full bg-[radial-gradient(circle,rgba(0,82,255,0.2)_0%,transparent_65%)] pointer-events-none" />
        <div className="max-w-[960px] mx-auto px-12 max-sm:px-5">
          <div className="flex items-start gap-[22px] pb-7 relative max-sm:flex-wrap">
            <div className="w-[82px] h-[82px] rounded-[20px] bg-[rgba(255,255,255,0.07)] border-[1.5px] border-[rgba(255,255,255,0.12)] flex items-center justify-center text-[36px] font-bold text-[rgba(255,255,255,0.9)] shrink-0 relative font-[var(--font-mono),'DM_Mono',monospace]">
              {avatarLetter}
              {score > 0 && (
                <div className="absolute bottom-[-1px] right-[-1px] bg-mw-brand text-white font-[var(--font-mono),'DM_Mono',monospace] text-[10px] font-semibold px-2 py-[3px] rounded-[8px_0_8px_0] whitespace-nowrap">
                  {score}
                </div>
              )}
            </div>
            <div className="flex-1 pt-1">
              <div className="text-[22px] font-bold text-[rgba(255,255,255,0.92)] tracking-[-0.5px] flex items-center gap-2 flex-wrap mb-1.5">
                <WalletDisplay address={wallet} mono style={{ color: 'rgba(255,255,255,0.92)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }} />
                {data && (
                  <span className="text-[10px] font-semibold bg-[rgba(0,82,255,0.2)] text-[#6b9fff] px-2.5 py-[3px] rounded-full border border-[rgba(0,82,255,0.3)] tracking-[0.3px] whitespace-nowrap">
                    {tier} tier
                  </span>
                )}
              </div>
              <div className="font-[var(--font-mono),'DM_Mono',monospace] text-[11px] text-[rgba(255,255,255,0.28)] mb-3 flex items-center gap-2 flex-wrap break-all">
                {wallet}
                <span
                  className="bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-px text-[10px] cursor-pointer text-[rgba(255,255,255,0.4)] shrink-0 transition-all duration-150 hover:text-mw-brand hover:border-[rgba(0,82,255,0.4)] hover:bg-[rgba(0,82,255,0.08)]"
                  onClick={copyAddress}
                >
                  {copied ? 'copied ✓' : 'copy'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {data?.walletAge && (
                  <span className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-full px-3 py-1 text-[11px] text-[rgba(255,255,255,0.45)] flex items-center gap-[5px]">
                    📅 {data.walletAge} old
                  </span>
                )}
                {data?.chains != null && (
                  <span className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-full px-3 py-1 text-[11px] text-[rgba(255,255,255,0.45)] flex items-center gap-[5px]">
                    🔗 {data.chains} chains
                  </span>
                )}
                {data?.totalTxCount != null && (
                  <span className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-full px-3 py-1 text-[11px] text-[rgba(255,255,255,0.45)] flex items-center gap-[5px]">
                    ⚡ {data.totalTxCount} txns
                  </span>
                )}
                {data?.percentile != null && (
                  <span className="bg-[rgba(0,82,255,0.15)] border border-[rgba(0,82,255,0.25)] text-[#6b9fff] rounded-full px-3 py-1 text-[11px] flex items-center gap-[5px]">
                    top {100 - data.percentile}%
                  </span>
                )}
              </div>
            </div>

            <div className="text-right min-w-[160px] pt-1 shrink-0 max-sm:min-w-0 max-sm:w-full max-sm:text-left">
              {data ? (
                <>
                  <div className="text-[22px] font-bold text-[#4ade80] tracking-[-0.5px] font-[var(--font-mono),'DM_Mono',monospace]">
                    ${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-[rgba(255,255,255,0.28)] mt-1">Estimated annual earnings</div>
                </>
              ) : loading ? (
                <div className="text-[13px] text-[rgba(255,255,255,0.25)]">Loading…</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-t border-[rgba(255,255,255,0.06)]">
          <div className="max-w-[960px] mx-auto px-12 max-sm:px-5 flex items-stretch overflow-x-auto">
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(255,255,255,0.06)] shrink-0 bg-[rgba(0,82,255,0.1)] border-t-2 border-t-mw-brand -mt-px">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">Attribution score</span>
              <span className="text-[#6b9fff] font-[var(--font-mono),'DM_Mono',monospace] text-sm font-semibold whitespace-nowrap">
                {score > 0 ? `${score} / ${maxScore}` : '—'}
              </span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(255,255,255,0.06)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">Percentile</span>
              <span className="text-sm font-semibold text-[rgba(255,255,255,0.82)] whitespace-nowrap">{data ? `${data.percentile}th` : '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(255,255,255,0.06)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">First seen</span>
              <span className="text-sm font-semibold text-[rgba(255,255,255,0.82)] whitespace-nowrap">{data?.firstSeen ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(255,255,255,0.06)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">Chains</span>
              <span className="text-sm font-semibold text-[rgba(255,255,255,0.82)] whitespace-nowrap">{data?.chains ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 border-r border-[rgba(255,255,255,0.06)] shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">Network size</span>
              <span className="text-sm font-semibold text-[rgba(255,255,255,0.82)] whitespace-nowrap">{data?.treeSize ?? 0} wallets</span>
            </div>
            <div className="flex flex-col gap-[3px] px-5 py-3.5 shrink-0">
              <span className="text-[10px] font-bold tracking-[0.8px] uppercase text-[rgba(255,255,255,0.25)] whitespace-nowrap">Character</span>
              <span
                className="text-sm font-semibold whitespace-nowrap"
                style={{ color: data?.character?.color ?? 'rgba(255,255,255,0.82)' }}
              >
                {data?.character?.icon} {data?.character?.label ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="pt-5 bg-transparent">
        <div className="max-w-[960px] mx-auto px-12 max-sm:px-5">
          <div className="flex gap-2 max-sm:flex-wrap max-sm:gap-1.5">
            {(['portfolio', 'score', 'badge', 'invite', 'rewards'] as Tab[]).map(t => (
              <div
                key={t}
                className={[
                  'px-[18px] py-2 text-[13px] font-medium cursor-pointer rounded-full transition-all duration-150 border select-none',
                  'max-sm:px-3.5 max-sm:py-1.5 max-sm:text-xs',
                  activeTab === t
                    ? 'text-mw-brand bg-mw-brand-dim border-[rgba(0,82,255,0.18)] font-semibold'
                    : 'text-mw-ink-3 border-transparent hover:text-mw-ink hover:bg-[rgba(26,26,46,0.06)] hover:border-mw-border',
                ].join(' ')}
                onClick={() => setActiveTab(t)}
              >
                {t === 'portfolio' ? '📊 Portfolio' : t === 'score' ? '⚡ Score' : t === 'badge' ? '🏅 Badge' : t === 'invite' ? '◉ Invite' : '💰 Rewards'}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="bg-transparent pb-20">
        <div className="max-w-[960px] mx-auto px-12 max-sm:px-5 pt-5 [animation:fadeUp_0.4s_0.08s_ease_both]">

          {activeTab === 'portfolio' && (
            <>
              {loading && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading score data…</div>
              )}

              {!loading && data && data.uvOpportunities?.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-mw-brand mb-3.5 block">
                    Earning opportunities for your wallet
                  </span>
                  <div className="flex flex-col gap-2.5">
                    {data.uvOpportunities.map((op, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3.5 px-[18px] py-4 border border-mw-border rounded-[14px] transition-all duration-150 bg-white shadow-[0_1px_4px_rgba(26,26,46,0.04)] hover:border-[rgba(0,82,255,0.25)] hover:shadow-md hover:-translate-y-px"
                      >
                        <div
                          className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg shrink-0"
                          style={{ background: op.accentColor + '18', color: op.accentColor }}
                        >
                          {op.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-bold text-mw-ink">{op.name}</span>
                            <span className="text-[10px] text-mw-ink-3">{op.cat}</span>
                            <span
                              className="text-[9px] font-bold tracking-[0.5px] uppercase px-[7px] py-px rounded"
                              style={{ color: op.typeColor, background: op.typeColor + '18' }}
                            >
                              {op.type}
                            </span>
                          </div>
                          <div className="text-[11px] text-mw-ink-3 mb-1">{op.mechanic}</div>
                          <div
                            className="text-[11px] text-mw-ink-2 leading-[1.55]"
                            dangerouslySetInnerHTML={{ __html: op.reason }}
                          />
                        </div>
                        <div className="text-right shrink-0 pl-2">
                          <div className="text-[13px] font-bold text-mw-green font-[var(--font-mono),'DM_Mono',monospace]">
                            ${op.lo}–${op.hi}
                          </div>
                          <div className="text-[10px] text-mw-ink-3 mt-0.5">est. / yr</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!loading && !data && (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">
                  Could not load score data. The API may be indexing your wallet.
                </div>
              )}
            </>
          )}

          {activeTab === 'score' && (
            <div className="bg-white border border-mw-border rounded-[20px] p-6 shadow-[0_1px_4px_rgba(26,26,46,0.04)]">
              <div className="flex items-center justify-between mb-[22px]">
                <span className="text-[10px] font-bold text-mw-brand tracking-[1.5px] uppercase">Attribution score</span>
                <span className="text-[11px] text-white bg-mw-brand px-3 py-1 rounded-full font-semibold">{tier} tier</span>
              </div>

              {loading && <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>}

              {data && (
                <>
                  <div className="flex items-start gap-5 mb-6">
                    <div>
                      <div className="text-[52px] font-bold text-mw-brand font-[var(--font-mono),'DM_Mono',monospace] tracking-[-2px] leading-none">
                        {score}
                      </div>
                      <div className="text-[11px] text-mw-ink-3 mt-1.5 font-[var(--font-mono),'DM_Mono',monospace]">
                        of {maxScore} max · {data.percentile}th percentile
                      </div>
                    </div>
                    {data.character && (
                      <div className="flex-1 bg-mw-surface border border-mw-border rounded-xl px-4 py-3.5">
                        <div className="text-[10px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 mb-1.5">Wallet character</div>
                        <div
                          className="text-sm font-bold mb-[5px]"
                          style={{ color: data.character.color }}
                        >
                          {data.character.icon} {data.character.label}
                        </div>
                        <div className="text-xs text-mw-ink-2 leading-[1.55]">{data.character.desc}</div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    {data.signals.map(sig => (
                      <div
                        key={sig.key}
                        className="flex flex-col gap-1.5 px-3.5 py-3 bg-mw-surface rounded-[10px] border border-mw-border"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-mw-ink-2 font-medium">{sig.icon} {sig.name}</span>
                          <span
                            className="text-xs font-semibold font-[var(--font-mono),'DM_Mono',monospace]"
                            style={{ color: sig.color }}
                          >
                            {sig.score} / {sig.max}
                          </span>
                        </div>
                        <div className="h-[3px] bg-mw-border rounded-sm overflow-hidden">
                          <div
                            className="h-full rounded-sm transition-[width] duration-[800ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                            style={{ width: Math.round((sig.score / sig.max) * 100) + '%', background: sig.color }}
                          />
                        </div>
                        {sig.insights?.length > 0 && (
                          <div className="text-[10px] text-mw-ink-3 leading-[1.5]">{sig.insights[0]}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* EAS Attestation card */}
                  <div style={{
                    marginTop: 16,
                    background: 'var(--color-mw-surface-card)',
                    border: '1.5px solid var(--color-mw-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 36, height: 36,
                        borderRadius: 10,
                        background: 'rgba(58,92,232,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        🔗
                      </div>
                      <div>
                        <div style={{
                          fontSize: 12, fontWeight: 700,
                          color: 'var(--color-mw-ink)',
                          fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
                          marginBottom: 3,
                        }}>
                          Attested on Base
                        </div>
                        {easLoading ? (
                          <div style={{
                            width: 140, height: 12, borderRadius: 4,
                            background: 'rgba(26,26,46,0.07)',
                            animation: 'pulse 1.4s ease-in-out infinite',
                          }} />
                        ) : easAttestation ? (
                          <div style={{
                            fontSize: 11, color: 'var(--color-mw-ink-3)',
                            fontFamily: 'var(--font-mono, "DM Mono", monospace)',
                          }}>
                            {shortAddr(easAttestation.uid)}
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)' }}>
                            Your score is cryptographically signed
                          </div>
                        )}
                      </div>
                    </div>
                    {easAttestation && (
                      <a
                        href={easAttestation.eas_explorer_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 11, fontWeight: 600,
                          color: 'var(--color-mw-brand-deep)',
                          textDecoration: 'none',
                          fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
                          whiteSpace: 'nowrap',
                          padding: '6px 12px',
                          background: 'rgba(58,92,232,0.08)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(58,92,232,0.15)',
                          transition: 'background 0.15s',
                        }}
                      >
                        View on EAS ↗
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'invite' && (
            <InviteTab
              wallet={wallet}
              refCode={refCode}
              stats={refStats}
              referralRecords={referralRecords}
              isLoading={refLoading}
            />
          )}

          {activeTab === 'rewards' && (
            <ClaimCard wallet={wallet} />
          )}

          {activeTab === 'badge' && (
            <div className="text-center px-6 py-12 bg-white border border-mw-border rounded-[20px] shadow-[0_1px_4px_rgba(26,26,46,0.04)]">
              {data ? (
                <>
                  <div className="text-[56px] mb-3.5 leading-none">{data.character?.icon ?? '🏅'}</div>
                  <div
                    className="text-xl font-bold tracking-[-0.3px] mb-1.5"
                    style={{ color: data.character?.color ?? '#0052FF' }}
                  >
                    {data.character?.label ?? tier}
                  </div>
                  <div className="text-[13px] text-mw-ink-3 mb-4">
                    {tier} tier · {data.percentile}th percentile
                  </div>
                  <div className="text-[13px] leading-[1.7] max-w-[380px] mx-auto mb-7 text-mw-ink-2">
                    {data.character?.desc}
                  </div>
                  <div className="inline-flex bg-mw-surface border border-mw-border rounded-[14px] overflow-hidden max-sm:flex-col">
                    <div className="px-7 py-4 border-r border-mw-border text-center max-sm:border-r-0 max-sm:border-b max-sm:border-b-mw-border">
                      <div
                        className="text-[22px] font-bold font-[var(--font-mono),'DM_Mono',monospace] tracking-[-0.5px]"
                        style={{ color: '#0052FF' }}
                      >
                        {score}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Score</div>
                    </div>
                    <div className="px-7 py-4 border-r border-mw-border text-center max-sm:border-r-0 max-sm:border-b max-sm:border-b-mw-border">
                      <div className="text-[22px] font-bold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace] tracking-[-0.5px]">
                        {data.chains}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Chains</div>
                    </div>
                    <div className="px-7 py-4 text-center">
                      <div className="text-[22px] font-bold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace] tracking-[-0.5px]">
                        {data.treeSize}
                      </div>
                      <div className="text-[10px] text-mw-ink-3 mt-[3px] font-semibold tracking-[0.5px] uppercase">Network</div>
                    </div>
                  </div>
                </>
              ) : loading ? (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading…</div>
              ) : (
                <div className="text-center py-12 text-mw-ink-3 text-[13px]">Could not load badge data.</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <ProfileContent />
      </MwAuthGuard>
    </>
  )
}
