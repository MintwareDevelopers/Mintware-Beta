'use client'

// V1 app shell — the light glass "app mode" chrome for MarketEngine liquidity, sharply separate from the light
// marketing site (you KNOW you're inside the product). Meteora-style: product nav (Discover · Portfolio),
// Connect Wallet as the top-right primary, a testnet chip — NO marketing links, NO "Launch app" button.
// Every V1 surface wraps its content in this shell.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { V1Footer } from '@/components/web2/v1/V1Footer'
import { shortAddr } from '@/lib/web2/api'
import { V1DisclaimerGate } from './V1DisclaimerGate'

// The platform's five lanes, mirroring the public site. Swap and Referrals stay reachable from the footer.
const NAV = [
  { label: 'Markets', href: '/v1', match: (p: string) => p === '/v1' || p.startsWith('/markets') },
  { label: 'RWAs', href: '/v1/rwas' },
  { label: 'Issuers', href: '/v1/issuers' },
  { label: 'Card', href: '/v1/card' },
  { label: 'Agents', href: '/v1/agents' },
]

export function V1Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { address, isConnected, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const connect = () => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })

  return (
    <div className="v1-app font-atx-display min-h-screen" style={{ background: '#F7F7FB', color: '#191923' }}>
      <V1DisclaimerGate />
      <header
        className="sticky top-0 z-50 border-b"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', borderColor: 'rgba(22,22,44,0.07)' }}
      >
        <div className="mx-auto max-w-[1200px] px-6 max-[640px]:px-4 h-[58px] flex items-center gap-6 max-[640px]:gap-3">
          <Link href="/v1" className="flex items-center gap-2.5 no-underline shrink-0" style={{ color: '#191923' }}>
            <MintwareMark size={24} />
            <span className="font-bold text-[16px] tracking-[-0.01em] max-[560px]:hidden">Mintware</span>
          </Link>

          {/* nav is a shrinkable scroll strip so it can never push Connect Wallet off-screen on mobile */}
          <nav className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => {
              const active = n.match ? n.match(pathname ?? '') : pathname?.startsWith(n.href) ?? false
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3 py-1.5 max-[640px]:px-2.5 rounded-full text-[13.5px] max-[640px]:text-[13px] font-medium no-underline transition-colors shrink-0"
                  style={active ? { color: '#191923', background: '#FFFFFF', boxShadow: '0 2px 10px rgba(90,87,222,0.14)' } : { color: '#494957' }}
                >
                  {n.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex-1" />

          <span
            className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] px-2.5 py-1 rounded-full"
            style={{ color: '#5A57DE', background: 'rgba(138,130,244,0.10)', border: '1px solid rgba(138,130,244,0.20)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#5A57DE' }} />
            Testnet · Unaudited
          </span>

          {isConnected && address ? (
            <button
              onClick={disconnect}
              title="Disconnect"
              className="font-mono text-[13px] px-3.5 max-[640px]:px-3 py-2 rounded-full transition-colors cursor-pointer shrink-0"
              style={{ color: '#191923', border: '1px solid rgba(22,22,44,0.12)' }}
            >
              {shortAddr(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              className="text-[13.5px] max-[640px]:text-[13px] font-semibold px-4 max-[640px]:px-3.5 py-2 rounded-full text-white cursor-pointer shrink-0 whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 max-[640px]:px-4 py-9 max-[640px]:py-6">{children}</main>

      <V1Footer />
    </div>
  )
}
