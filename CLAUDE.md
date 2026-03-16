# Mintware Phase 1 — Project Context for Claude

## What This Project Is
Mintware is a DeFi reputation + rewards platform with two products:
- **Attribution** (live) — on-chain reputation scoring for wallets across 100+ chains
- **Mintware** (coming soon) — social LP vaults and reward pools weighted by Attribution score

This is the **Phase 1 web app** — a Next.js 16 App Router application migrated from a set of static HTML files.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.1.6 (App Router, Turbopack default) |
| Language | TypeScript 5.7 |
| Wallet | RainbowKit 2 + wagmi 3 + viem 2 |
| Data fetching | @tanstack/react-query 5 |
| Fonts | Plus Jakarta Sans (`--font-jakarta`), DM Mono (`--font-mono`) via `next/font/google` |
| Analytics | @vercel/analytics |
| Package manager | **pnpm** (always use pnpm, never npm/yarn) |
| UI components | shadcn/ui (Radix-based, in `components/ui/`) — **not actively used in app pages** |

---

## Project Structure

```
app/
  layout.tsx              # Root layout — fonts, metadata, <Providers>, <Analytics>
  globals.css             # Minimal reset only (3 lines) — NO Tailwind, stripped intentionally
  page.tsx                # Landing page ('use client')
  page.css                # Landing page styles (extracted from component to avoid Turbopack panic)
  explorer/page.tsx       # Redirects to /explorer.html (D3-based, not yet converted)
  dashboard/page.tsx      # Earn/campaigns dashboard ('use client', auth-guarded)
  leaderboard/page.tsx    # Global leaderboard ('use client', auth-guarded)
  campaign/[id]/page.tsx  # Campaign detail — dynamic route ('use client', auth-guarded)
  profile/page.tsx        # User profile + score ('use client', auth-guarded)

components/
  providers.tsx           # WagmiProvider + QueryClientProvider + RainbowKitProvider
  MwNav.tsx               # Sticky nav — wallet pill → /profile, hover reveals disconnect
  MwAuthGuard.tsx         # Redirects unauthenticated users to /

lib/
  wagmi.ts                # wagmiConfig via getDefaultConfig (RainbowKit)
  api.ts                  # API base URL + shared helpers

public/
  explorer.html           # Static D3 explorer (served as-is)
  mw-auth.js              # Legacy auth helper
  (+ other static HTML pages: how-it-works.html, for-protocols.html, etc.)
```

---

## API

**Base URL:** `https://attribution-scorer.ceo-1f9.workers.dev`
Defined as `export const API` in `lib/api.ts`. Import from there — never hardcode.

### Key endpoints
| Endpoint | Method | Description |
|---|---|---|
| `GET /campaigns` | GET | List all campaigns |
| `GET /campaign?id=&address=` | GET | Single campaign + participant data for a wallet |
| `POST /join` | POST | Join a campaign `{ campaign_id, address }` |
| `GET /leaderboard?campaign_id=` | GET | Leaderboard for a campaign |
| `GET /score?address=` | GET | Full Attribution score profile for a wallet |

### `/score` response shape (used by profile page)
```json
{
  "score": 149,
  "tier": "bronze",
  "percentile": 12,
  "walletAge": "117 months",
  "firstSeen": "Jun 2016",
  "chains": 2,
  "totalTxCount": 168,
  "treeSize": 0,
  "treeQuality": "0.00",
  "totalLo": 710,
  "totalHi": 3250,
  "signals": [
    { "key": "volume", "name": "Volume", "icon": "⇄", "max": 100, "color": "#3A52CC", "score": 41, "insights": ["..."] },
    { "key": "trading", "name": "Trading", "icon": "◈", "max": 75, "color": "#6B8FFF", "score": 24, "insights": ["..."] },
    { "key": "holding", "name": "Holding", "icon": "◆", "max": 100, "color": "#2A9E8A", "score": 39, "insights": ["..."] },
    { "key": "liquidity", "name": "Liquidity", "icon": "⬡", "max": 150, "color": "#C27A00", "score": 0, "insights": ["..."] },
    { "key": "governance", "name": "Governance", "icon": "⊕", "max": 100, "color": "#7B6FCC", "score": 0, "insights": ["..."] },
    { "key": "sharing", "name": "Sharing", "icon": "◉", "max": 400, "color": "#C2537A", "score": 0, "insights": ["..."] }
  ],
  "character": { "label": "Ghost", "color": "#9898C0", "desc": "Opportunistic. Shows up for calm markets, disappears in chaos.", "icon": "○" },
  "uvOpportunities": [
    { "name": "Jupiter", "cat": "Aggr · Solana", "icon": "♃", "type": "PROTOCOL FIT", "typeColor": "#7B6FCC", "accentColor": "#7B6FCC", "mechanic": "...", "lo": 110, "hi": 500, "reason": "HTML string" }
  ],
  "timeline": [{ "date": "2025-04", "score": 40, "events": [] }],
  "projects": [{ "name": "Ether", "symbol": "ETH", "cat": "Token", "deployed": 40 }]
}
```
**Max score = sum of all signal maxes** = 100+75+100+150+100+400 = **925**
**Tier strings from API**: `"bronze"`, `"silver"`, `"gold"` etc. (capitalize for display)

