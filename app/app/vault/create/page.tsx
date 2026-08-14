'use client'

// =============================================================================
// /vault/create — Team onboarding for a YPN treasury vault. Design v2.
//
// Standard model (see docs/developers/ypn-architecture.md §8):
//   • The team's TOKEN is the junior, loss-absorbing leg — locked ≥90 days.
//   • ALL USDC — the community's and the team's — is SENIOR and equal: protected,
//     spendable, earning, pari passu. The stable side is fungible; there is no
//     "junior USDC" in the pool. Team USDC as senior is the standard.
//   • OPTIONAL: a team may subordinate its OWN USDC below the community's as extra
//     first-loss armor (off by default).
//
// Step 1: Project token (the volatile junior leg)
// Step 2: Pool configuration (fee tier)
// Step 3: Structure & commit — junior token + lock, senior USDC (standard), optional subordination
// Step 4: Review + register (signed record; on-chain provisioning by the Mintware provider)
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
  // Step 3 — the tranche
  commitAmount:    number   // USDC value of the team's junior token committed at launch (the cushion)
  lockDays:        number   // junior hard cliff (>= 90)
  teamUsdc:        number   // OPTIONAL senior USDC the team also seeds (equal, standard)
  subordinateUsdc: boolean  // OPTIONAL: subordinate that USDC below the community's (first-loss armor)
}

const FEE_TIERS = [
  { bps: 500,   label: '0.05%', desc: 'Stable pairs',    spacing: 10  },
  { bps: 3000,  label: '0.30%', desc: 'Most pairs',      spacing: 60  },
  { bps: 10000, label: '1.00%', desc: 'Exotic / low-liq', spacing: 200 },
]

// Junior lock presets — the contract floor is 90 days (MIN_LOCK_DURATION).
const LOCK_OPTIONS = [
  { days: 90,  label: 'Standard', desc: '90-day cliff — the minimum' },
  { days: 180, label: 'Deeper',   desc: '180-day cliff — stronger signal' },
  { days: 365, label: 'Core',     desc: '365-day cliff — maximum alignment' },
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

// ─── the tranche explainer — the standard model, shown as the structure ─────────
function TrancheDiagram({ subordinated }: { subordinated: boolean }) {
  return (
    <div className="soft-card p-4">
      <div className="mb-3 uppercase tracking-[0.1em] text-[11px] font-semibold text-ink-soft">
        How the vault is structured
      </div>

      {/* Senior — all USDC, equal */}
      <div className="rounded-xl border border-[rgba(108,108,240,0.28)] bg-[rgba(108,108,240,0.06)] px-3.5 py-3 mb-2">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[13px] font-semibold text-peri-deep font-atx-display">Senior — all USDC</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-peri-deep rounded-full border border-[rgba(108,108,240,0.3)] px-1.5 py-0.5">Protected</span>
        </div>
        <div className="text-[12px] text-ink-mid leading-[1.5]">
          The community's USDC{subordinated ? '' : ' and yours'} — one equal claim. Spendable, earning, par.
          The pool's stable side is fungible; there is no “whose dollar.”
        </div>
      </div>

      {/* Optional: team USDC subordinated (only when toggled) */}
      {subordinated && (
        <div className="rounded-xl border border-[rgba(244,161,131,0.5)] bg-[rgba(244,161,131,0.08)] px-3.5 py-3 mb-2">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[13px] font-semibold text-coral2-deep font-atx-display">Your USDC — subordinated</span>
            <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-coral2-deep rounded-full border border-[rgba(244,161,131,0.5)] px-1.5 py-0.5">First-loss</span>
          </div>
          <div className="text-[12px] text-ink-mid leading-[1.5]">
            Optional armor: your dollars absorb losses <b>before</b> the community's.
          </div>
        </div>
      )}

      {/* Junior — team token */}
      <div className="rounded-xl border border-hair bg-white px-3.5 py-3">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[13px] font-semibold text-ink font-atx-display">Junior — your token</span>
          <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft rounded-full border border-hair px-1.5 py-0.5">Locked</span>
        </div>
        <div className="text-[12px] text-ink-mid leading-[1.5]">
          The volatile leg — first-loss cushion, locked ≥90 days. It absorbs the swings / impermanent
          loss so the senior stays whole.
        </div>
      </div>
    </div>
  )
}

// ─── step 1: project token ─────────────────────────────────────────────────────
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
          Your token — the <b>volatile junior leg</b> that absorbs the risk. It pairs with USDC, and the
          community deposits USDC as senior.
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
        <span className={HINT}>The V4 pool your token trades against USDC in.</span>
      </div>
    </div>
  )
}

