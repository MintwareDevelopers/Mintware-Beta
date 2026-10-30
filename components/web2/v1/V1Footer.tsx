// V1Footer — the footer for the Mintware app (mounted in V1Shell, so it covers every /v1 lane,
// Two clearly-separated sections: "V1 · The product" (the app you're in) and
// "V2 · Mintware" (the marketing site — the wider vision). Dark inline-hex palette to match the rest of V1
// (never the light marketing-footer tokens). Honest: testnet line + the "never idle" throughline.

import Link from 'next/link'
import { MintwareMark } from '@/components/ui2/MintwareMark'

// The product surfaces the user is inside (in-app absolute routes).
// Swap and Referrals stay routable but unlinked until swap execution and rewards ship.
const V1_LINKS = [
  { href: '/v1', label: 'Markets' },
  { href: '/v1/rwas', label: 'RWAs' },
  { href: '/v1/issuers', label: 'Issuers' },
  { href: '/v1/card', label: 'Card' },
  { href: '/v1/agents', label: 'Agents' },
  { href: '/legal', label: 'Legal & disclosures' },
]

// The marketing site (the wider vision). Re-declared locally so the dark footer never couples to
// MwFooter's light-theme link list; kept in sync with the real marketing pages.
const V2_LINKS = [
  { href: '/markets', label: 'Markets' },
  { href: '/issuers', label: 'Issuers' },
  { href: '/cards', label: 'Card' },
  { href: '/agents', label: 'Agents' },
  { href: '/the-math', label: 'The Math' },
  { href: '/proof', label: 'Proof' },
  { href: '/docs', label: 'Docs' },
  { href: '/legal', label: 'Legal' },
  { href: '/risk-disclosures', label: 'Risk' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
]


function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-3.5" style={{ color: '#8A8A9E' }}>{children}</div>
}

function FootLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block text-[13.5px] no-underline transition-colors min-h-[30px] flex items-center"
      style={{ color: '#494957' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#191923')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#494957')}
    >
      {label}
    </Link>
  )
}

export function V1Footer() {
  return (
    <footer className="mt-16" style={{ borderTop: '1px solid rgba(22,22,44,0.07)', background: 'transparent' }}>
      <div className="mx-auto max-w-[1200px] px-6 max-[640px]:px-4 py-12">
        <div className="grid gap-10" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 1fr 1.4fr' }}>
          {/* brand + throughline */}
          <div className="max-[720px]:col-span-full">
            <div className="flex items-center gap-2.5">
              <MintwareMark size={26} />
              <span className="font-bold text-[17px] tracking-[-0.01em]" style={{ color: '#191923' }}>Mintware</span>
            </div>
            <p className="text-[13.5px] leading-[1.6] mt-3.5 max-w-[34ch]" style={{ color: '#494957' }}>
              Never idle. Never locked. Always yours. Curated markets for tokens, stocks and real-world assets,
              on Base and Robinhood Chain.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#B7791F', background: 'rgba(194,122,0,0.1)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: '#B7791F' }} />
              Testnet · unaudited
            </span>
          </div>

          {/* V1 · The product */}
          <div>
            <Label>V1 · The product</Label>
            {V1_LINKS.map((l) => <FootLink key={l.href} {...l} />)}
          </div>

          {/* V2 · Mintware */}
          <div>
            <Label>V2 · Mintware — the vision</Label>
            <div className="grid gap-x-8" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
              {V2_LINKS.map((l) => <FootLink key={l.href} {...l} />)}
            </div>
          </div>
        </div>

        {/* bottom bar */}
        <div className="flex items-center justify-between gap-4 flex-wrap mt-10 pt-6" style={{ borderTop: '1px solid rgba(22,22,44,0.05)' }}>
          <div className="text-[12px]" style={{ color: '#8A8A9E' }}>© 2026 Mintware · Liquidity should be a public good</div>
        </div>

        <p className="text-[11px] leading-[1.6] mt-6" style={{ color: '#A6A6B8' }}>
          Testnet · mock tokens · no real value. Metrics live from GeckoTerminal; est. APR is an estimate, not a
          projection; a liquidity position carries impermanent loss. The risk score ranks, it never certifies —
          humans curate every pool. Nothing here is an offer or financial advice. External audit gates real value.
        </p>
      </div>
    </footer>
  )
}
