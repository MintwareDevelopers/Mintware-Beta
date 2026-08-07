'use client'

// =============================================================================
// /vault/create — Team onboarding 4-step vault creation flow
//
// Step 1: Project details (name, token address, chain)
// Step 2: Pool configuration (fee tier, tick spacing, seed amount)
// Step 3: Lock tier defaults + fee split preview
// Step 4: Review + deploy (calls SocialVault.seedTeamTokens — T3.5 wire)
// =============================================================================

import { useAccount, useSignMessage } from 'wagmi'
import { useState, useEffect } from 'react'
import Link           from 'next/link'
import { MwNav }       from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD }      from '@/lib/web2/api'
import { createPublicClient, http, erc20Abi, isAddress, type Chain } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { useVaultSeed } from '@/lib/web3/vault/useSocialVault'
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

// Resolve an ERC-20 symbol directly (bypasses the RainbowKit config, which omits
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
  { label: 'LPs (community)',   pct: 70, bar: 'bg-atx-blue',  txt: 'text-atx-blue' },
  { label: 'Referrers',         pct: 15, bar: 'bg-atx-coral', txt: 'text-atx-coral' },
  { label: 'Protocol treasury', pct: 10, bar: 'bg-atx-grey',  txt: 'text-atx-ink/55' },
  { label: 'Attribution bonus', pct: 5,  bar: 'bg-atx-clay',  txt: 'text-atx-clay' },
]

// ─── shared input / label classes ─────────────────────────────────────────────
const INPUT = 'w-full px-3 py-2.5 border border-atx-ink/30 bg-atx-panel font-atx-mono text-[14px] text-atx-ink outline-none focus:border-atx-blue box-border'
const LABEL = 'block mb-1.5 font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'
const HINT  = 'block mt-1 text-[11px] text-atx-ink/45 font-atx-display'

// ─── star glyph ───────────────────────────────────────────────────────────────
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

