# Code Style

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.1.6 (App Router, Turbopack default in dev) |
| Language | TypeScript 5.7 |
| Styling | Tailwind CSS v4 (all pages); inline `<style>` blocks only in legacy components |
| Fonts | Plus Jakarta Sans (`--font-jakarta`), DM Mono (`--font-mono`) via `next/font/google` |
| Package manager | **pnpm** — always, never npm/yarn |

## CSS Convention

**All app pages use Tailwind v4 utility classes** — `bg-mw-bg`, `text-mw-brand`, `font-sans`, `font-mono`, etc.

Do NOT use inline `<style>` blocks for new pages. The dashboard (`app/(rewards)/dashboard/page.tsx`) is the canonical reference.

Shared component classes defined in `app/globals.css` `@layer components`:
- `mw-hero-gradient` — dark navy gradient hero card (flips ink tokens to white)
- `mw-accent-card` — light blue-tinted card with accent border
- `mw-accent-pill` — inactive pill button (blue-tinted)
- `mw-accent-bg` — background-only tint
- `lb-table`, `lb-row`, `lb-row-me`, `lb-td`, `lb-right`, `lb-pts-col` — leaderboard table
- `mw-pill-live`, `mw-pill-ended`, `mw-pill-soon` — status badges
- `mw-label` — all-caps section label (11px, 600w, 1.5px spacing)
- `mw-shimmer` — skeleton shimmer animation
- `mw-grid-overlay` — grid pattern overlay for dark sections

## Color Tokens

Use `var(--token)` or Tailwind `text-mw-*` / `bg-mw-*` — never hardcode hex.

| Token | Value | Tailwind class | Usage |
|---|---|---|---|
| `--color-mw-brand` | `#4f7ef7` | `text-mw-brand` / `bg-mw-brand` | Nav, buttons, primary |
| `--color-mw-brand-dim` | `rgba(79,126,247,0.07)` | `bg-mw-brand-dim` | Subtle brand tint |
| `--color-mw-brand-mid` | `rgba(79,126,247,0.14)` | — | Mid brand tint |
| `--color-mw-brand-vivid` | `#2563EB` | — | Primary CTAs (Connect Wallet) |
| `--color-mw-brand-deep` | `#3A5CE8` | — | Referral/campaign UI — do NOT merge with brand |
| `--color-mw-ink` | `#1a1a1a` | `text-mw-ink` | Primary text |
| `--color-mw-ink-2` | `#3d3d3d` | `text-mw-ink-2` | Secondary text |
| `--color-mw-ink-3` | `#6b7280` | `text-mw-ink-3` | Muted text |
| `--color-mw-ink-4` | `#8A8C9E` | `text-mw-ink-4` | Lightest muted — referral UI |
| `--color-mw-ink-5` | `#9ca3af` | `text-mw-ink-5` | Extra light — dashboard/leaderboard |
| `--color-mw-bg` | `#F8F9FC` | `bg-mw-bg` | App page background |
| `--color-mw-surface` | `#f5f5f7` | — | Default surface |
| `--color-mw-surface-card` | `#f9f9fb` | — | Dashboard/leaderboard cards |
| `--color-mw-surface-purple` | `#F7F6FF` | — | Referral/campaign light bg |
| `--color-mw-green` | `#16a34a` | `text-mw-green` | Earnings/success text |
| `--color-mw-live` | `#22c55e` | `text-mw-live` / `bg-mw-live` | Live indicator dot — do NOT merge with green |
| `--color-mw-pink` | `#C2537A` | `text-mw-pink` | Sharing/referral |
| `--color-mw-teal` | `#2A9E8A` | `text-mw-teal` | Holding/success teal |
| `--color-mw-amber` | `#C27A00` | `text-mw-amber` | Pending/liquidity |
| `--color-mw-red` | `#ef4444` | `text-mw-red` | Error/disconnect |
| `--color-mw-border` | `rgba(0,0,0,0.07)` | — | Default border |
| `--color-mw-border-strong` | `rgba(0,0,0,0.13)` | — | Strong border |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,0.06)...` | `shadow-card` | Card shadow |
| `--shadow-card-hover` | `0 8px 24px rgba(0,0,0,0.08)...` | `shadow-card-hover` | Card hover shadow |

> **Two blues:** `--color-mw-brand` (#4f7ef7) = nav/dashboard. `--color-mw-brand-deep` (#3A5CE8) = referral/campaign. Never merge.
> **Two greens:** `--color-mw-green` = earnings text. `--color-mw-live` = live dot. Never merge.

## Radius / Shadow Tokens

| Token | Value |
|---|---|
| `--radius-sm` | `8px` |
| `--radius-md` | `12px` |
| `--radius-lg` | `16px` |
| `--radius-xl` | `20px` |
| `--radius-2xl` | `24px` |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.07)` |
| `--shadow-feature` | `0 16px 48px rgba(0,0,0,0.10)...` |

