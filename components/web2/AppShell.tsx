'use client'

// AppShell — the ONE chrome for every workspace under /app (Personal, Team, RWA). Same sidebar, same top
// bar, same wallet control; only the sidebar menu changes with the workspace. Before this, Personal used a
// top-bar layout (MwNav) and Team a sidebar (TeamTerminalShell), so switching felt like leaving the app —
// and Personal showed no section links at all until a wallet connected. The menu is now always there.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { ScopeSwitcher } from '@/components/web2/ScopeSwitcher'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { shortAddr } from '@/lib/web2/api'

const RWA_ON = process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true'

export type ShellNavItem = { href: string; label: string; hint?: string; exact?: boolean }
export type ShellNavGroup = { title?: string; items: ShellNavItem[] }

/** Every /app route renders inside AppShell except the invite-accept page (a standalone handoff). */
export function isAppShellPath(pathname: string | null | undefined): boolean {
  if (!pathname?.startsWith('/app')) return false
  return !/^\/app\/org\/[^/]+\/accept/.test(pathname)
}

function WalletControl() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const { address, isConnected, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!mounted) return <div className="h-9 w-[132px]" />
  if (!isConnected || !address) {
    return (
      <button
        onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })}
        className="glass-pill-primary !py-2 !px-4 text-[13px]"
      >
        Connect
      </button>
    )
  }
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-hair bg-white px-3 py-[7px] text-[12.5px] text-ink hover:border-[rgba(108,108,240,0.35)] cursor-pointer"
      >
        <span className="w-[7px] h-[7px] rounded-full bg-mw-live shrink-0" />
        <span className="font-mono">{shortAddr(address)}</span>
        <span className="text-ink-soft text-[10px]">⌄</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[250] w-[220px] rounded-2xl border border-hair bg-white shadow-lift overflow-hidden text-[13px]">
          <button onClick={() => { navigator.clipboard?.writeText(address); setOpen(false) }} className="w-full text-left px-4 py-2.5 hover:bg-ground-cool cursor-pointer">Copy address</button>
          {privy.authenticated && privy.hasEmbeddedWallet && (
            <button onClick={() => { setOpen(false); privy.linkWallet({ walletChainType: 'ethereum-only' }) }} className="w-full text-left px-4 py-2.5 hover:bg-ground-cool cursor-pointer">Link an external wallet</button>
          )}
          <button onClick={() => { setOpen(false); disconnect(); router.push('/') }} className="w-full text-left px-4 py-2.5 border-t border-hair-soft text-[#D14343] hover:bg-ground-cool cursor-pointer">Disconnect</button>
        </div>
      )}
    </div>
  )
}

export function AppShell({
  groups,
  footer,
  padded = false,
  children,
}: {
  groups: ShellNavGroup[]
  /** Small status card pinned to the bottom of the sidebar. */
  footer?: ReactNode
  /** Wrap content in the standard max-width container (pages that bring their own layout pass false). */
  padded?: boolean
  children: ReactNode
}) {
  const pathname = usePathname() ?? ''
  const all = groups.flatMap((g) => g.items)
  // Longest matching prefix wins, so /app/rwa/wcp7 lights "Willow Creek" and not "Overview".
  const activeHref = all
    .filter((n) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
  const current = all.find((n) => n.href === activeHref)

  const link = (n: ShellNavItem, mobile: boolean) => {
    const on = n.href === activeHref
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={on ? 'page' : undefined}
        className={
          mobile
            ? `shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap no-underline transition-colors ${on ? 'bg-peri text-white' :'text-ink-mid bg-ground-cool'}`
            : `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors ${on ? 'bg-ground-cool text-ink' : 'text-ink-mid hover:text-ink hover:bg-ground-cool/60'}`
        }
      >
        <span className="truncate">{n.label}{mobile && n.hint ? ` · ${n.hint}` : ''}</span>
        {!mobile && n.hint && <span className="text-[10.5px] font-normal text-ink-soft shrink-0">{n.hint}</span>}
      </Link>
    )
  }

  return (
    <div className="min-h-screen flex bg-white text-ink font-atx-display overflow-x-clip">
      <aside className="hidden md:flex flex-col w-[248px] shrink-0 sticky top-0 h-screen bg-[#FAFAFD] border-r border-hair">
        <div className="px-3 pt-3 pb-2.5 flex items-center gap-1.5 border-b border-hair-soft">
          <ScopeSwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col">
          {groups.map((g, i) => (
            <div key={g.title ?? i} className={i ? 'mt-4' : ''}>
              {g.title && <div className="mb-1 px-3 text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-soft">{g.title}</div>}
              <div className="flex flex-col gap-0.5">{g.items.map((n) => link(n, false))}</div>
            </div>
          ))}
        </nav>
        <div className="px-2.5 py-3 border-t border-hair-soft">
          {footer}
          <Link href="/" className="mt-2 flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink-soft no-underline hover:text-ink">
            <MintwareMark size={14} /> mintware.finance
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-[200] bg-white/80 backdrop-blur-[14px] border-b border-hair-soft">
          <div className="flex items-center gap-3 px-6 max-md:px-4 h-[60px]">
            <div className="md:hidden flex items-center gap-1.5 min-w-0 flex-1"><ScopeSwitcher compact /></div>
            <div className="max-md:hidden min-w-0 flex-1 text-[13px] text-ink-soft truncate">{current?.label ?? ''}</div>
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
              title="Command palette (⌘K)"
              className="glass-pill glass-pill-sm !px-3 max-md:hidden"
            >
              ⌘K
            </button>
            <WalletControl />
          </div>
          <nav className="md:hidden flex gap-1.5 px-3 pb-2.5 overflow-x-auto">{all.map((n) => link(n, true))}</nav>
        </header>
        <div className={`flex-1 min-w-0 ${padded ? 'bg-ground-cool' : ''}`}>
          {padded ? <div className="max-w-[1120px] mx-auto px-6 py-8 max-[800px]:px-4 max-[800px]:py-6">{children}</div> : children}
        </div>
      </main>
    </div>
  )
}

/** Personal workspace — retail only (IA audit 2026-10-02): token-issuer flows live in Team, the agent
 *  leaderboard is a public page, and the live LP product (V1 LP Gateway) is linked rather than duplicated. */
export function PersonalShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      groups={[
        { items: [{ href: '/app/account', label: 'Account' }, { href: '/app/swap', label: 'Swap' }] },
        {
          title: 'Earn',
          items: [
            { href: '/app/vaults', label: 'Vaults', hint: 'Testnet' },
            ...(RWA_ON ? [{ href: '/app/rwa-liquidity', label: 'RWA liquidity', hint: 'Testnet' }] : []),
            { href: '/v1', label: 'LP Gateway', hint: 'Live ↗' },
          ],
        },
        { title: 'Agents', items: [{ href: '/app/agents', label: 'Agent account' }] },
      ]}
    >
      {children}
    </AppShell>
  )
}