// ─── step 3: tranche structure + the team's commit ─────────────────────────────
function Step3({ draft, onChange }: { draft: VaultDraft; onChange: (d: Partial<VaultDraft>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <TrancheDiagram subordinated={draft.subordinateUsdc} />

      {/* Junior commit — the team's token cushion */}
      <div>
        <label className={LABEL}>Your junior commit (USDC value of token)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-soft font-mono">$</span>
          <input
            type="number"
            className={`${INPUT} pl-6`}
            placeholder="100000"
            value={draft.commitAmount || ''}
            onChange={e => onChange({ commitAmount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <span className={HINT}>
          The first-loss cushion. Bigger cushion → safely deeper LP. Minimum recommended: $50,000.
        </span>
      </div>

      {/* Lock */}
      <div>
        <label className={LABEL}>Junior lock</label>
        <div className="flex flex-col gap-2">
          {LOCK_OPTIONS.map(l => (
            <button
              key={l.days}
              onClick={() => onChange({ lockDays: l.days })}
              className={`flex items-center gap-3 px-4 py-3 text-left rounded-xl border ${
                draft.lockDays === l.days ? 'border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.06)]' : 'border-hair bg-white'
              }`}
            >
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${draft.lockDays === l.days ? 'bg-peri' : 'bg-hair'}`} />
              <div>
                <div className="text-[13px] font-semibold text-ink font-atx-display">{l.label}</div>
                <div className="text-[11px] text-ink-mid">{l.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Optional senior USDC from the team */}
      <div>
        <label className={LABEL}>Your USDC (optional, senior — equal to the community)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-soft font-mono">$</span>
          <input
            type="number"
            className={`${INPUT} pl-6`}
            placeholder="0"
            value={draft.teamUsdc || ''}
            onChange={e => onChange({ teamUsdc: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <span className={HINT}>
          Standard: your USDC is senior — protected and equal, just like the community's. Leave 0 if none.
        </span>
      </div>

      {/* Optional subordination toggle (#227) */}
      <button
        onClick={() => onChange({ subordinateUsdc: !draft.subordinateUsdc })}
        className={`flex items-start gap-3 px-4 py-3 text-left rounded-xl border ${
          draft.subordinateUsdc ? 'border-[rgba(244,161,131,0.55)] bg-[rgba(244,161,131,0.07)]' : 'border-hair bg-white'
        } ${draft.teamUsdc > 0 ? '' : 'opacity-55 cursor-not-allowed'}`}
        disabled={draft.teamUsdc <= 0}
      >
        <div className={`mt-0.5 w-9 h-5 rounded-full shrink-0 relative transition-colors ${draft.subordinateUsdc ? 'bg-coral2' : 'bg-hair'}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${draft.subordinateUsdc ? 'left-[18px]' : 'left-0.5'}`} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink font-atx-display">Subordinate my USDC as first-loss armor</div>
          <div className="text-[11px] text-ink-mid leading-[1.5] mt-0.5">
            Optional. Your USDC takes losses <b>before</b> the community's — extra protection on top of the
            token cushion. Off by default; needs a USDC amount above.
          </div>
        </div>
      </button>
    </div>
  )
}

// ─── step 4: review + register ─────────────────────────────────────────────────
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
    { label: 'Junior commit', value: draft.commitAmount > 0 ? fmtUSD(draft.commitAmount) : '—' },
    { label: 'Junior lock',   value: `${draft.lockDays} days` },
    { label: 'Your USDC',     value: draft.teamUsdc > 0 ? `${fmtUSD(draft.teamUsdc)} · ${draft.subordinateUsdc ? 'subordinated (first-loss)' : 'senior (equal)'}` : 'None' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TrancheDiagram subordinated={draft.subordinateUsdc} />

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
        <span>This registers your vault. The junior commit, lock, and any USDC subordination are provisioned on-chain at launch by the Mintware provider from these choices — no funds move now.</span>
      </div>

      <div className="soft-card px-3.5 py-2.5">
        <div className="mb-1.5 uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft">
          What will happen
        </div>
        <div className="flex flex-col gap-1 text-[12px] text-ink-mid leading-[1.55]">
          <div>1. Your wallet signs a message authorizing the vault record — no funds move.</div>
          <div>2. Mintware provisions the treasury vault + pool and commits your junior at launch.</div>
          <div>3. It appears in the vault list, open for community USDC deposits.</div>
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
        {submitting ? submitLabel : 'Create vault →'}
      </button>

      {submitting && (
        <div className="text-[11px] text-ink-mid rounded-xl bg-ground-cool border border-hair px-3 py-2 leading-[1.5]">
          If your wallet does not appear right away, open your wallet app or extension and look for a pending request.
        </div>
      )}
    </div>
  )
}

// ─── treasury-vault create flow (4-step wizard) ────────────────────────────────
function TreasuryCreateFlow({ onBack }: { onBack: () => void }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [step, setStep]         = useState(0)
  const [error, setError]       = useState('')
  const [deployed, setDeployed] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [draft, setDraft] = useState<VaultDraft>({
    name:            '',
    tokenAddress:    '',
    chainId:         84532,
    feeTier:         3000,
    tickSpacing:     60,
    commitAmount:    0,
    lockDays:        90,
    teamUsdc:        0,
    subordinateUsdc: false,
  })

  function patch(d: Partial<VaultDraft>) { setDraft(prev => ({ ...prev, ...d })) }

  function canAdvance() {
    if (step === 0) return draft.name.trim().length > 0 && draft.tokenAddress.startsWith('0x') && draft.tokenAddress.length === 42
    if (step === 1) return draft.feeTier > 0
    if (step === 2) return draft.commitAmount > 0 && draft.lockDays >= 90
    return true
  }

  // Register the treasury-vault record with a signed intent. On-chain provisioning (pool creation,
  // the team's junior commit + lock, any USDC subordination) is a provider/owner operation — the
  // vault has no self-serve commit entrypoint — so the self-serve flow records the team's choices.
  // The signed message keeps the original vault-create shape (backend unchanged); the tranche fields
  // are captured as launch intent.
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
      // The treasury-vault tranche choices — authenticated in the signed message + persisted as
      // launch intent the provisioning step reads (see lib/web3/vault/treasuryProvisioning.ts).
      const tranche = {
        juniorCommitUsdc: draft.commitAmount,
        lockDays:         draft.lockDays,
        teamUsdc:         draft.teamUsdc,
        subordinateUsdc:  draft.subordinateUsdc,
      }
      const authMessage = buildVaultCreateMessage({
        teamWallet: address,
        issuedAt,
        name: draft.name,
        projectToken: draft.tokenAddress,
        seedAmount: draft.commitAmount, // the junior commit is the vault's launch seed value
        chainId: draft.chainId,
        poolKey,
        tranche,
      })
      const authSignature = await signMessageAsync({ message: authMessage })

      const res = await fetch('/api/vaults/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          draft.name,
          team_wallet:   address,
          project_token: draft.tokenAddress,
          seed_amount:   draft.commitAmount,
          chain_id:      draft.chainId,
          pool_key: poolKey,
          contract_address: process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? null,
          status: 'seeding',
          issuedAt,
          authMessage,
          authSignature,
          tranche,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const { id: vaultId } = await res.json()
      setDeployed(vaultId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  const STEPS = ['Token', 'Pool', 'Structure', 'Review']

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
          <strong className="text-ink">{draft.name}</strong> is registered and now appears in the vault list, open for community USDC deposits once the provider provisions it on-chain.
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
            ← All vaults
          </button>
          <span className="text-ink-soft">/</span>
          <span className="text-[13px] text-ink font-semibold">Create vault</span>
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
            {step === 0 && 'Your token is the junior cushion — the volatile leg that absorbs the risk.'}
            {step === 1 && 'Configure the V4 pool your token trades against USDC in.'}
            {step === 2 && 'Commit your junior cushion. All USDC is senior and equal — subordinating yours is optional.'}
            {step === 3 && 'Review the tranche structure before registering.'}
          </div>
        </div>

        {/* Step card */}
        <div className="soft-card p-7">
          {step === 0 && <Step1 draft={draft} onChange={patch} />}
          {step === 1 && <Step2 draft={draft} onChange={patch} />}
          {step === 2 && <Step3 draft={draft} onChange={patch} />}
          {step === 3 && <Step4 draft={draft} submitting={submitting} submitLabel="Creating vault…" error={error} onDeploy={handleDeploy} />}

          {/* Nav buttons (hidden on step 3 which has its own register button) */}
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

// ─── mounted guard (avoids SSR/wallet hydration flash) ─────────────────────────
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

  return <TreasuryCreateFlow onBack={() => { window.location.href = '/app/vaults' }} />
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default function CreateVaultPage() {
  return (
    <MwAuthGuard>
      <CreateVaultContent />
    </MwAuthGuard>
  )
}
