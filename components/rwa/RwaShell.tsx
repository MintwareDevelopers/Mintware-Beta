'use client'

// The RWA workspace of the shared AppShell — same chrome as Personal and Team, its own menu.

import { AppShell } from '@/components/web2/AppShell'
import { RWA_UNITS } from '@/lib/rwa/demo'

export function RwaShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      groups={[
        { items: [{ href: '/app/rwa', label: 'Overview', exact: true }] },
        {
          title: 'Markets',
          items: RWA_UNITS.map((u) => ({ href: `/app/rwa/${u.slug}`, label: u.demo.property.name.replace(' (demo)', ''), hint: u.chain.short })),
        },
        {
          title: 'Take part',
          items: [
            { href: '/app/rwa-liquidity', label: 'Supply liquidity', hint: 'LPs' },
            { href: '/app/team/rwa', label: 'Issuer console', hint: 'Issuers' },
          ],
        },
        { title: 'Evidence', items: [{ href: '/app/rwa/proof', label: 'On-chain proof' }, { href: '/app/rwa/how', label: 'How it works' }] },
      ]}
      footer={
        <div className="rounded-lg bg-white border border-hair-soft px-3 py-2 text-[10.5px] text-ink-soft leading-[1.4]">
          <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.1em] font-semibold text-[#1F7A6A]"><span className="w-[6px] h-[6px] rounded-full bg-mw-live inline-block" />Live on testnet</span>
          <span className="block mt-1">Fictional property, valueless test tokens, unaudited contracts.</span>
        </div>
      }
    >
      {children}
    </AppShell>
  )
}
