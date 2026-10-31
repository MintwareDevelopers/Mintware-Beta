'use client'

import Link                   from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { useMintwarePrivy }   from '@/components/web2/providers'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { MintwareMark }        from '@/components/ui2/MintwareMark'
import { ScopeSwitcher }        from '@/components/web2/ScopeSwitcher'
import { shortAddr }            from '@/lib/web2/api'

// MwNav — the authenticated in-app nav, in Mineral: frosted porcelain bar, disc mark, section links in an
// inset well with a raised current pill, quiet raised controls and one solid primary action. All wallet/Privy
// logic preserved.

export function MwNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  // Client-mount guard — avoids a hydration flash between server (disconnected)
  // and the wallet state wagmi/Privy resolve on the client.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)

  const { address, isConnected, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()

  function handleDisconnect() {
    disconnect()          // evm disconnect + privy logout (see useMintwareIdentity)
    router.push('/')
  }

  const isActive = (path: string) => pathname === path

  const NAV_LINKS = [
    { href: '/app/account', label: 'Account' },
    { href: '/app/swap', label: 'Swap' },
    { href: '/app/markets', label: 'Markets' },
    { href: '/agents/leaderboard', label: 'Agents' },
  ]

  const menuIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  )

  return (
    <nav
      className="sticky top-0 z-[200] flex items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] h-[64px] font-geist"
      style={{ background: 'rgba(246,246,250,0.82)', backdropFilter: 'saturate(1.4) blur(14px)', WebkitBackdropFilter: 'saturate(1.4) blur(14px)', borderBottom: '1px solid var(--mw-line)' }}
    >
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-ink shrink-0">
          <MintwareMark size={28} />
          <span className="text-[18px] font-semibold tracking-[-0.02em] max-[640px]:hidden">Mintware</span>
        </Link>
        <div className="min-w-0 max-w-[200px]"><ScopeSwitcher compact /></div>
      </div>

      {!mounted ? (
        <div className="h-10 w-[200px]" />
      ) : isConnected ? (
        <div className="flex items-center gap-2">
          {/* Section links sit in an inset well; the current page is the raised pill. */}
          <div className="flex items-center gap-1 rounded-[14px] p-1 max-[880px]:hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className="px-3.5 py-1.5 rounded-[10px] text-[14px] font-medium no-underline whitespace-nowrap transition-colors"
                style={isActive(href) ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}
              >
                {label}
              </Link>
            ))}
          </div>

          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            title="Command palette (⌘K)"
            className="mw-btn-quiet !min-h-[40px] !px-3 font-geist-mono text-[12.5px] max-[880px]:hidden"
          >
            ⌘K
          </button>

          {address && (
            <button
              className="mw-btn-quiet !min-h-[40px] !px-2.5 !gap-2 text-[13px] !font-medium group"
              onClick={handleDisconnect}
              title="Click to disconnect"
            >
              <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'var(--mw-sheen)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }} aria-hidden />
              <span className="font-geist-mono">{shortAddr(address)}</span>
              <span className="text-ink-soft group-hover:text-[#B42318] text-[12px]" aria-hidden>✕</span>
            </button>
          )}

          {privy.authenticated && privy.hasEmbeddedWallet && (
            <button
              onClick={() => privy.linkWallet({ walletChainType: 'ethereum-only' })}
              className="mw-btn-quiet !min-h-[40px] !px-3 text-[13px] max-[560px]:hidden"
              title="Link an external EVM wallet to this Privy session"
            >
              + EVM
            </button>
          )}

          {/* Mobile menu toggle — the inline links hide below 880px */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className="hidden max-[880px]:inline-flex mw-btn-quiet !w-11 !h-11 !min-h-0 !px-0"
          >
            {menuIcon}
          </button>

          {/* Mobile dropdown */}
          {menuOpen && (
            <div className="hidden max-[880px]:block absolute top-[64px] left-0 right-0 px-4 pb-4 z-[199]">
              <div className="mw-raise rounded-[18px] p-2 flex flex-col">
                {NAV_LINKS.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-3 rounded-[12px] text-[15px] font-medium no-underline"
                    style={isActive(href) ? { background: 'var(--mw-band)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Link
            href="/markets"
            className="text-[14px] font-medium text-ink-mid no-underline hover:text-ink max-[560px]:hidden"
          >
            Markets
          </Link>
          <Link href="/app/markets" className="mw-btn !min-h-[40px] text-[14px]">
            Launch app
          </Link>
        </div>
      )}
    </nav>
  )
}
