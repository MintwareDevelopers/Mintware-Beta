'use client'

// =============================================================================
// /vault/create — Team onboarding 4-step vault creation flow. Design v2.
//
// Step 1: Project details (name, token address, chain)
// Step 2: Pool configuration (fee tier, tick spacing, seed amount)
// Step 3: Lock tier defaults + fee split preview
// Step 4: Review + register the vault against the live MintwareDeFiPairVault (DB record)
// =============================================================================

import { useAccount, useSignMessage } from 'wagmi'
import { useState, useEffect } from 'react'
import Link           from 'next/link'
import { MwNav }       from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD }      from '@/lib/web2/api'
import { createPublicClient, http, erc20Abi, isAddress, type Chain } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { buildVaultCreateMessage } from '@/lib/web3/signedActionMessages'

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

// Resolve an ERC-20 symbol directly (bypasses the wagmi config, which omits
// Base Sepolia) so the auto-generated vault name resolves on both offered chains.
const CHAIN_FOR: Record<number, Chain> = { 8453: base, 84532: baseSepolia }

async function readTokenSymbol(address: string, chainId: number): Promise<string | null> {
  const chain = CHAIN_FOR[chainId]
  if (!chain || !isAddress(address)) return null
  try {
    const client = createPublicClient({ chain, transport: http() })
    const sym = await client.readContract({ address, abi: erc20Abi, functionName: 'symbol' })
    return typeof sym === 'string' && sym.length > 0 ? sym : null
  } catch {
    return null
  }
}

const FEE_SPLIT = [
  { label: 'LPs (community)',   pct: 70, bar: 'bg-peri',      txt: 'text-peri-deep' },
  { label: 'Referrers',         pct: 15, bar: 'bg-coral2',    txt: 'text-coral2-deep' },
  { label: 'Protocol treasury', pct: 10, bar: 'bg-ink-soft',  txt: 'text-ink-soft' },
  { label: 'Attribution bonus', pct: 5,  bar: 'bg-[#D14343]', txt: 'text-[#D14343]' },
]

// ─── shared input / label classes ─────────────────────────────────────────────
const INPUT = 'w-full px-3 py-2.5 rounded-xl border border-hair bg-white font-mono text-[14px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)] box-border placeholder:text-ink-soft'
const LABEL = 'block mb-1.5 uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft'
const HINT  = 'block mt-1 text-[11px] text-ink-soft'

