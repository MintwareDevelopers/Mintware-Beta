'use client'

// CommandPalette — ⌘K / Ctrl+K quick navigation using cmdk.
// Accessible from anywhere in the app via keyboard shortcut.

import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useDisconnect } from 'wagmi'
import { LayoutDashboard, ArrowLeftRight, Trophy, User, Plus, ExternalLink, LogOut, Search } from 'lucide-react'

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
          <Search size={15} className="text-mw-ink-3 shrink-0" />
          <Command.Input placeholder="Search pages, actions…" autoFocus />
          <span className="cmdk-shortcut">Esc</span>
        </div>
        <Command.List>
          <Command.Empty>No results.</Command.Empty>

          <Command.Group heading="Navigate">
            <Command.Item onSelect={() => go('/dashboard')}>
              <div className="cmdk-icon"><LayoutDashboard size={14} /></div>
              Dashboard
            </Command.Item>
            <Command.Item onSelect={() => go('/swap')}>
              <div className="cmdk-icon"><ArrowLeftRight size={14} /></div>
              Swap
            </Command.Item>
            <Command.Item onSelect={() => go('/leaderboard')}>
              <div className="cmdk-icon"><Trophy size={14} /></div>
              Leaderboard
            </Command.Item>
            <Command.Item onSelect={() => go('/profile')}>
              <div className="cmdk-icon"><User size={14} /></div>
              Profile
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Actions">
            <Command.Item onSelect={() => go('/create-campaign')}>
              <div className="cmdk-icon"><Plus size={14} /></div>
              Create Campaign
            </Command.Item>
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
            <Command.Item onSelect={() => { setOpen(false); window.open('https://docs.mintware.io', '_blank') }}>
              <div className="cmdk-icon"><ExternalLink size={14} /></div>
              Documentation ↗
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
