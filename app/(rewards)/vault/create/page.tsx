'use client'

// =============================================================================
// /vault/create — Team onboarding 4-step vault creation flow
//
// Step 1: Project details (name, token address, chain)
// Step 2: Pool configuration (fee tier, tick spacing, seed amount)
// Step 3: Lock tier defaults + fee split preview
// Step 4: Review + deploy (calls SocialVault.seedTeamTokens — T3.5 wire)
// =============================================================================

import { useAccount } from 'wagmi'
import { useState, useEffect } from 'react'
import Link           from 'next/link'
import { MwNav }       from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD }      from '@/lib/web2/api'
import { useVaultSeed } from '@/lib/web3/vault/useSocialVault'

// ─── types ───────────────────────────────────────────────────────────────────
interface VaultDraft {
  // Step 1
  name:         string
  tokenAddress: string
  chainId:      number
  // Step 2
  feeTier:      number   // 500 | 3000 | 10000
  tickSpacing:  number
  seedAmount:   number   // USDC value of project tokens being seeded
  // Step 3
  defaultTier:  'flex' | 'committed' | 'aligned' | 'core'
}

const FEE_TIERS = [
  { bps: 500,   label: '0.05%', desc: 'Stable pairs',    spacing: 10  },
  { bps: 3000,  label: '0.30%', desc: 'Most pairs',      spacing: 60  },
  { bps: 10000, label: '1.00%', desc: 'Exotic / low-liq', spacing: 200 },
]

const LOCK_DEFAULTS = [
  { value: 'flex',      label: 'Flex',      desc: 'No lock — maximum accessibility' },
  { value: 'committed', label: 'Committed', desc: '30-day default — balanced' },
  { value: 'aligned',   label: 'Aligned',   desc: '90-day default — deeper liquidity' },
  { value: 'core',      label: 'Core',      desc: '180-day default — maximum TVL stability' },
] as const

const CHAINS = [
  { id: 8453,  label: 'Base' },
  { id: 84532, label: 'Base Sepolia' },
]

const FEE_SPLIT = [
  { label: 'LPs (community)',      pct: 70, color: 'var(--color-mw-brand)' },
  { label: 'Referrers',             pct: 15, color: 'var(--color-mw-pink)' },
  { label: 'Protocol treasury',    pct: 10, color: 'var(--color-mw-ink-3)' },
  { label: 'Attribution bonus',    pct: 5,  color: 'var(--color-mw-amber)' },
]

// ─── shared input style ───────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1.5px solid var(--color-mw-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 14,
  fontFamily: 'var(--font-jakarta)', color: 'var(--color-mw-ink)',
  background: 'white', outline: 'none', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--color-mw-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontFamily: 'var(--font-jakarta)', display: 'block', marginBottom: 6,
}

// ─── step indicator ───────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 20 : 7, height: 7,
            borderRadius: 99, transition: 'all 0.25s',
            background: i === current
              ? 'var(--color-mw-brand)'
              : i < current
              ? 'var(--color-mw-teal)'
              : 'var(--color-mw-border-strong)',
          }}
        />
      ))}
    </div>
  )
}

