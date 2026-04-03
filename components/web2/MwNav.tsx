'use client'

import { ConnectButton }      from '@rainbow-me/rainbowkit'
import { useWallet }          from '@solana/wallet-adapter-react'
import { useWalletModal }     from '@solana/wallet-adapter-react-ui'
import { useDisconnect }      from 'wagmi'
import Link                   from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { solanaEnabled }      from '@/lib/web3/featureFlags'
import { useMintwarePrivy }   from '@/components/web2/providers'

import '@solana/wallet-adapter-react-ui/styles.css'

function shortSol(addr: string) {
  return addr.slice(0, 4) + '…' + addr.slice(-4)
}

export function MwNav() {
  const pathname = usePathname()
  const router = useRouter()

  const { disconnect: evmDisconnect } = useDisconnect()
  const { connected: solConnected, publicKey, disconnect: solDisconnect } = useWallet()
  const { setVisible: openSolanaModal } = useWalletModal()
  const privy = useMintwarePrivy()

  async function disconnectEvmSession() {
    evmDisconnect()
    if (privy.authenticated) {
      await privy.logout()
    }
    router.push('/')
  }

  function openPrivyOnboarding() {
    if (privy.authenticated) {
      privy.connectOrCreateWallet()
      return
    }

    privy.login({
      loginMethods: ['email'],
      walletChainType: 'ethereum-only',
    })
  }

  const isActive = (path: string) =>
    pathname === path || (path === '/dashboard' && pathname.startsWith('/campaign'))

  const NAV_LINKS = [
    { href: '/dashboard', label: 'Earn' },
    { href: '/swap', label: 'Swap' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/agents', label: 'Agents' },
    { href: '/profile', label: 'Profile' },
  ]

  return (
    <nav className="sticky top-0 z-[200] flex items-center justify-between px-7 h-[49px] bg-[rgba(255,255,255,0.92)] backdrop-blur-[12px] border-b border-[0.5px] border-mw-border">
      <Link
        href="/"
        className="text-[19px] font-extrabold tracking-[-0.6px] no-underline text-mw-ink shrink-0 font-sans"
      >
        mint<span className="text-mw-brand">ware</span>
      </Link>

      <ConnectButton.Custom>
        {({ account, chain, openConnectModal, mounted }) => {
          const evmConnected = mounted && !!account && !!chain
          const isConnected = evmConnected || solConnected

          if (!mounted) return <div className="h-9 w-[200px]" />

          if (isConnected) {
            return (
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-0.5">
                  {NAV_LINKS.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className={[
                        'mw-nav-link',
                        'px-[14px] py-[7px] rounded-xl text-[13px] no-underline whitespace-nowrap font-sans',
                        'transition-colors duration-150',
                        'hover:bg-mw-surface hover:text-mw-ink',
                        isActive(href)
                          ? 'font-semibold text-mw-brand bg-mw-brand-dim'
                          : 'font-normal text-mw-ink-3 bg-transparent',
                      ].join(' ')}
                    >
                      {label}
                    </Link>
                  ))}

                  <span
                    className="flex items-center gap-[5px] px-[14px] py-[7px] rounded-xl text-[13px] whitespace-nowrap font-sans font-normal text-mw-ink-5 cursor-default select-none"
                    title="Vaults launching soon"
                  >
                    Vaults
                    <span style={{
                      fontSize: '9px', fontWeight: 600, letterSpacing: '0.5px',
                      textTransform: 'uppercase', background: 'var(--color-mw-brand-dim)',
                      color: 'var(--color-mw-brand)', borderRadius: '4px',
                      padding: '1px 5px', lineHeight: '14px',
                    }}>
                      Soon
                    </span>
                  </span>
                </div>

                <button
                  onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
                  title="Command palette (⌘K)"
                  className="ml-[6px] flex items-center gap-[5px] px-[10px] py-[5px] rounded-sm text-[11px] border-[0.5px] border-mw-border bg-mw-surface cursor-pointer text-mw-ink-3 font-mono transition-colors duration-150 hover:border-[rgba(79,126,247,0.35)] hover:text-mw-brand"
                >
                  ⌘K
                </button>

                {evmConnected && (
                  <div
                    className="mw-wallet-pill ml-2 flex items-center gap-[6px] px-[14px] py-[7px] rounded-xl text-[12px] border-[0.5px] border-mw-border-strong bg-white cursor-pointer text-mw-ink font-mono select-none transition-all duration-150 hover:border-[rgba(239,68,68,0.3)] hover:text-mw-red hover:bg-[rgba(239,68,68,0.04)]"
                    onClick={() => { void disconnectEvmSession() }}
                    title="Click to disconnect EVM wallet"
                  >
                    <span className="w-[6px] h-[6px] rounded-full bg-mw-live shrink-0" />
                    <span className="mw-label">{account.displayName}</span>
                    <span className="mw-disconnect text-mw-red font-sans text-[11px]">✕</span>
                  </div>
                )}

                {solanaEnabled && solConnected && publicKey && (
                  <div
                    className="mw-wallet-pill ml-1 flex items-center gap-[6px] px-[14px] py-[7px] rounded-xl text-[12px] border-[0.5px] border-mw-border-strong bg-white cursor-pointer text-mw-ink font-mono select-none transition-all duration-150 hover:border-[rgba(239,68,68,0.3)] hover:text-mw-red hover:bg-[rgba(239,68,68,0.04)]"
                    onClick={() => { solDisconnect(); if (!evmConnected) router.push('/') }}
                    title="Click to disconnect Solana wallet"
                  >
                    <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: '#9945FF' }} />
                    <span className="mw-label">{shortSol(publicKey.toBase58())}</span>
                    <span className="mw-disconnect text-mw-red font-sans text-[11px]">✕</span>
                  </div>
                )}

                {solanaEnabled && evmConnected && !solConnected && (
                  <button
                    onClick={() => openSolanaModal(true)}
                    className="ml-1 px-3 py-[6px] rounded-xl text-[11px] font-semibold border-[0.5px] cursor-pointer font-sans transition-all duration-150"
                    style={{
                      background: 'rgba(153,69,255,0.06)',
                      border: '0.5px solid rgba(153,69,255,0.2)',
                      color: '#9945FF',
                    }}
                    title="Link your Solana wallet"
                  >
                    + Solana
                  </button>
                )}

                {evmConnected && privy.authenticated && privy.hasEmbeddedWallet && (
                  <button
                    onClick={() => privy.linkWallet({ walletChainType: 'ethereum-only' })}
                    className="ml-1 px-3 py-[6px] rounded-xl text-[11px] font-semibold border-[0.5px] cursor-pointer font-sans transition-all duration-150"
                    style={{
                      background: 'rgba(37,99,235,0.06)',
                      border: '0.5px solid rgba(37,99,235,0.2)',
                      color: '#2563EB',
                    }}
                    title="Link an external EVM wallet to this Privy session"
                  >
                    + EVM
                  </button>
                )}
              </div>
            )
          }

          return (
            <div className="flex items-center gap-2">
              <Link
                href="/explorer"
                className="mw-nav-link px-[14px] py-[7px] rounded-xl text-[13px] text-mw-ink-3 no-underline font-sans transition-colors duration-150 hover:bg-mw-surface hover:text-mw-ink"
              >
                Explorer
              </Link>
              {privy.enabled && (
                <button
                  onClick={openPrivyOnboarding}
                  className="px-4 py-2 rounded-xl border text-[13px] font-semibold cursor-pointer font-sans transition-all duration-150 bg-white text-[#2563EB] border-[rgba(37,99,235,0.18)] hover:border-[rgba(37,99,235,0.3)] hover:bg-[rgba(37,99,235,0.04)]"
                >
                  Continue with Email
                </button>
              )}
              {solanaEnabled && (
                <button
                  onClick={() => openSolanaModal(true)}
                  className="px-4 py-2 rounded-xl border-0 text-[13px] font-semibold cursor-pointer font-sans transition-all duration-150"
                  style={{
                    background: 'rgba(153,69,255,0.08)',
                    border: '1px solid rgba(153,69,255,0.2)',
                    color: '#9945FF',
                  }}
                >
                  Solana
                </button>
              )}
              <button
                onClick={openConnectModal}
                className="px-4 py-2 rounded-xl bg-[#2563EB] text-white border-0 text-[13px] font-semibold cursor-pointer font-sans"
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
