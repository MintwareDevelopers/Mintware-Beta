'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useDisconnect } from 'wagmi'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

// Tab base + state classes
const tabBase =
  'inline-flex items-center px-3.5 py-[7px] rounded-[8px] text-[13px] font-medium text-mw-ink-2 no-underline whitespace-nowrap bg-[rgba(26,26,46,0.04)] border border-mw-border transition-all duration-150 cursor-pointer hover:bg-[rgba(26,26,46,0.08)] hover:border-mw-border-strong hover:text-mw-ink'
const tabActive =
  'bg-mw-brand-dim border-[rgba(0,82,255,0.18)] text-mw-brand font-semibold hover:bg-mw-brand-dim'

function tabCls(active: boolean) {
  return active ? `${tabBase} ${tabActive}` : tabBase
}

export function MwNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { disconnect } = useDisconnect()

  function handleDisconnect() {
    disconnect()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-[200] flex items-center justify-between px-12 py-3 bg-white/[0.92] mw-nav-blur border-b border-[rgba(26,26,46,0.07)] max-md:px-5">
      <Link
        href="/"
        className="font-[Georgia,serif] text-[18px] font-bold tracking-[-0.5px] no-underline text-mw-ink shrink-0"
      >
        Mint<em className="not-italic text-mw-brand">ware</em>
      </Link>

      <ConnectButton.Custom>
        {({ account, chain, openConnectModal, mounted }) => {
          const connected = mounted && account && chain

          if (!mounted) return <div className="invisible h-9" />

          if (connected) {
            return (
              <div className="flex items-center gap-2">
                {/* Nav tabs */}
                <div className="flex items-center gap-1 max-[480px]:gap-0.5">
                  <Link
                    href="/dashboard"
                    className={tabCls(
                      pathname === '/dashboard' ||
                        (pathname.startsWith('/campaign') &&
                          !pathname.startsWith('/campaign/generate'))
                    )}
                  >
                    Earn
                  </Link>
                  <Link
                    href="/swap"
                    className={tabCls(pathname === '/swap')}
                  >
                    Swap
                  </Link>
                  <Link
                    href="/leaderboard"
                    className={tabCls(pathname === '/leaderboard')}
                  >
                    Leaderboard
                  </Link>
                  <Link
                    href="/profile"
                    className={tabCls(pathname === '/profile')}
                  >
                    Profile
                  </Link>
                </div>

                {/* Wallet pill — hover swaps name for disconnect */}
                <div
                  className={[
                    'mw-wallet-pill flex items-center gap-2 px-3.5 py-[7px] rounded-[10px] border font-[var(--font-mono),"DM_Mono",monospace] text-xs text-mw-ink-3 cursor-pointer transition-all duration-150 whitespace-nowrap select-none no-underline',
                    pathname === '/profile'
                      ? 'border-[rgba(0,82,255,0.2)] bg-[rgba(0,82,255,0.06)] text-mw-brand'
                      : 'border-mw-border-strong bg-[rgba(26,26,46,0.03)]',
                    'hover:border-[rgba(239,68,68,0.3)] hover:text-red-600 hover:bg-[rgba(239,68,68,0.04)]',
                  ].join(' ')}
                  onClick={handleDisconnect}
                  title="Click to disconnect"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-mw-green shrink-0 animate-mw-pulse" />
                  <span className="mw-label">{account.displayName}</span>
                  <span className="mw-disconnect hidden text-red-600 font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] text-[10px]">
                    ✕ disconnect
                  </span>
                </div>
              </div>
            )
          }

          return (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Link
                  href="/explorer"
                  className={tabCls(pathname === '/explorer')}
                >
                  Explorer
                </Link>
              </div>
              <button
                className="px-5 py-2 rounded-[10px] bg-mw-brand text-white border-none text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-all duration-150 whitespace-nowrap hover:bg-[#0040cc] hover:-translate-y-px"
                onClick={openConnectModal}
              >
                Connect Wallet
              </button>
            </div>
          )
        }}
      </ConnectButton.Custom>
    </nav>
  )
}