// ─── step 1: project details ──────────────────────────────────────────────────
function Step1({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <label style={labelStyle}>Vault name</label>
        <input
          style={inputStyle}
          placeholder="e.g. PROJ/USDC Vault"
          value={draft.name}
          onChange={e => onChange({ name: e.target.value })}
        />
        <span style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', marginTop: 4, display: 'block' }}>
          Displayed to LPs on the vault listing page.
        </span>
      </div>
      <div>
        <label style={labelStyle}>Project token address</label>
        <input
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
          placeholder="0x…"
          value={draft.tokenAddress}
          onChange={e => onChange({ tokenAddress: e.target.value })}
        />
        <span style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', marginTop: 4, display: 'block' }}>
          The ERC-20 token your team will seed into the pool.
        </span>
      </div>
      <div>
        <label style={labelStyle}>Chain</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {CHAINS.map(c => (
            <button
              key={c.id}
              onClick={() => onChange({ chainId: c.id })}
              style={{
                padding: '9px 20px', borderRadius: 'var(--radius-sm)', fontSize: 13,
                fontWeight: 600, fontFamily: 'var(--font-jakarta)', cursor: 'pointer',
                border: `1.5px solid ${draft.chainId === c.id ? 'var(--color-mw-brand)' : 'var(--color-mw-border)'}`,
                background: draft.chainId === c.id ? 'var(--color-mw-brand-dim)' : 'white',
                color: draft.chainId === c.id ? 'var(--color-mw-brand)' : 'var(--color-mw-ink-3)',
                transition: 'all 0.15s',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── step 2: pool config ──────────────────────────────────────────────────────
function Step2({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <label style={labelStyle}>Fee tier</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEE_TIERS.map(f => (
            <button
              key={f.bps}
              onClick={() => onChange({ feeTier: f.bps, tickSpacing: f.spacing })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                border: `1.5px solid ${draft.feeTier === f.bps ? 'var(--color-mw-brand)' : 'var(--color-mw-border)'}`,
                background: draft.feeTier === f.bps ? 'var(--color-mw-brand-dim)' : 'white',
                transition: 'all 0.15s', textAlign: 'left',
              }}
            >
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: draft.feeTier === f.bps ? 'var(--color-mw-brand)' : 'var(--color-mw-ink)' }}>
                  {f.label}
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', marginLeft: 10 }}>
                  {f.desc}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-mono)' }}>
                tick ±{f.spacing}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={labelStyle}>Seed amount (USDC value of tokens)</label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-mono)' }}>$</span>
          <input
            type="number"
            style={{ ...inputStyle, paddingLeft: 24 }}
            placeholder="100000"
            value={draft.seedAmount || ''}
            onChange={e => onChange({ seedAmount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', marginTop: 4, display: 'block' }}>
          Minimum recommended: $50,000 to establish meaningful liquidity depth.
        </span>
      </div>
    </div>
  )
}

// ─── step 3: defaults + fee preview ──────────────────────────────────────────
function Step3({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Suggested lock tier for LPs</label>
        <span style={{ fontSize: 12, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', display: 'block', marginBottom: 10 }}>
          LPs can always choose any tier — this is the pre-selected default shown on your vault page.
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LOCK_DEFAULTS.map(l => (
            <button
              key={l.value}
              onClick={() => onChange({ defaultTier: l.value })}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${draft.defaultTier === l.value ? 'var(--color-mw-teal)' : 'var(--color-mw-border)'}`,
                background: draft.defaultTier === l.value ? 'rgba(42,158,138,0.05)' : 'white',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: draft.defaultTier === l.value ? 'var(--color-mw-teal)' : 'var(--color-mw-border-strong)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)' }}>{l.label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>{l.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Fee split preview */}
      <div style={{ background: 'var(--color-mw-surface-card)', border: '1px solid var(--color-mw-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-mw-ink-2)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-jakarta)', marginBottom: 12 }}>
          Fee split (fixed by protocol)
        </div>
        {FEE_SPLIT.map(({ label, pct, color }) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{pct}%</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--color-mw-border)' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── step 4: review + deploy ──────────────────────────────────────────────────
function Step4({
  draft, submitting, error, onDeploy,
}: {
  draft:      VaultDraft
  submitting: boolean
  error:      string
  onDeploy:   () => void
}) {
  const feeTier = FEE_TIERS.find(f => f.bps === draft.feeTier)
  const chain   = CHAINS.find(c => c.id === draft.chainId)

  const rows = [
    { label: 'Vault name',    value: draft.name || '—' },
    { label: 'Token address', value: draft.tokenAddress ? `${draft.tokenAddress.slice(0, 10)}…${draft.tokenAddress.slice(-6)}` : '—', mono: true },
    { label: 'Chain',         value: chain?.label ?? '—' },
    { label: 'Fee tier',      value: feeTier?.label ?? '—' },
    { label: 'Tick spacing',  value: `±${draft.tickSpacing}` },
    { label: 'Seed amount',   value: draft.seedAmount > 0 ? fmtUSD(draft.seedAmount) : '—' },
    { label: 'Default tier',  value: draft.defaultTier.charAt(0).toUpperCase() + draft.defaultTier.slice(1) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--color-mw-surface-card)', border: '1px solid var(--color-mw-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {rows.map(({ label, value, mono }, i) => (
          <div
            key={label}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '11px 16px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--color-mw-border)' : 'none',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-jakarta)', color: 'var(--color-mw-ink)' }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(193,119,0,0.06)', border: '1px solid rgba(193,119,0,0.18)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: 'var(--color-mw-amber)', fontFamily: 'var(--font-jakarta)', lineHeight: 1.5 }}>
        ⚠ This will call <code style={{ fontFamily: 'var(--font-mono)' }}>SocialVault.seedTeamTokens()</code> on-chain. Make sure your wallet has sufficient project tokens approved for transfer.
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--color-mw-red)', background: 'rgba(239,68,68,0.06)', borderRadius: 6, padding: '10px 14px', fontFamily: 'var(--font-jakarta)' }}>
          {error}
        </div>
      )}

      <button
        onClick={onDeploy}
        disabled={submitting}
        style={{
          padding: '13px', borderRadius: 'var(--radius-sm)',
          background: 'var(--color-mw-brand)', color: 'white',
          fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-jakarta)',
          border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.6 : 1, transition: 'opacity 0.15s',
        }}
      >
        {submitting
          ? 'Check wallet for approval…'
          : 'Deploy vault →'}
      </button>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────
function CreateVaultContent() {
  const { address } = useAccount()

  const [step, setStep]         = useState(0)
  const [error, setError]       = useState('')
  const [deployed, setDeployed] = useState<string | null>(null)
  const vaultSeed = useVaultSeed()

  const [draft, setDraft] = useState<VaultDraft>({
    name:         '',
    tokenAddress: '',
    chainId:      84532,
    feeTier:      3000,
    tickSpacing:  60,
    seedAmount:   0,
    defaultTier:  'committed',
  })

  function patch(d: Partial<VaultDraft>) { setDraft(prev => ({ ...prev, ...d })) }

  function canAdvance() {
    if (step === 0) return draft.name.trim().length > 0 && draft.tokenAddress.startsWith('0x') && draft.tokenAddress.length === 42
    if (step === 1) return draft.feeTier > 0 && draft.seedAmount > 0
    return true
  }

  // Step 1: create DB record → get vault ID → seed on-chain
  async function handleDeploy() {
    if (!address) return
    setError('')
    try {
      // 1a. Create vault record in DB to get the UUID
      const res = await fetch('/api/vaults/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          draft.name,
          team_wallet:   address,
          project_token: draft.tokenAddress,
          seed_amount:   draft.seedAmount,
          chain_id:      draft.chainId,
          pool_key: {
            currency0:   draft.tokenAddress.toLowerCase(),
            currency1:   '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC Base Sepolia
            fee:         draft.feeTier,
            tickSpacing: draft.tickSpacing,
            hooks:       process.env.NEXT_PUBLIC_MW_SOCIAL_HOOK_ADDRESS ?? '',
          },
          contract_address: process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? null,
          status: 'seeding',
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const { id: vaultId } = await res.json()

      // 1b. Seed on-chain — approve token + seedTeamTokens()
      // sqrtPriceX96 = 1:1 price (token ≈ USDC) = 2^96 ≈ 79228162514264337593543950336
      const sqrtPriceX96 = BigInt('79228162514264337593543950336')
      // Seed amount: convert USDC dollar value → 6-decimal token units (approx 1:1)
      const amountTokens = BigInt(Math.round(draft.seedAmount * 1e6))

      await vaultSeed.seed({
        vaultDbId:    vaultId,
        projectToken: draft.tokenAddress as `0x${string}`,
        amountTokens,
        poolKey: {
          currency0:   draft.tokenAddress.toLowerCase() as `0x${string}`,
          currency1:   '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as `0x${string}`,
          fee:         draft.feeTier,
          tickSpacing: draft.tickSpacing,
          hooks:       (process.env.NEXT_PUBLIC_MW_SOCIAL_HOOK_ADDRESS ?? '') as `0x${string}`,
        },
        sqrtPriceX96,
      })
      // Success picked up by useEffect below
      setDeployed(vaultId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deploy failed')
    }
  }

  // Propagate vault seed hook errors
  useEffect(() => {
    if (vaultSeed.error) setError(vaultSeed.error)
  }, [vaultSeed.error])

  const STEPS = ['Project', 'Pool', 'Defaults', 'Review']

  if (deployed) return (
    <>
      <style>{`.vc-page{background:var(--color-mw-surface);min-height:100vh;}`}</style>
      <div className="vc-page">
        <MwNav />
        <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⬡</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', marginBottom: 8 }}>
            Vault created
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', marginBottom: 28, lineHeight: 1.6 }}>
            <strong>{draft.name}</strong> is now in seeding state. Call <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>seedTeamTokens()</code> on-chain to activate LP deposits.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link href="/vaults" style={{ padding: '10px 20px', background: 'var(--color-mw-brand)', color: 'white', borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-jakarta)', textDecoration: 'none' }}>
              View all vaults
            </Link>
            {deployed !== 'new' && (
              <Link href={`/vault/${deployed}`} style={{ padding: '10px 20px', border: '1.5px solid var(--color-mw-border)', color: 'var(--color-mw-ink)', borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-jakarta)', textDecoration: 'none' }}>
                View vault →
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <style>{`
        .vc-page { background: var(--color-mw-surface); min-height: 100vh; }
        .vc-inner { max-width: 560px; margin: 0 auto; padding: 28px 28px 60px; }
        @media(max-width:640px){ .vc-inner{padding:20px 16px 48px;} }
        .vc-card { background: white; border: 1px solid var(--color-mw-border); border-radius: var(--radius-md); padding: 28px; }
        .vc-nav { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
        .vc-btn { padding: 10px 22px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 600; font-family: var(--font-jakarta); cursor: pointer; transition: opacity 0.15s; border: none; }
        .vc-btn-primary { background: var(--color-mw-brand); color: white; }
        .vc-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .vc-btn-ghost { background: none; border: 1.5px solid var(--color-mw-border); color: var(--color-mw-ink-3); }
        .vc-btn-ghost:hover { border-color: var(--color-mw-border-strong); }
      `}</style>

      <div className="vc-page">
        <MwNav />
        <div className="vc-inner">

          {/* Breadcrumb */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/vaults" style={{ fontSize: 13, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', textDecoration: 'none' }}>
              ← Vaults
            </Link>
            <span style={{ color: 'var(--color-mw-border-strong)' }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', fontWeight: 600 }}>Create vault</span>
          </div>

          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', margin: 0 }}>
                {STEPS[step]}
              </h1>
              <StepDots current={step} total={STEPS.length} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>
              {step === 0 && 'Tell us about your project and the token you\'re seeding.'}
              {step === 1 && 'Configure the V4 pool parameters for your vault.'}
              {step === 2 && 'Set LP defaults and review the fee distribution.'}
              {step === 3 && 'Review everything before deploying on-chain.'}
            </div>
          </div>

          {/* Step card */}
          <div className="vc-card">
            {step === 0 && <Step1 draft={draft} onChange={patch} />}
            {step === 1 && <Step2 draft={draft} onChange={patch} />}
            {step === 2 && <Step3 draft={draft} onChange={patch} />}
            {step === 3 && <Step4 draft={draft} submitting={vaultSeed.isPending} error={error} onDeploy={handleDeploy} />}

            {/* Nav buttons (hidden on step 3 which has its own deploy button) */}
            {step < 3 && (
              <div className="vc-nav">
                <button
                  className="vc-btn vc-btn-ghost"
                  onClick={() => step > 0 ? setStep(s => s - 1) : undefined}
                  style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
                >
                  Back
                </button>
                <button
                  className="vc-btn vc-btn-primary"
                  onClick={() => setStep(s => s + 1)}
                  disabled={!canAdvance()}
                >
                  {step === 2 ? 'Review →' : 'Continue →'}
                </button>
              </div>
            )}
            {step === 3 && (
              <button
                className="vc-btn vc-btn-ghost"
                onClick={() => setStep(2)}
                style={{ marginTop: 10, width: '100%' }}
              >
                ← Back to edit
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default function CreateVaultPage() {
  return (
    <MwAuthGuard>
      <CreateVaultContent />
    </MwAuthGuard>
  )
}
