import Link from 'next/link'
import { TeamStub } from '@/components/web2/team/TeamStub'

export default function TeamVaults() {
  return (
    <TeamStub
      title="Vaults"
      blurb="Allocate treasury capital across ULV vaults, and curate your own. Creating a vault is a Curator action — retail LPs deposit into what you build; the strategy and risk are yours to set."
      coming={[
        'Allocation view — move treasury across Growth ULV pools and the Aave idle buffer, rebalance in one place',
        'Curator controls — lock tiers, fee split, and the reputation-weighted reward path for the vaults you run',
        'Matched-liquidity launch — lock your token, let the community match in USDC, fees flow to backers during the cliff',
      ]}
    >
      <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-6 mt-6 max-w-[720px] flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-atx-display font-semibold text-[16px] text-ink">Create a vault</div>
          <div className="text-[13px] text-ink-mid mt-1 max-w-[46ch]">Seed a new ULV pool as a Curator. Set the pair, chain, and lock terms — in testing on Base Sepolia.</div>
        </div>
        <Link href="/app/vault/create" className="glass-pill glass-pill-sm shrink-0">+ Create vault →</Link>
      </div>
    </TeamStub>
  )
}
