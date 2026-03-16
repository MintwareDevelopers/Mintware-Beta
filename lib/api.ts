export const API = 'https://attribution-scorer.ceo-1f9.workers.dev'

export function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'k'
  return '$' + n
}

export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

export function shortAddr(addr: string | undefined | null): string {
  return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—'
}

const ICON_PALETTES = [
  { bg: 'rgba(249,115,22,0.12)', fg: '#f97316' },
  { bg: 'rgba(99,102,241,0.12)', fg: '#818cf8' },
  { bg: 'rgba(0,82,255,0.10)',   fg: '#6b9fff' },
  { bg: 'rgba(20,184,166,0.12)', fg: '#14b8a6' },
  { bg: 'rgba(239,68,68,0.10)',  fg: '#ef4444' },
  { bg: 'rgba(234,179,8,0.10)',  fg: '#ca8a04' },
  { bg: 'rgba(124,58,237,0.10)', fg: '#7c3aed' },
  { bg: 'rgba(16,185,129,0.10)', fg: '#10b981' },
]

export function iconColor(name: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return ICON_PALETTES[h % ICON_PALETTES.length]
}
