'use client'

// CommandPalette — ⌘K / Ctrl+K quick navigation using cmdk.
// Accessible from anywhere in the app via keyboard shortcut.

import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useDisconnect } from 'wagmi'
import { LayoutDashboard, ArrowLeftRight, Trophy, User, ExternalLink, LogOut, Search } from 'lucide-react'

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

          <Command.Group heading="Navigate">
            <Command.Item onSelect={() => go('/app/vaults')}>
              <div className="cmdk-icon"><LayoutDashboard size={14} /></div>
              Vaults
            </Command.Item>
            <Command.Item onSelect={() => go('/app/swap')}>
              <div className="cmdk-icon"><ArrowLeftRight size={14} /></div>
              Swap
            </Command.Item>
            <Command.Item onSelect={() => go('/agents/leaderboard')}>
              <div className="cmdk-icon"><Trophy size={14} /></div>
              Agent leaderboard
            </Command.Item>
            <Command.Item onSelect={() => go('/app/profile')}>
              <div className="cmdk-icon"><User size={14} /></div>
              Profile
            </Command.Item>
          </Command.Group>

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
