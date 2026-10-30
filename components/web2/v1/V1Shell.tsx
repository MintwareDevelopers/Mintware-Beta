'use client'

// V1 app shell — the light glass "app mode" chrome for MarketEngine liquidity, sharply separate from the light
// marketing site (you KNOW you're inside the product). Meteora-style: product nav (Discover · Portfolio),
// Connect Wallet as the top-right primary, a testnet chip — NO marketing links, NO "Launch app" button.
// Every V1 surface wraps its content in this shell.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { MineralMark } from '@/components/ui2/MineralMark'
import { V1Footer } from '@/components/web2/v1/V1Footer'
import { shortAddr } from '@/lib/web2/api'
import { V1DisclaimerGate } from './V1DisclaimerGate'

// The platform's five lanes, mirroring the public site, plus the wallet's Portfolio. Swap and Referrals stay routable, unlinked until they ship.
const NAV = [
  { label: 'Markets', href: '/v1', match: (p: string) => p === '/v1' || p.startsWith('/markets') },
  { label: 'RWAs', href: '/v1/rwas' },
  { label: 'Issuers', href: '/v1/issuers' },
  { label: 'Card', href: '/v1/card' },
  { label: 'Agents', href: '/v1/agents' },
  { label: 'Portfolio', href: '/v1/portfolio' },
]

export function V1Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { address, isConnected, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const connect = () => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })

  return (
    <div className="v1-app min-h-screen" style={{ background: 'var(--mw-ground)', color: 'var(--mw-ink)' }}>
      <V1DisclaimerGate />
      <header
        className="sticky top-0 z-50"
        style={{ background: 'rgba(246,246,250,0.8)', backdropFilter: 'saturate(1.4) blur(14px)', WebkitBackdropFilter: 'saturate(1.4) blur(14px)', borderBottom: '1px solid rgba(21,21,29,0.06)' }}
      >
        <div className="mx-auto max-w-[1240px] px-6 max-[640px]:px-4 h-[64px] flex items-center gap-5 max-[640px]:gap-3">
          <Link href="/v1" className="flex items-center gap-2.5 no-underline shrink-0" style={{ color: 'var(--mw-ink)' }}>
            <MineralMark size={28} />
            <span className="font-semibold text-[17px] tracking-[-0.02em] max-[560px]:hidden">Mintware</span>
          </Link>

          {/* nav is a shrinkable scroll strip so it can never push Connect Wallet off-screen on mobile */}
          <nav className="mw-inset flex items-center gap-1 p-1 rounded-[12px] min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => {
              const active = n.match ? n.match(pathname ?? '') : pathname?.startsWith(n.href) ?? false
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className="px-3.5 py-[7px] max-[640px]:px-2.5 rounded-[9px] text-[14px] max-[640px]:text-[13px] no-underline transition-colors shrink-0"
                  style={active ? { color: 'var(--mw-ink)', fontWeight: 600, background: '#FFFFFF', boxShadow: 'var(--mw-raise-sm)' } : { color: 'var(--mw-ink-2)', fontWeight: 500 }}
                >
                  {n.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex-1" />

          <span className="mw-raise-sm hidden sm:flex items-center gap-2 text-[13px] px-3 h-[40px] rounded-[10px] shrink-0" style={{ color: 'var(--mw-ink-2)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#22A45D' }} />
            Testnet · unaudited
          </span>

          {isConnected && address ? (
            <button
              onClick={disconnect}
              title="Disconnect"
              className="mw-raise-sm flex items-center gap-2 font-mono text-[13px] pl-1.5 pr-3 h-[40px] rounded-[10px] cursor-pointer shrink-0 border-0"
              style={{ color: 'var(--mw-ink)' }}
            >
              <span className="w-7 h-7 rounded-[8px]" style={{ background: 'var(--mw-sheen)' }} />
              {shortAddr(address)}
            </button>
          ) : (
            <button onClick={connect} className="mw-btn text-[14px] max-[640px]:text-[13px] !min-h-[40px] !rounded-[10px] shrink-0 whitespace-nowrap">
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-6 max-[640px]:px-4 py-10 max-[640px]:py-6">{children}</main>

      <V1Footer />
    </div>
  )
}
