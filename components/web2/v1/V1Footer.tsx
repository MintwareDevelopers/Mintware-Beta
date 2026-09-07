// V1Footer — the dark footer for the LP Gateway app (mounted in V1Shell, so it covers /v1, /v1/swap,
// /v1/portfolio, /earn/[pool]). Two clearly-separated sections: "V1 · The product" (the app you're in) and
// "V2 · Mintware" (the marketing site — the wider vision). Dark inline-hex palette to match the rest of V1
// (never the light marketing-footer tokens). Honest: testnet line + the "never idle" throughline.

import Link from 'next/link'
import { MintwareMark } from '@/components/ui2/MintwareMark'

// The product surfaces the user is inside (in-app absolute routes).
const V1_LINKS = [
  { href: '/v1', label: 'Discover' },
  { href: '/v1/swap', label: 'Swap' },
  { href: '/v1/portfolio', label: 'Portfolio' },
  { href: '/v1/referrals', label: 'Referrals' },
  { href: '/legal', label: 'Legal & disclosures' },
]

// The marketing site (the wider vision). Re-declared locally so the dark footer never couples to
// MwFooter's light-theme link list; kept in sync with the real marketing pages.
const V2_LINKS = [
  { href: '/defi', label: 'DeFi' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/yield-payment-network', label: 'Yield Network' },
  { href: '/agents', label: 'Agents' },
  { href: '/the-math', label: 'The Math' },
  { href: '/teams', label: 'For Teams' },
  { href: '/proof', label: 'Proof' },
  { href: '/docs', label: 'Docs' },
  { href: '/about', label: 'About' },
]

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/risk-disclosures', label: 'Risk Disclosures' },
]

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-3.5" style={{ color: '#63636F' }}>{children}</div>
}

function FootLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block text-[13.5px] no-underline transition-colors min-h-[30px] flex items-center"
      style={{ color: '#9B9BAD' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#F4F4FA')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#9B9BAD')}
    >
      {label}
    </Link>
  )
}

export function V1Footer() {
  return (
    <footer className="mt-16" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#0B0B12' }}>
      <div className="mx-auto max-w-[1200px] px-6 max-[640px]:px-4 py-12">
        <div className="grid gap-10" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 1fr 1.4fr' }}>
          {/* brand + throughline */}
          <div className="max-[720px]:col-span-full">
            <div className="flex items-center gap-2.5">
              <MintwareMark size={26} />
              <span className="font-bold text-[17px] tracking-[-0.01em]" style={{ color: '#F4F4FA' }}>Mintware</span>
            </div>
            <p className="text-[13.5px] leading-[1.6] mt-3.5 max-w-[34ch]" style={{ color: '#9B9BAD' }}>
              Never idle. Never locked. Always yours. — put USDG to work in curated Robinhood-Chain pools and
              spend from the yield.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#F0B45E', background: 'rgba(240,180,94,0.1)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: '#F0B45E' }} />
              Robinhood testnet · unaudited
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
        <div className="flex items-center justify-between gap-4 flex-wrap mt-10 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="text-[12px]" style={{ color: '#63636F' }}>© 2026 Mintware · Liquidity should be a public good</div>
          <div className="flex items-center gap-4">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-[12px] no-underline hover:underline" style={{ color: '#63636F' }}>{l.label}</Link>
            ))}
          </div>
        </div>

        <p className="text-[11px] leading-[1.6] mt-6" style={{ color: '#4A4A55' }}>
          Testnet · mock tokens · no real value. Metrics live from GeckoTerminal; est. APR is an estimate, not a
          projection; a liquidity position carries impermanent loss. The risk score ranks, it never certifies —
          humans curate every pool. Nothing here is an offer or financial advice. External audit gates real value.
        </p>
      </div>
    </footer>
  )
}
