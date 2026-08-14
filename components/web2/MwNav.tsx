'use client'

import Link                   from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useMintwarePrivy }   from '@/components/web2/providers'
import { useLaunch }          from '@/components/web2/LaunchModal'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { MintwareMark }        from '@/components/ui2/MintwareMark'
import { ScopeSwitcher }        from '@/components/web2/ScopeSwitcher'

// MwNav — the authenticated in-app nav. Design v2 (Privy-esque): translucent
// white/blur bar, periwinkle logo mark, glass-pill actions. All wallet/Privy
// logic preserved.

function shortAddr(a: string) {
  return a.slice(0, 6) + '…' + a.slice(-4)
}

export function MwNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  // Client-mount guard — avoids a hydration flash between server (disconnected)
  // and the wallet state wagmi/Privy resolve on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const { address, isConnected, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const { launch } = useLaunch()

  function handleDisconnect() {
    disconnect()          // evm disconnect + privy logout (see useMintwareIdentity)
    router.push('/')
  }

  const isActive = (path: string) => pathname === path

  const NAV_LINKS = [
    { href: '/app/swap', label: 'Swap' },
    { href: '/app/vaults', label: 'Vaults' },
    { href: '/app/leaderboard', label: 'Leaderboard' },
    { href: '/app/profile', label: 'Profile' },
  ]

  return (
    <nav className="sticky top-0 z-[200] flex items-center justify-between px-6 max-[800px]:px-4 h-[60px] bg-white/70 backdrop-blur-[16px] border-b border-hair-soft font-atx-display">
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-ink shrink-0">
          <MintwareMark size={24} />
          <span className="font-atx-display text-[17px] font-bold tracking-[-0.02em] max-[640px]:hidden">Mintware</span>
        </Link>
        <ScopeSwitcher />
      </div>

      {!mounted ? (
        <div className="h-9 w-[200px]" />
      ) : isConnected ? (
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 max-[880px]:hidden">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 text-[13px] font-medium no-underline whitespace-nowrap transition-colors ${isActive(href) ? 'text-ink' : 'text-ink-mid hover:text-ink'}`}
              >
                {label}
              </Link>
            ))}
          </div>

          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            title="Command palette (⌘K)"
            className="ml-1.5 glass-pill glass-pill-sm !px-3 max-[880px]:hidden"
          >
            ⌘K
          </button>

          {address && (
            <div
              className="ml-2 flex items-center gap-[7px] px-3 py-[7px] text-[12px] rounded-full border border-hair bg-white cursor-pointer text-ink select-none transition-colors duration-150 hover:border-[rgba(209,67,67,0.4)] hover:text-[#D14343] group"
              onClick={handleDisconnect}
              title="Click to disconnect"
            >
              <span className="w-[7px] h-[7px] rounded-full bg-peri shrink-0 group-hover:bg-[#D14343]" />
              <span className="font-mono">{shortAddr(address)}</span>
              <span className="text-[#D14343] text-[12px]">✕</span>
            </div>
          )}

          {privy.authenticated && privy.hasEmbeddedWallet && (
            <button
              onClick={() => privy.linkWallet({ walletChainType: 'ethereum-only' })}
              className="ml-1 glass-pill glass-pill-sm max-[560px]:hidden"
              title="Link an external EVM wallet to this Privy session"
            >
              + EVM
            </button>
          )}

          {/* Mobile menu toggle — the inline links hide below 880px */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            className="hidden max-[880px]:flex glass-pill glass-pill-sm w-11 h-11 ml-1 !px-0"
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          {/* Mobile dropdown */}
          {menuOpen && (
            <div className="hidden max-[880px]:flex flex-col absolute top-[60px] left-0 right-0 bg-white/95 backdrop-blur-md border-b border-hair-soft shadow-lift z-[199]">
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={`px-6 py-3.5 text-[15px] font-medium no-underline border-t border-hair-soft ${isActive(href) ? 'text-ink' : 'text-ink-mid'}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Link
            href="/explorer"
            className="text-[13px] font-medium text-ink-mid no-underline hover:text-ink max-[560px]:hidden"
          >
            Explorer
          </Link>
          <button onClick={() => launch()} className="glass-pill glass-pill-sm">
            Launch app →
          </button>
        </div>
      )}
    </nav>
  )
}
