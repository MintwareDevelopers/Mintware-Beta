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

  return (
    <>
      <style>{`
        .mw-nav {
          position: sticky; top: 0; z-index: 200;
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 48px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(26,26,46,0.07);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
        }
        .mw-logo {
          font-family: Georgia, serif;
          font-size: 18px; font-weight: 700; letter-spacing: -0.5px;
          text-decoration: none; color: #1A1A2E; flex-shrink: 0;
        }
        .mw-logo em { font-style: normal; color: #0052FF; }

        /* Nav tabs group */
        .mw-nav-tabs { display: flex; align-items: center; gap: 4px; }
        .mw-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px; border-radius: 10px;
          font-size: 13px; font-weight: 500; color: #8A8C9E;
          text-decoration: none; white-space: nowrap;
          background: transparent; border: 1px solid transparent;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
          cursor: pointer;
        }
        .mw-tab:hover {
          background: rgba(26,26,46,0.05);
          border-color: rgba(26,26,46,0.08);
          color: #1A1A2E;
        }
        .mw-tab.active {
          background: rgba(0,82,255,0.08);
          border-color: rgba(0,82,255,0.18);
          color: #0052FF;
          font-weight: 600;
        }

        /* Right side */
        .mw-nav-right { display: flex; align-items: center; gap: 8px; }

        /* Connect button */
        .mw-connect-btn {
          padding: 8px 20px; border-radius: 10px;
          background: #0052FF; color: #fff; border: none;
          font-size: 13px; font-weight: 600; cursor: pointer;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          transition: background 0.15s, transform 0.15s; white-space: nowrap;
        }
        .mw-connect-btn:hover { background: #0040cc; transform: translateY(-1px); }

        /* Wallet pill — shows address, disconnect on hover */
        .mw-wallet-wrap { position: relative; }
        .mw-wallet-pill {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 14px; border-radius: 10px;
          border: 1px solid rgba(26,26,46,0.13);
          background: rgba(26,26,46,0.03);
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; color: #8A8C9E;
          cursor: pointer; transition: all 0.15s;
          white-space: nowrap; user-select: none;
          text-decoration: none;
        }
        .mw-wallet-pill:hover { border-color: rgba(239,68,68,0.3); color: #dc2626; background: rgba(239,68,68,0.04); }
        .mw-wallet-pill:hover .mw-wallet-dot { background: #dc2626; animation: none; }
        .mw-wallet-pill.active { border-color: rgba(0,82,255,0.2); background: rgba(0,82,255,0.06); color: #0052FF; }
        .mw-wallet-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #16a34a; flex-shrink: 0;
          animation: mw-pulse 2s ease infinite;
        }
        .mw-disconnect-hint {
          font-size: 10px; color: #dc2626; display: none;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
        }
        .mw-wallet-pill:hover .mw-display-name { display: none; }
        .mw-wallet-pill:hover .mw-disconnect-hint { display: inline; }

        @keyframes mw-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @media (max-width: 768px) {
          .mw-nav { padding: 12px 20px; }
          .mw-tab span.mw-tab-label { display: none; }
          .mw-tab { padding: 7px 10px; }
        }
        @media (max-width: 480px) {
          .mw-nav-tabs { gap: 2px; }
        }
      `}</style>

      <nav className="mw-nav">
        <Link href="/" className="mw-logo">
          Mint<em>ware</em>
        </Link>

        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, mounted }) => {
            const connected = mounted && account && chain

            if (!mounted) return <div style={{ visibility: 'hidden', height: 36 }} />

            if (connected) {
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Nav tabs */}
                  <div className="mw-nav-tabs">
                    <Link
                      href="/dashboard"
                      className={`mw-tab${pathname === '/dashboard' || (pathname.startsWith('/campaign') && !pathname.startsWith('/campaign/generate')) ? ' active' : ''}`}
                    >
                      <span>⚡</span><span className="mw-tab-label">Earn</span>
                    </Link>
                    <Link
                      href="/swap"
                      className={`mw-tab${pathname === '/swap' ? ' active' : ''}`}
                    >
                      <span>🔄</span><span className="mw-tab-label">Swap</span>
                    </Link>
                    <Link
                      href="/leaderboard"
                      className={`mw-tab${pathname === '/leaderboard' ? ' active' : ''}`}
                    >
                      <span>🏆</span><span className="mw-tab-label">Leaderboard</span>
                    </Link>
                    <Link
                      href="/profile"
                      className={`mw-tab${pathname === '/profile' ? ' active' : ''}`}
                    >
                      <span>👤</span><span className="mw-tab-label">Profile</span>
                    </Link>
                  </div>

                  {/* Wallet pill — hover to disconnect */}
                  <div className="mw-wallet-wrap">
                    <div
                      className={`mw-wallet-pill${pathname === '/profile' ? ' active' : ''}`}
                      onClick={handleDisconnect}
                      title="Click to disconnect"
                    >
                      <span className="mw-wallet-dot" />
                      <span className="mw-display-name">{account.displayName}</span>
                      <span className="mw-disconnect-hint">✕ disconnect</span>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="mw-nav-tabs">
                  <Link
                    href="/explorer"
                    className={`mw-tab${pathname === '/explorer' ? ' active' : ''}`}
                  >
                    <span>🔍</span><span className="mw-tab-label">Explorer</span>
                  </Link>
                </div>
                <button className="mw-connect-btn" onClick={openConnectModal}>
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