// ─── step indicator ───────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-[7px] border border-atx-ink transition-all duration-200 ${
            i === current ? 'w-5 bg-atx-blue' : i < current ? 'w-[7px] bg-atx-mesquite' : 'w-[7px] bg-transparent'
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
          className={`${INPUT} flex items-center justify-between ${symStatus === 'ok' ? 'text-atx-ink' : 'text-atx-ink/40'}`}
          aria-readonly="true"
        >
          <span>{nameDisplay}</span>
          <span className="font-atx-mono text-[9px] uppercase tracking-[0.12em] text-atx-ink/40 border border-atx-ink/20 px-1.5 py-0.5 shrink-0 ml-2">Auto</span>
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
              className={`px-5 py-2 border font-atx-mono text-[13px] font-semibold ${
                draft.chainId === c.id ? 'border-atx-blue bg-atx-bone text-atx-blue' : 'border-atx-ink/30 bg-atx-panel text-atx-ink/60'
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
              className={`flex items-center justify-between px-4 py-3 border text-left ${
                draft.feeTier === f.bps ? 'border-atx-blue bg-atx-bone' : 'border-atx-ink/30 bg-atx-panel'
              }`}
            >
              <div>
                <span className={`text-[15px] font-bold font-atx-mono ${draft.feeTier === f.bps ? 'text-atx-blue' : 'text-atx-ink'}`}>
                  {f.label}
                </span>
                <span className="text-[12px] text-atx-ink/55 font-atx-display ml-2.5">
                  {f.desc}
                </span>
              </div>
              <span className="text-[11px] text-atx-ink/45 font-atx-mono">
                tick ±{f.spacing}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={LABEL}>Seed amount (USDC value of tokens)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-atx-ink/55 font-atx-mono">$</span>
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
        <span className="block mb-2.5 text-[12px] text-atx-ink/45 font-atx-display">
          LPs can always choose any tier — this is the pre-selected default shown on your vault page.
        </span>
        <div className="flex flex-col gap-2">
          {LOCK_DEFAULTS.map(l => (
            <button
              key={l.value}
              onClick={() => onChange({ defaultTier: l.value })}
              className={`flex items-center gap-3 px-4 py-3 text-left border ${
                draft.defaultTier === l.value ? 'border-atx-mesquite bg-atx-bone' : 'border-atx-ink/30 bg-atx-panel'
              }`}
            >
              <div className={`w-2 h-2 shrink-0 border border-atx-ink ${draft.defaultTier === l.value ? 'bg-atx-mesquite' : 'bg-transparent'}`} />
              <div>
                <div className="text-[13px] font-bold text-atx-ink font-atx-display">{l.label}</div>
                <div className="text-[11px] text-atx-ink/55 font-atx-display">{l.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Fee split preview */}
      <div className="bg-atx-panel border border-atx-ink p-4">
        <div className="mb-3 font-atx-mono uppercase tracking-[0.1em] text-[11px] text-atx-ink/60">
          Fee split (fixed by protocol)
        </div>
        {FEE_SPLIT.map(({ label, pct, bar, txt }) => (
          <div key={label} className="mb-2.5">
            <div className="flex justify-between mb-1">
              <span className="text-[12px] text-atx-ink/55 font-atx-display">{label}</span>
              <span className={`text-[13px] font-bold font-atx-mono ${txt}`}>{pct}%</span>
            </div>
            <div className="h-[8px] border border-atx-ink overflow-hidden relative">
              <div className={`absolute inset-y-0 left-0 ${bar}`} style={{ width: `${pct}%` }} />
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
      <div className="bg-atx-panel border border-atx-ink overflow-hidden">
        {rows.map(({ label, value, mono }, i) => (
          <div
            key={label}
            className={`flex justify-between items-center px-4 py-[11px] ${i < rows.length - 1 ? 'border-b border-atx-ink/20' : ''}`}
          >
            <span className="text-[12px] text-atx-ink/55 font-atx-display">{label}</span>
            <span className={`text-[13px] font-semibold text-atx-ink ${mono ? 'font-atx-mono' : 'font-atx-display'}`}>{value}</span>
          </div>
        ))}
      </div>

      <div className="bg-atx-panel border border-atx-ink/25 border-l-[3px] border-l-atx-clay px-3.5 py-2.5 text-[12px] text-atx-clay font-atx-display leading-[1.5] flex items-start gap-2">
        <Star className="w-3.5 h-3.5 shrink-0 mt-0.5 text-atx-clay" />
        <span>This will call <code className="font-atx-mono">SocialVault.seedTeamTokens()</code> on-chain. Make sure your wallet has sufficient project tokens approved for transfer.</span>
      </div>

      <div className="bg-atx-panel border border-atx-ink/20 px-3.5 py-2.5">
        <div className="mb-1.5 font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55">
          What will happen
        </div>
        <div className="flex flex-col gap-1 text-[12px] text-atx-ink/60 font-atx-display leading-[1.55]">
          <div>1. Mintware creates the vault record so the on-chain seed can point at the right vault ID.</div>
          <div>2. Your wallet may ask for token permission first. That step is not a transfer.</div>
          <div>3. Mintware simulates the seed call, then your wallet confirms the final on-chain seed transaction.</div>
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-atx-clay bg-atx-panel border border-atx-clay/40 px-3.5 py-2.5 font-atx-display">
          {error}
        </div>
      )}

      <button
        onClick={onDeploy}
        disabled={submitting}
        className="p-[13px] bg-atx-blue text-white border border-atx-ink font-atx-mono text-[15px] font-bold disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? submitLabel : 'Deploy vault →'}
      </button>

      {submitting && (
        <div className="text-[11px] text-atx-ink/55 font-atx-display bg-atx-panel border border-atx-ink/20 px-3 py-2 leading-[1.5]">
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
      const issuedAt = Date.now()
      const poolKey = {
        currency0:   draft.tokenAddress.toLowerCase(),
        currency1:   '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
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
  const seedStageLabel: Record<typeof vaultSeed.stage, string> = {
    idle: 'Deploy vault →',
    resetting_approval: 'Resetting token permission…',
    approving: 'Check wallet for token permission…',
    approved: 'Permission confirmed',
    seeding: 'Seeding vault on-chain…',
    success: 'Vault ready',
    error: 'Retry deploy',
  }

  if (deployed) return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto my-20 px-7 text-center [&_*]:rounded-none">
        <div className="flex justify-center mb-4"><Star className="w-12 h-12 text-atx-coral" /></div>
        <div className="text-[22px] font-extrabold text-atx-ink font-atx-display mb-2">
          Vault created
        </div>
        <div className="text-[14px] text-atx-ink/55 font-atx-display mb-7 leading-[1.6]">
          <strong>{draft.name}</strong> is now seeded on-chain and ready for LP deposits as soon as the network confirms the transaction.
        </div>
        <div className="flex gap-2.5 justify-center">
          <Link href="/vaults" className="px-5 py-2.5 bg-atx-blue text-white border border-atx-ink text-[14px] font-semibold font-atx-mono no-underline">
            View all vaults
          </Link>
          {deployed !== 'new' && (
            <Link href={`/vault/${deployed}`} className="px-5 py-2.5 border border-atx-ink/30 bg-atx-panel text-atx-ink text-[14px] font-semibold font-atx-mono no-underline">
              View vault →
            </Link>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4 max-[640px]:pt-5 [&_*]:rounded-none">

        {/* Breadcrumb */}
        <div className="mb-5 flex items-center gap-2">
          <button onClick={onBack} className="text-[13px] text-atx-ink/55 font-atx-display no-underline hover:text-atx-ink bg-transparent border-0 cursor-pointer p-0">
            ← Change surface
          </button>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-atx-display font-semibold">Create DeFi vault</span>
        </div>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-[22px] font-extrabold text-atx-ink font-atx-display m-0">
              {STEPS[step]}
            </h1>
            <StepDots current={step} total={STEPS.length} />
          </div>
          <div className="text-[13px] text-atx-ink/55 font-atx-display">
            {step === 0 && 'Tell us about your project and the token you\'re seeding.'}
            {step === 1 && 'Configure the V4 pool parameters for your vault.'}
            {step === 2 && 'Set LP defaults and review the fee distribution.'}
            {step === 3 && 'Review everything before deploying on-chain.'}
          </div>
        </div>

        {/* Step card */}
        <div className="bg-atx-panel border border-atx-ink p-7">
          {step === 0 && <Step1 draft={draft} onChange={patch} />}
          {step === 1 && <Step2 draft={draft} onChange={patch} />}
          {step === 2 && <Step3 draft={draft} onChange={patch} />}
          {step === 3 && <Step4 draft={draft} submitting={vaultSeed.isPending} submitLabel={seedStageLabel[vaultSeed.stage]} error={error} onDeploy={handleDeploy} />}

          {/* Nav buttons (hidden on step 3 which has its own deploy button) */}
          {step < 3 && (
            <div className="flex items-center justify-between mt-6">
              <button
                className="px-[22px] py-2.5 bg-transparent border border-atx-ink/30 text-atx-ink/60 font-atx-mono text-[14px] font-semibold hover:border-atx-ink"
                onClick={() => step > 0 ? setStep(s => s - 1) : undefined}
                style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
              >
                Back
              </button>
              <button
                className="px-[22px] py-2.5 bg-atx-blue text-white border border-atx-ink font-atx-mono text-[14px] font-semibold disabled:opacity-45 disabled:cursor-not-allowed"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
              >
                {step === 2 ? 'Review →' : 'Continue →'}
              </button>
            </div>
          )}
          {step === 3 && (
            <button
              className="mt-2.5 w-full px-[22px] py-2.5 bg-transparent border border-atx-ink/30 text-atx-ink/60 font-atx-mono text-[14px] font-semibold hover:border-atx-ink"
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
  return <DefiCreateFlow onBack={() => { window.location.href = '/vaults' }} />
}

function CreateVaultContent() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
        <MwNav />
        <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px] [&_*]:rounded-none">
          <div className="bg-atx-panel border border-atx-ink p-7">
            <div className="text-[13px] text-atx-ink/55 font-atx-display">
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