### Shared helpers (from `lib/api.ts`)
- `fmtUSD(n)` — formats numbers as `$2.7k`, `$1.2M`, etc.
- `daysUntil(iso)` — days remaining from ISO date string
- `shortAddr(addr)` — `0x1234…abcd` format
- `iconColor(name)` — deterministic `{ bg, fg }` palette from a string (used for campaign icons)

---

## Wallet / Auth

**Config** (`lib/wagmi.ts`):
- Chains: Mainnet, Base, Arbitrum
- Reown (WalletConnect) project ID: `580f461c981a43d53fc25fe59b64306b`
- SSR: true

**Providers** (`components/providers.tsx`):
```
WagmiProvider → QueryClientProvider → RainbowKitProvider (lightTheme, accentColor #0052FF)
```

**Auth guard** (`components/MwAuthGuard.tsx`):
- Wrap any auth-required page: `<MwAuthGuard><PageContent /></MwAuthGuard>`
- Redirects to `/` if not connected, shows lavender blank during check

**Connect flow:**
Landing page "Connect wallet →" → RainbowKit modal → on connect, button changes to "Go to profile →" → navigates to `/profile`

---

## Navigation (`components/MwNav.tsx`)

- **Logged-out:** shows "Explore" link + "Connect Wallet" button
- **Logged-in:** shows "Earn" (→ /dashboard), "Leaderboard" (→ /leaderboard), wallet pill (→ /profile)
- **Wallet pill:** clicking navigates to `/profile`. Hovering reveals a red "✕ disconnect" button that calls `disconnect()` + `router.push('/')`
- CSS is inline `<style>` inside the component (same pattern as all other pages)
- Active state: `pathname === route` adds `.active` class

---

## CSS Conventions

**All app pages use inline `<style>` blocks** — this was an intentional migration choice to preserve the original HTML designs faithfully. Do not refactor to CSS modules unless asked.

**Exception:** `app/page.tsx` imports `./page.css` (the landing page CSS was extracted to a separate file to work around a Turbopack panic on large template literals).

**Design tokens** (defined in `app/page.css` and repeated per-page):
```css
--blue: #0052FF        /* brand blue */
--ink: #1A1A2E         /* primary text */
--ink-2: #3A3C52       /* secondary text */
--ink-3: #8A8C9E       /* muted text */
--surface: #F7F6FF     /* light lavender background */
--green: #16a34a       /* success / live */
--dark: #0A0D14        /* dark section background */
--font-jakarta         /* CSS variable set by Next.js font */
--font-mono            /* CSS variable set by Next.js font */
```

**Do NOT use Tailwind classes** — `globals.css` has no Tailwind, the PostCSS config has no plugins. The shadcn `components/ui/` components exist but are unused in the main app pages.

---

## Dev Server

**Start command (in Terminal):**
```bash
cd "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build"
pnpm dev
```

**Preview tool (Claude Code internal):** uses `.claude/launch.json` with bash wrapper to set PATH:
```json
{
  "runtimeExecutable": "/bin/bash",
  "runtimeArgs": ["-c", "export PATH=/Users/nicolasrobinson/.nvm/versions/node/v22.22.1/bin:$PATH && node node_modules/next/dist/bin/next dev"]
}
```
This PATH setup is required — without it, Turbopack can't spawn child processes and compilation hangs silently.

**Common issues:**
- `Unable to acquire lock at .next/dev/lock` → another `next dev` is running. Kill with `pkill -f "next dev"` then delete `.next/dev/lock`
- Turbopack panic "Failed to write app endpoint /page" → caused by PostCSS trying to spawn node. Fixed by keeping `globals.css` minimal (no Tailwind imports) and `postcss.config.js` with empty plugins `{}`
- First compile is slow (~10–15s) due to RainbowKit + wagmi dependency graph

---

## Pages Reference

| Route | File | Auth | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | No | Landing — imports `./page.css` |
| `/explorer` | `app/explorer/page.tsx` | No | Server redirect to `/explorer.html` |
| `/dashboard` | `app/dashboard/page.tsx` | Yes | Campaign list, filter by status/chain |
| `/leaderboard` | `app/leaderboard/page.tsx` | Yes | Campaign selector, podium, table |
| `/campaign/[id]` | `app/campaign/[id]/page.tsx` | Yes | `useParams()` for id, join flow via POST |
| `/profile` | `app/profile/page.tsx` | Yes | Score, tier, earnings, tabs |

---

## Pending Work (as of last session)

- [ ] **Waitlist form** — wire up email capture on landing page (currently just UI)
- [ ] **Deploy to Vercel** — not yet deployed
- [ ] **Reown Cloud domain whitelist** — add `localhost:3000` and production domain at cloud.reown.com → project `580f461c981a43d53fc25fe59b64306b`
- [ ] **Explorer page** — `explorer.html` uses D3.js, deferred full React conversion
- [ ] **GitHub repo** — `https://github.com/MintwareDevelopers/Mintware-Beta`

---

## Key Design Decisions

1. **`'use client'` on all pages** — RainbowKit/wagmi hooks require it. No server components in the app directory (except the explorer redirect).
2. **Inline styles over CSS modules** — preserves original HTML design fidelity without renaming classes.
3. **No Tailwind in app pages** — Tailwind is installed as a devDependency but `globals.css` was intentionally stripped. Adding Tailwind back would require fixing PostCSS config.
4. **shadcn/ui components exist but are unused** — they were scaffolded at project init. The app uses custom CSS instead.
5. **Explorer stays static** — D3.js charts are complex; `/explorer` route just redirects to the static HTML file in `/public`.
