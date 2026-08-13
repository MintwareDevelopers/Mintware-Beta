'use client'

// Profile 2.0 · Slice 3 — social links row. Design v2 (soft rounded chips).
// Renders nothing if no socials are set. Handles are stored bare; URLs full.

import type { ProfileSocials as Socials } from '@/lib/rewards/useProfileMeta'

export function ProfileSocials({ socials, className = '' }: { socials?: Socials | null; className?: string }) {
  if (!socials) return null
  const items = [
    socials.twitter   && { href: `https://x.com/${socials.twitter}`,          label: 'X',         icon: '𝕏' },
    socials.farcaster && { href: `https://warpcast.com/${socials.farcaster}`, label: 'Farcaster', icon: '✦' },
    socials.telegram  && { href: `https://t.me/${socials.telegram}`,          label: 'Telegram',  icon: '✈' },
    socials.website   && { href: socials.website,                             label: 'Website',   icon: '🌐' },
  ].filter(Boolean) as { href: string; label: string; icon: string }[]

  if (items.length === 0) return null

  return (
    <div className={`flex gap-1.5 items-center flex-wrap ${className}`}>
      {items.map((i) => (
        <a
          key={i.label}
          href={i.href}
          target="_blank"
          rel="noopener noreferrer"
          title={i.label}
          className="w-7 h-7 rounded-full border border-hair bg-white flex items-center justify-center text-[12px] text-ink-mid no-underline hover:border-[rgba(108,108,240,0.4)] hover:text-peri-deep transition-colors"
        >
          {i.icon}
        </a>
      ))}
    </div>
  )
}
