'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useDisconnect } from 'wagmi'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

export function MwNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { disconnect } = useDisconnect()

  function handleDisconnect() {
    disconnect()
    router.push('/')
  }

  function navLink(href: string, label: string, active: boolean) {
    return (
      <Link
        href={href}
        style={{
          padding: '7px 14px',
          borderRadius: 20,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          color: active ? '#1a1a1a' : '#6b7280',
          background: active ? '#f0f0f2' : 'none',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          transition: 'background 0.15s, color 0.15s',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
        }}
      >
        {label}
      </Link>
    )
  }

  return (
    <>
      <style>{`
        .mw-nav-link:hover { background: var(--color-mw-surface) !important; color: var(--color-mw-ink) !important; }
        .mw-wallet-pill { transition: all var(--transition-fast); }
        .mw-wallet-pill:hover { border-color: rgba(239,68,68,0.3) !important; color: var(--color-mw-red) !important; background: rgba(239,68,68,0.04) !important; }
        .mw-wallet-pill .mw-disconnect { display: none; }
        .mw-wallet-pill:hover .mw-label { display: none; }
        .mw-wallet-pill:hover .mw-disconnect { display: flex !important; }
      `}</style>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', height: 49,
        background: '#ffffff',
        borderBottom: '0.5px solid var(--color-mw-border)',
      }}>
        <Link
          href="/"
          style={{
            fontSize: 17, fontWeight: 500, letterSpacing: '-0.4px',
            textDecoration: 'none', color: 'var(--color-mw-ink)', flexShrink: 0,
            fontFamily: 'Plus Jakarta Sans, sans-serif',
          }}
        >
          Mint<span style={{ color: 'var(--color-mw-brand)' }}>ware</span>
        </Link>

        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, mounted }) => {
            const connected = mounted && account && chain

            if (!mounted) return <div style={{ height: 36, width: 200 }} />

            if (connected) {
              const isActive = (path: string) =>
                pathname === path || (path === '/dashboard' && pathname.startsWith('/campaign'))

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Nav links */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {[
                      { href: '/dashboard',   label: 'Earn' },
                      { href: '/swap',        label: 'Swap' },
                      { href: '/leaderboard', label: 'Leaderboard' },
                      { href: '/profile',     label: 'Profile' },
                    ].map(({ href, label }) => (
                      <Link
                        key={href}
                        href={href}
                        className="mw-nav-link"
                        style={{
                          padding: '7px 14px',
                          borderRadius: 20,
                          fontSize: 13,
                          fontWeight: isActive(href) ? 500 : 400,
                          color: isActive(href) ? 'var(--color-mw-ink)' : 'var(--color-mw-ink-3)',
                          background: isActive(href) ? 'var(--color-mw-surface)' : 'none',
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                        }}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>

                  {/* Wallet pill */}
                  <div
                    className="mw-wallet-pill"
                    onClick={handleDisconnect}
                    title="Click to disconnect"
                    style={{
                      marginLeft: 8,
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 14px',
                      borderRadius: 20,
                      fontSize: 12,
                      border: '0.5px solid var(--color-mw-border-strong)',
                      background: '#ffffff',
                      cursor: 'pointer',
                      color: 'var(--color-mw-ink)',
                      fontFamily: 'DM Mono, monospace',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-mw-live)', flexShrink: 0 }} />
                    <span className="mw-label">{account.displayName}</span>
                    <span
                      className="mw-disconnect"
                      style={{
                        color: 'var(--color-mw-red)',
                        fontFamily: 'Plus Jakarta Sans, sans-serif',
                        fontSize: 11,
                      }}
                    >
                      ✕ disconnect
                    </span>
                  </div>
                </div>
              )
            }

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link
                  href="/explorer"
                  className="mw-nav-link"
                  style={{
                    padding: '7px 14px', borderRadius: 20, fontSize: 13,
                    color: 'var(--color-mw-ink-3)', textDecoration: 'none',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  Explorer
                </Link>
                <button
                  onClick={openConnectModal}
                  style={{
                    padding: '8px 16px', borderRadius: 20,
                    background: 'var(--color-mw-brand)', color: '#fff',
                    border: 'none', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  Connect Wallet
                </button>
              </div>
            )
          }}
        </ConnectButton.Custom>
      </nav>
    </>
  )
}
