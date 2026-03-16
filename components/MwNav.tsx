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
          padding: 16px 48px;
          background: rgba(255,255,255,0.94);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border-bottom: 1px solid rgba(26,26,46,0.08);
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
        }
        .mw-logo {
          font-family: Georgia, serif;
          font-size: 18px; font-weight: 700; letter-spacing: -0.5px;
          text-decoration: none; color: #1A1A2E; flex-shrink: 0;
        }
        .mw-logo em { font-style: normal; color: #0052FF; }
        .mw-nav-right { display: flex; align-items: center; gap: 24px; }
        .mw-nav-link {
          font-size: 13px; font-weight: 500; color: #8A8C9E;
          text-decoration: none; transition: color 0.15s; white-space: nowrap;
        }
        .mw-nav-link:hover { color: #1A1A2E; }
        .mw-nav-link.active { color: #0052FF; font-weight: 600; }
        .mw-connect-btn {
          padding: 8px 20px; border-radius: 10px;
          background: #0052FF; color: #fff; border: none;
          font-size: 13px; font-weight: 600; cursor: pointer;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          transition: background 0.15s, transform 0.15s; white-space: nowrap;
        }
        .mw-connect-btn:hover { background: #0040cc; transform: translateY(-1px); }

        /* Wallet pill — click = go to profile, shows disconnect on hover */
        .mw-wallet-wrap { position: relative; }
        .mw-wallet-pill {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 14px; border-radius: 20px;
          border: 1px solid rgba(26,26,46,0.13);
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; color: #8A8C9E;
          cursor: pointer; transition: border-color 0.15s, color 0.15s, background 0.15s;
          white-space: nowrap; user-select: none; background: none;
          text-decoration: none;
        }
        .mw-wallet-pill:hover { border-color: #0052FF; color: #0052FF; background: rgba(0,82,255,0.05); }
        .mw-wallet-pill:hover .mw-wallet-dot { background: #0052FF; animation: none; }
        .mw-wallet-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #16a34a; flex-shrink: 0;
          animation: mw-pulse 2s ease infinite;
        }

        /* Disconnect button — shown on hover of wrap */
        .mw-disconnect-btn {
          display: none; align-items: center; gap: 6px;
          padding: 7px 14px; border-radius: 20px;
          border: 1px solid rgba(239,68,68,0.25); background: none;
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 12px; color: #dc2626; cursor: pointer;
          white-space: nowrap; transition: all 0.15s;
        }
        .mw-wallet-wrap:hover .mw-disconnect-btn { display: flex; }
        .mw-disconnect-btn:hover { background: rgba(239,68,68,0.06); border-color: #dc2626; }

        @keyframes mw-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @media (max-width: 640px) {
          .mw-nav { padding: 14px 20px; }
          .mw-nav-right { gap: 14px; }
          .mw-nav-link.hide-mobile { display: none; }
          .mw-disconnect-btn { display: none !important; }
        }
      `}</style>

      <nav className="mw-nav">
        <Link href="/" className="mw-logo">
          Mint<em>ware</em>
        </Link>

        <div className="mw-nav-right">
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, mounted }) => {
              const connected = mounted && account && chain

              if (!mounted) return <div style={{ visibility: 'hidden', height: 36 }} />

              if (connected) {
                return (
                  <>
                    <Link
                      href="/dashboard"
                      className={`mw-nav-link${pathname === '/dashboard' || pathname.startsWith('/campaign') ? ' active' : ''}`}
                    >
                      Earn
                    </Link>
                    <Link
                      href="/leaderboard"
                      className={`mw-nav-link${pathname === '/leaderboard' ? ' active' : ''}`}
                    >
                      Leaderboard
                    </Link>

                    {/* Wallet pill group — pill goes to profile, disconnect appears on hover */}
                    <div className="mw-wallet-wrap">
                      <Link
                        href="/profile"
                        className={`mw-wallet-pill${pathname === '/profile' ? ' active' : ''}`}
                      >
                        <span className="mw-wallet-dot" />
                        {account.displayName}
                      </Link>
                      <button className="mw-disconnect-btn" onClick={handleDisconnect}>
                        ✕ disconnect
                      </button>
                    </div>
                  </>
                )
              }

              return (
                <>
                  <Link
                    href="/explorer"
                    className={`mw-nav-link${pathname === '/explorer' ? ' active' : ''}`}
                  >
                    Explore
                  </Link>
                  <button className="mw-connect-btn" onClick={openConnectModal}>
                    Connect Wallet
                  </button>
                </>
              )
            }}
          </ConnectButton.Custom>
        </div>
      </nav>
    </>
  )
}
