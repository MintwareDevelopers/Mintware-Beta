import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { CardVisual } from '@/components/marketing/CardVisual'
import { CardDay } from '@/components/marketing/mineral/CardDay'
import { Page, Section, SectionHead, Hero, IconTile, Arrow, CTA } from '@/components/marketing/Story'
import { IconLimit, IconApprove, IconFailClosed, IconOwned } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Card — Mintware', description: 'A card that spends from a small balance and refills it from your earning balance, only by what you spend.' }

// The page argues: most cards spend idle money → here is one day with ours (interactive) → you set every limit →
// it's in development, join the list. The card is not live; the copy says so plainly.

const CONTROLS: [string, string, ReactNode][] = [
  ['A daily refill limit', 'Refills never move more than the limit you choose, however much you spend.', <IconLimit key="l" size={22} />],
  ['New card wallets wait 48 hours', 'Linking a new card wallet takes two days to go live, so a surprise link can be stopped.', <IconApprove key="a" size={22} />],
  ['Freeze it instantly', 'Cut a card off in one tap. Nothing refills while it’s frozen.', <IconFailClosed key="f" size={22} />],
  ['Non‑custodial underneath', 'Your earning balance sits in your own wallet. Nobody can move it but you.', <IconOwned key="o" size={22} />],
]

export default function CardsPage() {
  return <Page>
    <V2Nav active="cards" />

    <Hero
      eyebrow="Card · in development"
      title="Spend what"
      soft="you’ve earned."
      lede="Most cards spend money that’s doing nothing. This one spends from a small card balance and refills it from your earning balance, only by what you spend. Everything else stays where it is."
      actions={<div className="w-full max-w-[480px]"><WaitlistForm source="card" /><p className="mt-3 mb-0 text-[13px] text-ink-soft">Not live yet. Join the list and we’ll tell you when it is.</p></div>}
      aside={<CardVisual />}
    />

    {/* 1 — the idea, as one day */}
    <Section tint>
      <SectionHead
        eyebrow="A day with the card"
        title="You spend."
        soft="It refills by exactly that."
        aside="Step through a day. Watch what moves and, more to the point, what doesn’t."
      />
      <div className="mt-12"><CardDay /></div>
    </Section>

    {/* 2 — control */}
    <Section>
      <SectionHead
        eyebrow="Always in control"
        title="You decide what can move,"
        soft="and when."
        aside="The card can only pull from your earning balance under rules you set, and you can stop it at any time."
      />
      <div className="mt-12 mw-raise rounded-[26px] grid md:grid-cols-2 overflow-hidden">
        {CONTROLS.map(([t, b, icon], i) => (
          <div key={t} className="p-[clamp(22px,3vw,32px)] flex gap-4 items-start" style={{ borderTop: i > 1 ? '1px solid var(--mw-line)' : undefined, borderLeft: i % 2 ? '1px solid var(--mw-line)' : undefined }}>
            <IconTile>{icon}</IconTile>
            <div><div className="font-semibold text-[18px] tracking-[-0.02em]">{t}</div><div className="text-[15px] text-ink-mid leading-[1.55] mt-1.5">{b}</div></div>
          </div>
        ))}
      </div>
      <p className="mt-6 mb-0 text-[14px] text-ink-soft max-w-[70ch]">Cards will be issued with Bridge and Stripe, on established card rails. The earning balance carries market and smart‑contract risk and is not a deposit or a savings account.</p>
    </Section>

    <CTA title="Spend from a balance" soft="that stays yours.">
      <div className="w-full max-w-[480px] mx-auto text-left"><WaitlistForm source="card" /></div>
      <div className="w-full flex justify-center"><Link href="/markets" className="mw-btn-quiet">Explore markets <Arrow size={16} /></Link></div>
    </CTA>
  </Page>
}
