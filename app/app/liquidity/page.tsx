'use client'

// /app/liquidity — the liquidity MODEL ROUTER. Teams reach this from the intake ("Get liquidity for
// our token"). There are several ways to provide liquidity depending on what the team holds; this
// screens the situation and routes to the right model so every path flows well:
//   • Full or matched   → fund your token (± the quote); the community matches the rest  → vault/create
//   • Single-sided      → stage one asset, earn, opt-in pair on a match (staged buffer)  → /liquidity/staged
//   • Just deposit      → add to a live never-idle pool                                   → /vaults

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'

const MODELS = [
  {
    tag: 'Have your token',
    title: 'Launch with community matching',
    body: 'Commit your token on one side. The public funds the USDC side up to your target — and your token pairs proportionally as it fills, refunding whatever isn’t matched. One two-sided vault, fees + MEV captured.',
    href: '/app/liquidity/launch',
    cta: 'Preview the pairing →',
    tone: 'peri' as const,
  },
  {
    tag: 'Have both sides',
    title: 'Seed a balanced pool yourself',
    body: 'Already hold your token and the quote? Fund both sides directly and open the vault immediately — no waiting on a community match.',
    href: '/app/vault/create',
    cta: 'Create a vault →',
    tone: 'peri' as const,
  },
  {
    tag: 'Have one asset',
    title: 'Stage a single side',
    body: 'Only hold USDC (or one asset)? Stage it — it earns via Aave from day one and pairs into a pool only when a matching counterparty arrives. Opt-in, never automatic.',
    href: '/app/liquidity/staged',
    cta: 'See how staging works →',
    tone: 'coral' as const,
  },
  {
    tag: 'Ready now',
    title: 'Deposit into a live pool',
    body: 'Just want in? Add liquidity to an active vault and start capturing fees + MEV right away — shared pro-rata by the liquidity you provide.',
    href: '/app/vaults',
    cta: 'Browse live vaults →',
    tone: 'peri' as const,
  },
]

export default function LiquidityRouter() {
  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[860px] px-6 max-[700px]:px-4 py-[48px]">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep">Provide liquidity</div>
        <h1 className="font-atx-display font-bold text-[clamp(1.9rem,4.6vw,2.8rem)] leading-[1.05] tracking-[-0.03em] mt-3">
          However much of the pair<br /><span className="text-gradient-accent">you hold.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.18rem)] leading-[1.5] max-w-[62ch] mt-5">
          There&apos;s a path whether you have both sides, just your token, or a single stablecoin.
          Pick what matches your situation — every one keeps your capital productive.
        </p>

        <div className="grid grid-cols-1 gap-3 mt-9">
          {MODELS.map((m) => (
            <Link
              key={m.title}
              href={m.href}
              className="soft-card p-5 no-underline flex items-start justify-between gap-4 group hover:shadow-card-hover transition-shadow"
            >
              <span className="flex items-start gap-4 min-w-0">
                <span className="w-[10px] h-[10px] rounded-full shrink-0 mt-1.5" style={{ background: m.tone === 'coral' ? 'var(--color-coral2)' : 'var(--color-peri)' }} />
                <span className="min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{m.tag}</span>
                  <span className="block font-semibold text-[16px] text-ink mt-0.5">{m.title}</span>
                  <span className="block text-[13.5px] text-ink-mid leading-[1.55] mt-1 max-w-[58ch]">{m.body}</span>
                  <span className="inline-block text-[13px] font-semibold text-peri-deep mt-2.5">{m.cta}</span>
                </span>
              </span>
              <span className="shrink-0 text-ink-soft group-hover:text-peri-deep transition-colors mt-1">→</span>
            </Link>
          ))}
        </div>

        <p className="text-[12px] text-ink-soft mt-8 max-w-[64ch]">
          Testnet. Two-sided pools are the standard model (`MintwarePairVault` / matched-liquidity);
          single-sided staging earns via Aave today, with auto-match alerts + the atomic-pair router as
          the next leg. Nothing here is an offer.
        </p>
      </main>
    </div>
  )
}
