'use client'

import Link                   from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useMintwarePrivy }   from '@/components/web2/providers'
import { useLaunch }          from '@/components/web2/LaunchModal'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

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
    <nav className="sticky top-0 z-[200] flex items-center justify-between px-7 h-[58px] bg-atx-bone border-b border-atx-ink/20 [&_*]:rounded-none font-atx-display">
      <Link
        href="/"
        className="flex items-center gap-2.5 no-underline text-atx-ink shrink-0"
      >
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <span className="text-[17px] font-bold tracking-[-0.02em]">MINTWARE</span>
      </Link>

      {!mounted ? (
        <div className="h-9 w-[200px]" />
      ) : isConnected ? (
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 max-[880px]:hidden">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={[
                  'px-[13px] py-[8px] text-[12px] uppercase tracking-[0.06em] no-underline whitespace-nowrap font-atx-mono',
                  'transition-colors duration-150',
                  isActive(href)
                    ? 'font-semibold text-atx-blue'
                    : 'font-normal text-atx-ink/55 hover:text-atx-ink',
                ].join(' ')}
              >
                {label}
              </Link>
            ))}
          </div>

          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            title="Command palette (⌘K)"
            className="ml-[6px] flex items-center gap-[5px] px-[9px] py-[6px] text-[11px] border border-atx-ink/25 bg-atx-panel cursor-pointer text-atx-ink/55 font-atx-mono transition-colors duration-150 hover:border-atx-blue hover:text-atx-blue max-[880px]:hidden"
          >
            ⌘K
          </button>

          {address && (
            <div
              className="ml-2 flex items-center gap-[7px] px-[13px] py-[7px] text-[12px] border border-atx-ink bg-atx-panel cursor-pointer text-atx-ink font-atx-mono select-none transition-colors duration-150 hover:border-atx-clay hover:text-atx-clay group"
              onClick={handleDisconnect}
              title="Click to disconnect"
            >
              <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink shrink-0" />
              <span>{shortAddr(address)}</span>
              <span className="text-atx-clay text-[12px]">✕</span>
            </div>
          )}

          {privy.authenticated && privy.hasEmbeddedWallet && (
            <button
              onClick={() => privy.linkWallet({ walletChainType: 'ethereum-only' })}
              className="ml-1 px-3 py-[7px] text-[11px] font-semibold uppercase tracking-[0.06em] border border-atx-blue text-atx-blue bg-transparent cursor-pointer font-atx-mono transition-colors duration-150 hover:bg-atx-blue hover:text-white max-[560px]:hidden"
              title="Link an external EVM wallet to this Privy session"
            >
              + EVM
            </button>
          )}

          {/* Mobile menu toggle — the inline links hide below 880px */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            className="hidden max-[880px]:flex items-center justify-center w-9 h-9 ml-1 border border-atx-ink/25 bg-atx-panel text-atx-ink cursor-pointer font-atx-mono text-[15px]"
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          {/* Mobile dropdown */}
          {menuOpen && (
            <div className="hidden max-[880px]:flex flex-col absolute top-[58px] left-0 right-0 bg-atx-bone border-b border-atx-ink/20 shadow-[0_8px_24px_rgba(17,17,17,0.12)] z-[199]">
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={[
                    'px-7 py-3.5 text-[13px] uppercase tracking-[0.06em] no-underline font-atx-mono border-t border-atx-ink/10',
                    isActive(href) ? 'font-semibold text-atx-blue bg-atx-panel' : 'text-atx-ink/70',
                  ].join(' ')}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href="/explorer"
            className="px-[13px] py-[8px] text-[12px] uppercase tracking-[0.06em] text-atx-ink/55 no-underline font-atx-mono transition-colors duration-150 hover:text-atx-ink max-[560px]:hidden"
          >
            Explorer
          </Link>
          <button
            onClick={() => launch()}
            className="px-5 py-2 bg-atx-blue text-white border border-atx-ink text-[12px] font-semibold uppercase tracking-[0.05em] cursor-pointer font-atx-mono transition-opacity duration-150 hover:opacity-90"
          >
            Launch app →
          </button>
        </div>
      )}
    </nav>
  )
}
