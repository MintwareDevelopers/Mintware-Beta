'use client'

// /app/team/liquidity — "Liquidity for your token", the Team workspace's model router (moved from Personal in the
// 2026-10-02 IA audit: these are token-issuer jobs, never retail). Routes by what the team holds:
//   • Your token only  → community-matched launch                         → ./launch
//   • Both sides       → seed a balanced pool (records intent; ops deploys) → ./create
//   • One asset        → stage one side, pair later (staged buffer)        → ./staged
// Supplying into an existing pool is a retail job and lives in Personal › Vaults — not here.

import Link from 'next/link'

const MODELS = [
  {
    tag: 'Have your token',
    title: 'Launch with community matching',
    body: 'Commit your token on one side. The public funds the USDC side up to your target — and your token pairs proportionally as it fills, refunding whatever isn’t matched. One two-sided vault, fees + MEV captured.',
    href: '/app/team/liquidity/launch',
    cta: 'Preview the pairing →',
    tone: 'peri' as const,
  },
  {
    tag: 'Have both sides',
    title: 'Seed a balanced pool yourself',
    body: 'Already hold your token and the quote? Fund both sides directly and request the vault. We deploy it on testnet and it opens without waiting on a community match.',
    href: '/app/team/liquidity/create',
    cta: 'Create a vault →',
    tone: 'peri' as const,
  },
  {
    tag: 'Have one asset',
    title: 'Stage a single side',
    body: 'Only hold USDC (or one asset)? Stage it — it sits in a yield adapter (a testnet mock today) and pairs into a pool only when you choose. Opt-in, never automatic.',
    href: '/app/team/liquidity/staged',
    cta: 'See how staging works →',
    tone: 'coral' as const,
  },
]

export default function LiquidityRouter() {
  return (
    <div className="font-atx-display text-ink">
      <main className="max-w-[860px] py-2">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep">Liquidity for your token</div>
        <h1 className="font-atx-display font-bold text-[clamp(1.9rem,4.6vw,2.8rem)] leading-[1.05] tracking-[-0.03em] mt-3">
          However much of the pair<br /><span className="text-gradient-accent">you hold.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.18rem)] leading-[1.5] max-w-[62ch] mt-5">
          There&apos;s a path whether your team holds both sides, just your token, or a single stablecoin.
          Pick the one that matches your treasury.
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
          Testnet. Two-sided pools are the standard model (MintwarePairVault / matched liquidity). Staging runs
          against a testnet mock yield adapter; real lending venues and auto-match alerts are the next leg. Nothing
          here is an offer.
        </p>
      </main>
    </div>
  )
}