// ─── step indicator ───────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-[7px] rounded-full transition-all duration-200 ${
            i === current ? 'w-5 bg-peri' : i < current ? 'w-[7px] bg-peri-deep' : 'w-[7px] bg-hair'
          }`}
        />
      ))}
    </div>
  )
}

// ─── step 1: project details ──────────────────────────────────────────────────
function Step1({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  const addr = draft.tokenAddress.trim()
  const validAddr = isAddress(addr)
  const [symbol, setSymbol] = useState<string | null>(null)
  const [symStatus, setSymStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  // Resolve the token symbol on-chain — teams never name their own pools. The name
  // is derived from the pair so it can never misrepresent what's actually seeded.
  useEffect(() => {
    if (!validAddr) { setSymbol(null); setSymStatus('idle'); return }
    let cancelled = false
    setSymStatus('loading')
    readTokenSymbol(addr, draft.chainId).then(sym => {
      if (cancelled) return
      setSymbol(sym)
      setSymStatus(sym ? 'ok' : 'error')
    })
    return () => { cancelled = true }
  }, [addr, draft.chainId, validAddr])

  const derivedName = symbol ? `${symbol}/USDC Vault` : ''

  // Keep the draft name in lockstep with the derived name (never user input).
  useEffect(() => {
    if (draft.name !== derivedName) onChange({ name: derivedName })
  }, [derivedName]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameDisplay = !validAddr
    ? 'Enter a token address above'
    : symStatus === 'loading' ? 'Reading token…'
    : symStatus === 'error'   ? 'Couldn’t read this token’s symbol'
    : derivedName || '—'

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <label className={LABEL}>Project token address</label>
        <input
          className={`${INPUT} text-[13px]`}
          placeholder="0x…"
          value={draft.tokenAddress}
          onChange={e => onChange({ tokenAddress: e.target.value })}
        />
        <span className={HINT}>
          The ERC-20 token your team will seed into the pool. It’s paired with USDC.
        </span>
      </div>
      <div>
        <label className={LABEL}>Vault name</label>
        <div
          className={`${INPUT} flex items-center justify-between ${symStatus === 'ok' ? 'text-ink' : 'text-ink-soft'}`}
          aria-readonly="true"
        >
          <span>{nameDisplay}</span>
          <span className="text-[9px] uppercase tracking-[0.12em] font-semibold text-ink-soft rounded-full border border-hair px-1.5 py-0.5 shrink-0 ml-2">Auto</span>
        </div>
        <span className={HINT}>
          Generated from the pair as <b>{'{TOKEN}'}/USDC Vault</b> — so the name always matches the pool. Not editable.
        </span>
      </div>
      <div>
        <label className={LABEL}>Chain</label>
        <div className="flex gap-2">
          {CHAINS.map(c => (
            <button
              key={c.id}
              onClick={() => onChange({ chainId: c.id })}
              className={`px-5 py-2 rounded-full text-[13px] font-semibold border ${
                draft.chainId === c.id ? 'border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.08)] text-peri-deep' : 'border-hair bg-white text-ink-mid'
              }`}
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
    <div className="flex flex-col gap-[18px]">
      <div>
        <label className={LABEL}>Fee tier</label>
        <div className="flex flex-col gap-2">
          {FEE_TIERS.map(f => (
            <button
              key={f.bps}
              onClick={() => onChange({ feeTier: f.bps, tickSpacing: f.spacing })}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left ${
                draft.feeTier === f.bps ? 'border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.06)]' : 'border-hair bg-white'
              }`}
            >
              <div>
                <span className={`text-[15px] font-semibold font-atx-display ${draft.feeTier === f.bps ? 'text-peri-deep' : 'text-ink'}`}>
                  {f.label}
                </span>
                <span className="text-[12px] text-ink-mid ml-2.5">
                  {f.desc}
                </span>
              </div>
              <span className="text-[11px] text-ink-soft font-mono">
                tick ±{f.spacing}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={LABEL}>Seed amount (USDC value of tokens)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-soft font-mono">$</span>
          <input
            type="number"
            className={`${INPUT} pl-6`}
            placeholder="100000"
            value={draft.seedAmount || ''}
            onChange={e => onChange({ seedAmount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <span className={HINT}>
          Minimum recommended: $50,000 to establish meaningful liquidity depth.
        </span>
      </div>
    </div>
  )
}

// ─── step 3: defaults + fee preview ──────────────────────────────────────────
function Step3({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className={LABEL}>Suggested lock tier for LPs</label>
        <span className="block mb-2.5 text-[12px] text-ink-soft">
          LPs can always choose any tier — this is the pre-selected default shown on your vault page.
        </span>
        <div className="flex flex-col gap-2">
          {LOCK_DEFAULTS.map(l => (
            <button
              key={l.value}
              onClick={() => onChange({ defaultTier: l.value })}
              className={`flex items-center gap-3 px-4 py-3 text-left rounded-xl border ${
                draft.defaultTier === l.value ? 'border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.06)]' : 'border-hair bg-white'
              }`}
            >
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${draft.defaultTier === l.value ? 'bg-peri' : 'bg-hair'}`} />
              <div>
                <div className="text-[13px] font-semibold text-ink font-atx-display">{l.label}</div>
                <div className="text-[11px] text-ink-mid">{l.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Fee split preview */}
      <div className="soft-card p-4">
        <div className="mb-3 uppercase tracking-[0.1em] text-[11px] font-semibold text-ink-soft">
          Fee split (fixed by protocol)
        </div>
        {FEE_SPLIT.map(({ label, pct, bar, txt }) => (
          <div key={label} className="mb-2.5">
            <div className="flex justify-between mb-1">
              <span className="text-[12px] text-ink-mid">{label}</span>
              <span className={`text-[13px] font-semibold tabular-nums ${txt}`}>{pct}%</span>
            </div>
            <div className="h-[8px] rounded-full bg-ground-cool overflow-hidden relative">
              <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── step 4: review + deploy ──────────────────────────────────────────────────
function Step4({
  draft, submitting, submitLabel, error, onDeploy,
}: {
  draft:      VaultDraft
  submitting: boolean
  submitLabel: string
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
    <div className="flex flex-col gap-4">
      <div className="soft-card overflow-hidden">
        {rows.map(({ label, value, mono }, i) => (
          <div
            key={label}
            className={`flex justify-between items-center px-4 py-[11px] ${i < rows.length - 1 ? 'border-b border-hair-soft' : ''}`}
          >
            <span className="text-[12px] text-ink-mid">{label}</span>
            <span className={`text-[13px] font-semibold text-ink ${mono ? 'font-mono' : 'font-atx-display'}`}>{value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white border border-hair px-3.5 py-2.5 text-[12px] text-ink-mid leading-[1.5]" style={{ borderLeft: '3px solid var(--color-peri)' }}>
        <span>This registers your vault against the live Mintware pair vault. On-chain pool creation and initial liquidity are handled by the Mintware provider.</span>
      </div>

      <div className="soft-card px-3.5 py-2.5">
        <div className="mb-1.5 uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft">
          What will happen
        </div>
        <div className="flex flex-col gap-1 text-[12px] text-ink-mid leading-[1.55]">
          <div>1. Your wallet signs a message authorizing the vault record — no funds move.</div>
          <div>2. Mintware creates the vault entry pointing at the deployed pair contract.</div>
          <div>3. It appears in the vault list, ready for dual-token LP deposits.</div>
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-[#D14343] rounded-xl bg-[rgba(209,67,67,0.05)] border border-[rgba(209,67,67,0.3)] px-3.5 py-2.5">
          {error}
        </div>
      )}

      <button
        onClick={onDeploy}
        disabled={submitting}
        className="glass-pill w-full justify-center !py-[13px] text-[15px] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? submitLabel : 'Deploy vault →'}
      </button>

      {submitting && (
        <div className="text-[11px] text-ink-mid rounded-xl bg-ground-cool border border-hair px-3 py-2 leading-[1.5]">
          If your wallet does not appear right away, open your wallet app or extension and look for a pending request.
        </div>
      )}
    </div>
  )
}

// ─── DeFi create flow (the original 4-step wizard) ────────────────────────────
function DefiCreateFlow({ onBack }: { onBack: () => void }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [step, setStep]         = useState(0)
  const [error, setError]       = useState('')
  const [deployed, setDeployed] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  // Create the vault DB record pointing at the LIVE pair vault. On-chain pool creation +
  // seeding is a provider/owner operation (the pair vault has no self-serve seed entrypoint),
  // so the self-serve flow records the vault against the deployed pair contract for listing.
  async function handleDeploy() {
    if (!address) return
    setError('')
    setSubmitting(true)
    try {
      const issuedAt = Date.now()
      const poolKey = {
        currency0:   draft.tokenAddress.toLowerCase(),
        currency1:   (process.env.NEXT_PUBLIC_VAULT_TOKEN1_ADDRESS ?? '0x4200000000000000000000000000000000000006').toLowerCase(),
        fee:         draft.feeTier,
        tickSpacing: draft.tickSpacing,
        hooks:       process.env.NEXT_PUBLIC_MW_SOCIAL_HOOK_ADDRESS ?? '',
      }
      const authMessage = buildVaultCreateMessage({
        teamWallet: address,
        issuedAt,
        name: draft.name,
        projectToken: draft.tokenAddress,
        seedAmount: draft.seedAmount,
        chainId: draft.chainId,
        poolKey,
      })
      const authSignature = await signMessageAsync({ message: authMessage })

      // Create vault record in DB to get the UUID.
      const res = await fetch('/api/vaults/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          draft.name,
          team_wallet:   address,
          project_token: draft.tokenAddress,
          seed_amount:   draft.seedAmount,
          chain_id:      draft.chainId,
          pool_key: poolKey,
          contract_address: process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? null,
          status: 'seeding',
          issuedAt,
          authMessage,
          authSignature,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const { id: vaultId } = await res.json()
      setDeployed(vaultId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deploy failed')
    } finally {
      setSubmitting(false)
    }
  }

  const STEPS = ['Project', 'Pool', 'Defaults', 'Review']

  if (deployed) return (
    <div className="bg-white min-h-screen font-atx-display text-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto my-20 px-7 text-center">
        <div className="flex justify-center mb-4">
          <span className="w-12 h-12 rounded-2xl grid place-items-center text-white text-[22px]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 6px 18px rgba(108,108,240,0.35)' }}>✴</span>
        </div>
        <div className="text-[22px] font-medium text-ink font-atx-display mb-2 tracking-[-0.02em]">
          Vault created
        </div>
        <div className="text-[14px] text-ink-mid mb-7 leading-[1.6]">
          <strong className="text-ink">{draft.name}</strong> is registered against the live Mintware pair vault and now appears in the vault list for dual-token LP deposits.
        </div>
        <div className="flex gap-2.5 justify-center">
          <Link href="/app/vaults" className="glass-pill">View all vaults</Link>
          {deployed !== 'new' && (
            <Link href={`/app/vault/${deployed}`} className="glass-pill">View vault →</Link>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="bg-white min-h-screen font-atx-display text-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4 max-[640px]:pt-5">

        {/* Breadcrumb */}
        <div className="mb-5 flex items-center gap-2">
          <button onClick={onBack} className="text-[13px] text-ink-mid no-underline hover:text-ink bg-transparent border-0 cursor-pointer p-0">
            ← Change surface
          </button>
          <span className="text-ink-soft">/</span>
          <span className="text-[13px] text-ink font-semibold">Create DeFi vault</span>
        </div>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-[22px] font-medium text-ink font-atx-display m-0 tracking-[-0.02em]">
              {STEPS[step]}
            </h1>
            <StepDots current={step} total={STEPS.length} />
          </div>
          <div className="text-[13px] text-ink-mid">
            {step === 0 && 'Tell us about your project and the token you\'re seeding.'}
            {step === 1 && 'Configure the V4 pool parameters for your vault.'}
            {step === 2 && 'Set LP defaults and review the fee distribution.'}
            {step === 3 && 'Review everything before deploying on-chain.'}
          </div>
        </div>

        {/* Step card */}
        <div className="soft-card p-7">
          {step === 0 && <Step1 draft={draft} onChange={patch} />}
          {step === 1 && <Step2 draft={draft} onChange={patch} />}
          {step === 2 && <Step3 draft={draft} onChange={patch} />}
          {step === 3 && <Step4 draft={draft} submitting={submitting} submitLabel="Creating vault…" error={error} onDeploy={handleDeploy} />}

          {/* Nav buttons (hidden on step 3 which has its own deploy button) */}
          {step < 3 && (
            <div className="flex items-center justify-between mt-6">
              <button
                className="glass-pill glass-pill-sm"
                onClick={() => step > 0 ? setStep(s => s - 1) : undefined}
                style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
              >
                Back
              </button>
              <button
                className="glass-pill glass-pill-sm disabled:opacity-45 disabled:cursor-not-allowed"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
              >
                {step === 2 ? 'Review →' : 'Continue →'}
              </button>
            </div>
          )}
          {step === 3 && (
            <button
              className="mt-2.5 w-full glass-pill glass-pill-sm justify-center"
              onClick={() => setStep(2)}
            >
              ← Back to edit
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── single-surface (DeFi) — the RWA surface was shelved ────────────────────────
function CreateVaultContentInner() {
  return <DefiCreateFlow onBack={() => { window.location.href = '/app/vaults' }} />
}

function CreateVaultContent() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="bg-white min-h-screen font-atx-display text-ink">
        <MwNav />
        <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px]">
          <div className="soft-card p-7">
            <div className="text-[13px] text-ink-mid">
              Loading vault creator…
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <CreateVaultContentInner />
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default function CreateVaultPage() {
  return (
    <MwAuthGuard>
      <CreateVaultContent />
    </MwAuthGuard>
  )
}