## Fonts

- `Plus Jakarta Sans` (`font-sans`) — UI labels, body
- `DM Mono` (`font-mono`) — addresses, codes, large numbers

## Section Label Pattern

```tsx
<div className="text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans">
  Section title
</div>
```

## Dev Server

```bash
cd "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build"
pnpm dev
```

Preview tool uses `.claude/launch.json` — PATH must include nvm node for Turbopack child processes.

Common: `Unable to acquire lock at .next/dev/lock` → `pkill -f "next dev"` then delete `.next/dev/lock`

## Mineral (2026-10 redesign — branch `feat/mineral-redesign`)

Light and tactile. Tokens are `--mw-*` CSS variables in `app/globals.css` (ground `#F6F6FA`, ink `#15151D`,
ink-2 `#454552`, ink-3 `#62626F`, button `#5B5BE6`). Surfaces: `.mw-raise` / `.mw-raise-sm` / `.mw-raise-lg` for
things you act on, `.mw-inset` for places you put something (inputs, tab wells, stats inside a card). Buttons are
SOLID periwinkle (`.mw-btn`, white text) or white (`.mw-btn-quiet`) — never gradient. `--mw-sheen` is only for the
hero object and soft background light. Fonts: Geist (`font-geist`) for UI/display, Geist Mono (`font-geist-mono`,
and every `.font-mono` inside `.v1-app`) for figures. V1 primitives: `PLAIN` (raised), `INSET`, `GlassFrame`
(raised data card). Landing: `app/page.tsx` + `components/marketing/mineral/*`; mark: `components/ui2/MineralMark`.
Custom icons: `components/ui2/MineralIcons.tsx` (disc/layer line icons — use these, not generic icon packs, on
Mineral surfaces). Status textures: `.mw-tex-dots` (building) and `.mw-tex-hatch` (planned) — plain global rules in
`globals.css`, deliberately NOT inside `@layer utilities` (Tailwind v4 did not emit them from there).

**Site-wide rollout (same branch).** Every page now sits on Mineral, not just the landing:
- Geist is the body font everywhere: the theme `--font-sans` / `--font-mono` are re-pointed on `body`, and DM Mono is no longer loaded. `font-atx-display` / `font-atx-mono` resolve to Geist and Geist Mono.
- The v2 colour tokens (`ink`, `peri`, `ground-cool` and the rest) and the legacy `mw-*` brand/ink tokens are remapped to Mineral values.
- The v2 classes keep their names but have Mineral styling: `glass-pill` is a quiet raised button, `glass-pill-primary` is solid periwinkle, `glass-card` / `soft-card` are raised white surfaces, and `live-chip` is a band pill.
- `MintwareMark` now draws the disc stack, so every surface shows one logo.

Shared pieces:
- Marketing pages use the `components/marketing/Story.tsx` kit (`Page`, `Hero` on a halo, `Rows` with an optional icon, `IconTile`, `Kicker`, `CTA`).
- `GradientPanel` is now a lit inset well rather than a mesh gradient.
- `FlowDiagram` is raised step cards joined by arrows.
- `V2Nav` is the one public header on every marketing page, the landing included (Markets, RWAs, Issuers, Card, Agents, Docs; the current page is found from the path; a menu button below 960px). The app uses `AppShell`; `MwNav` remains only on the invite-accept handoff.

New helpers: `.mw-btn-lg` (54px hero button) and `.mw-range` (inset slider track; set `--mw-fill`). For new code, prefer the `mw-*` classes over the legacy names.
