'use client'

// CommandPalette — ⌘K / Ctrl+K quick navigation using cmdk.
// Accessible from anywhere in the app via keyboard shortcut.

import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useDisconnect } from 'wagmi'
import { ExternalLink, LogOut, Search } from 'lucide-react'

// Mirrors the AppShell workspace menus (Personal / Team), so ⌘K never offers a page the sidebar doesn't.
const GROUPS: { heading: string; items: { href: string; label: string; external?: boolean }[] }[] = [
  { heading: 'Personal', items: [
    { href: '/app/markets', label: 'Markets' }, { href: '/app/portfolio', label: 'Portfolio' }, { href: '/app/swap', label: 'Swap' },
    { href: '/app/rwas', label: 'Property market (demo)' }, { href: '/app/rwas/proof', label: 'Property market proof' },
  ] },
  { heading: 'Previews', items: [
    { href: '/app/previews/card', label: 'Card' }, { href: '/app/previews/agents', label: 'Agents' }, { href: '/app/previews/issuers', label: 'Issuers' },
  ] },
  { heading: 'Team', items: [
    { href: '/app/team', label: 'Treasury overview' },
    { href: '/app/team/cards', label: 'Cards & Spend' }, { href: '/app/org/new', label: 'Create organization' },
  ] },
  { heading: 'Public', items: [{ href: '/agents/leaderboard', label: 'Agent leaderboard', external: true }] },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { disconnect } = useDisconnect()

  // Open on ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const go = useCallback((href: string) => {
    setOpen(false)
    router.push(href)
  }, [router])

  if (!open) return null

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <Command
        className="cmdk-dialog"
        onClick={e => e.stopPropagation()}
        label="Command palette"
      >
        <div className="cmdk-input-wrap">
          <Search size={15} className="text-ink-soft shrink-0" />
          <Command.Input placeholder="Search pages, actions…" autoFocus />
          <span className="cmdk-shortcut">Esc</span>
        </div>
        <Command.List>
          <Command.Empty>No results.</Command.Empty>

          {GROUPS.map((g) => (
            <Command.Group key={g.heading} heading={g.heading}>
              {g.items.map((it) => (
                <Command.Item key={it.href} value={`${g.heading} ${it.label}`} onSelect={() => go(it.href)}>
                  <div className="cmdk-icon">{it.external ? <ExternalLink size={14} /> : <span className="text-[11px] font-semibold">{g.heading[0]}</span>}</div>
                  {it.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}

          <Command.Group heading="Actions">
            <Command.Item onSelect={() => {
              setOpen(false)
              disconnect()
              router.push('/')
            }}>
              <div className="cmdk-icon"><LogOut size={14} /></div>
              Disconnect Wallet
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Links">
            <Command.Item onSelect={() => { setOpen(false); router.push('/docs') }}>
              <div className="cmdk-icon"><ExternalLink size={14} /></div>
              Documentation
            </Command.Item>
          </Command.Group>
        </Command.List>

        <div className="cmdk-footer">
          <span><span className="cmdk-kbd">↑↓</span> navigate</span>
          <span><span className="cmdk-kbd">↵</span> select</span>
          <span><span className="cmdk-kbd">⌘K</span> toggle</span>
        </div>
      </Command>
    </div>
  )
}
