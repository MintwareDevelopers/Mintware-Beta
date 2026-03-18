# Mintware Phase 1 — Project Context for Claude

## What This Project Is
Mintware is a DeFi reputation + rewards platform with two products:
- **Attribution** (live) — on-chain reputation scoring for wallets across 100+ chains
- **Mintware** (coming soon) — social LP vaults and reward pools weighted by Attribution score

This is the **Phase 1 web app** — a Next.js 16 App Router application.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.1.6 (App Router, Turbopack default) |
| Language | TypeScript 5.7 |
| Wallet | RainbowKit 2 + wagmi 3 + viem 2 |
| Data fetching | @tanstack/react-query 5 |
| Styling | Tailwind CSS v4 (landing page); inline `<style>` blocks (all other app pages) |
| Database | Supabase (`@supabase/ssr` v0.9.0) — referral system |
| Fonts | Plus Jakarta Sans (`--font-jakarta`), DM Mono (`--font-mono`) via `next/font/google` |
| Analytics | @vercel/analytics |
| Package manager | **pnpm** (always use pnpm, never npm/yarn) |
| UI components | shadcn/ui (Radix-based, in `components/ui/`) — **not actively used in app pages** |

---

## Project Structure

```
app/
  layout.tsx              # Root layout — fonts, metadata, <Providers>, <Analytics>
  globals.css             # Minimal reset only — Tailwind base imported here
  page.tsx                # Landing page ('use client') — uses Tailwind CSS v4
  explorer/page.tsx       # Redirects to /explorer.html (D3-based, not yet converted)
  dashboard/page.tsx      # Earn/campaigns dashboard ('use client', auth-guarded)
  leaderboard/page.tsx    # Global leaderboard ('use client', auth-guarded)
  swap/page.tsx           # Swap page — 0x/Molten routing, campaign rewards, Core chain
  campaign/[id]/page.tsx  # Campaign detail — dynamic route ('use client', auth-guarded)
  profile/page.tsx        # User profile + score ('use client', auth-guarded)
  api/
    referral/route.ts     # GET /api/referral?address=, POST /api/referral/generate

components/
  providers.tsx           # WagmiProvider + QueryClientProvider + RainbowKitProvider
  MwNav.tsx               # Sticky nav — boxy tab style, wallet pill → /profile
  MwAuthGuard.tsx         # Redirects unauthenticated users to /
  referral/
    RefCodeInput.tsx      # Read-only copy input — "Copied!" for 2s
    ReferralSheet.tsx     # First-connect slide-up bottom sheet
    InviteTab.tsx         # Invite tab content — renders immediately from wallet address

lib/
  wagmi.ts                # wagmiConfig via getDefaultConfig (RainbowKit)
  api.ts                  # API base URL + shared helpers
  supabase.ts             # createSupabaseBrowserClient() factory
  referral/
    types.ts              # ReferralStats, ReferralRecord, WalletProfile
    utils.ts              # generateRefCode(), truncateAddress()
    useReferral.ts        # Core referral hook

public/
  explorer.html           # Static D3 explorer — no nav, logo-only back button
  mw-auth.js              # Legacy auth helper
  (+ other static HTML pages)
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

## Referral System

Supabase tables (already exist, no migrations needed):
- `wallet_profiles` — one row per wallet: `address`, `ref_code`, `last_seen_at`
- `referral_records` — `referrer`, `referred`, `ref_code`, `status` (`pending` | `active`)
- `referral_stats` — VIEW: `address`, `ref_code`, `ref_link`, `tree_size`, `tree_quality`, `sharing_score`

**Key convention:** `ref_code` is **deterministic** — `"mw_" + address.slice(2, 8).toLowerCase()`. Never depends on Supabase to compute it.

**`useReferral(address)` hook flow:**
1. Captures `?ref=` URL param → `sessionStorage["mw_pending_ref"]`
2. Upserts `wallet_profiles` on connect
3. If new wallet + pending ref → inserts `referral_records`
4. Fetches `referral_stats` view
5. Subscribes to Supabase Realtime on `referral_records` for live updates

**`InviteTab`** renders immediately from wallet address — ref code/link are computed locally. Supabase stats (sharing score, network size) load in as enhancement — tab never shows an error state.

**`ReferralSheet`** slides up 1.5s after first wallet connect. Dismissed state in `localStorage["mw_ref_sheet_dismissed"]`.

**API routes** (`app/api/referral/route.ts`):
- `GET /api/referral?address=` — reads `referral_stats` (anon key)
- `POST /api/referral/generate` — upserts `wallet_profiles`, returns stats (service role key)

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

---

## Navigation (`components/MwNav.tsx`)

- **Logged-out:** "Connect Wallet" button only
- **Logged-in:** boxy tab-style nav — "Earn" (→ /dashboard), "Swap" (→ /swap), "Leaderboard" (→ /leaderboard), "Profile" (→ /profile), wallet pill
- **Wallet pill:** hover reveals red "✕ disconnect" → calls `disconnect()` + `router.push('/')`
- CSS is inline `<style>` inside the component

---

## CSS Conventions

**Landing page (`app/page.tsx`)** — uses **Tailwind CSS v4** utility classes directly in JSX. No separate CSS file.

**All other app pages** — use inline `<style>` blocks. Do not refactor to CSS modules or Tailwind unless asked.

**Design tokens:**
```
#F7F6FF   surface / background
#1A1A2E   ink (primary text)
#3A3C52   ink-2 (secondary text)
#8A8C9E   ink-3 (muted text)
#3A5CE8   primary blue
#C2537A   sharing/referral pink
#2A9E8A   green (success/active)
Plus Jakarta Sans — UI labels, body
DM Mono   — addresses, codes, numbers
```

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
- First compile is slow (~10–15s) due to RainbowKit + wagmi dependency graph

---

## Pages Reference

| Route | File | Auth | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | No | Landing — Tailwind CSS v4 |
| `/explorer` | `app/explorer/page.tsx` | No | Redirects to `/explorer.html` |
| `/dashboard` | `app/dashboard/page.tsx` | Yes | Campaign list, filter by status/chain |
| `/leaderboard` | `app/leaderboard/page.tsx` | Yes | Campaign selector, podium, table |
| `/swap` | `app/swap/page.tsx` | Yes | 0x/Molten routing, campaign rewards |
| `/campaign/[id]` | `app/campaign/[id]/page.tsx` | Yes | `useParams()` for id, join flow via POST |
| `/profile` | `app/profile/page.tsx` | Yes | Score, tier, tabs: Portfolio / Score / Badge / Invite |

---

## Campaign Engine (branch: feature/campaign-engine)

Source of truth: `mintware_campaign_logic_model.docx` (in Downloads).

### Two campaign types

| | Token Reward Pool | Points Campaign |
|---|---|---|
| Created by | Anyone (self-serve) | Whitelisted teams only |
| Reward trigger | Per swap transaction | Per epoch distribution |
| Score multipliers | No | Yes — Attribution + Sharing |
| Platform fee | 2% per tx | Flat sponsorship fee (B2B) |
| Pool | Depletes until empty | Fixed, epoch-split |
| Access | Open | `min_score` gated |

### Score multipliers (Points Campaign)

| Percentile | Attribution | Sharing |
|---|---|---|
| 0–33% | 1.0× | 1.0× |
| 34–66% | 1.25× | 1.15× |
| 67–100% | 1.5× | 1.3× |

Combined multiplier is multiplicative: `attribution_multiplier × sharing_multiplier` (max 1.95×).

### Actions (dynamic per campaign)
- `bridge` — 15 pts, one-time per wallet
- `trade` — 8 pts, once per calendar day
- `referral_bridge` — 60 pts per referred wallet that bridges
- `referral_trade` — 8 pts per referred wallet per trading day

### Epoch reward formula
```
wallet_payout = (epoch_pool / epoch_count) × (wallet_points / total_points) × combined_multiplier
```

### Supabase migration: `supabase/migrations/20260317000001_campaign_engine_schema.sql`
Three new tables added in Ticket 1:

**`pending_rewards`** — Token Reward Pool per-tx reward locks
- One row per reward type (`buyer`, `referrer`, `platform_fee`) per `tx_hash`
- Unique index on `(tx_hash, reward_type)` prevents double-crediting
- `claimable_at = now() + claim_duration_mins`; status: `locked → claimable → claimed`

**`distributions`** — Points Campaign Merkle epoch distribution records
- One row per `(campaign_id, epoch_number)`
- `merkle_root` + `ipfs_cid` set at publish time; `tx_hash` confirms on-chain settlement
- status: `pending → published → finalized`

**`epoch_state`** — Current epoch window + running point accumulator
- Unique partial index on `campaign_id where status = 'active'` enforces one active epoch per campaign
- `total_points` incremented in real-time as actions are credited
- status: `active → settling → complete`; `updated_at` auto-maintained by trigger

**Tables NOT yet added (future tickets):**
- `participants` — joined wallets per campaign
- `activity` — per-action point credit ledger (with `tx_hash` uniqueness)
- `daily_payouts` — per-wallet epoch payout history

---

## Contract Infrastructure (Ticket 5 — complete)

### Files
| File | Purpose |
|---|---|
| `contracts/MintwareDistributor.sol` | On-chain Merkle drop settlement contract |
| `contracts/MockERC20.sol` | Test-only ERC-20 (mintable, dev only) |
| `contracts/test/MintwareDistributor.test.cjs` | 32-test Hardhat suite |
| `hardhat.config.cts` | Hardhat config (`.cts` = TypeScript CJS, required with `"type":"module"`) |
| `tsconfig.hardhat.json` | Separate TS config for Hardhat (module: commonjs, not bundler) |
| `scripts/deploy.cjs` | Deploy + auto-verify on Base/CoreDAO/BNB |

### Running tests
```bash
pnpm hardhat:test          # 32 tests, all passing
pnpm hardhat:compile       # Compile + typechain
```
`TS_NODE_PROJECT=tsconfig.hardhat.json` prefix is baked into all `hardhat:*` scripts in package.json — required because the root tsconfig uses `moduleResolution: bundler` which is incompatible with Hardhat.

### Deploy targets
```bash
pnpm hardhat:deploy:base-sepolia   # Base Sepolia (84532) — testnet
pnpm hardhat:deploy:base           # Base mainnet (8453)
pnpm hardhat:deploy:core-dao       # Core DAO (1116)
pnpm hardhat:deploy:bnb            # BNB Chain (56)
```
After deploy: set `NEXT_PUBLIC_MW_TREASURY_ADDRESS` in `.env.local` and update `campaigns.contract_address` in Supabase.

### Leaf encoding — verified
Both sides produce identical leaf hashes:
- **Solidity**: `keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))`
- **TypeScript**: `StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])` — `standardLeafHash = keccak256(keccak256(abi.encode(...)))`

Uses `abi.encode` (64-byte padded), NOT `abi.encodePacked` (52 bytes). Critical — mismatch causes all claims to revert.

### ESM/CJS notes (for future debugging)
The project has `"type": "module"` in `package.json`, which creates Hardhat compatibility issues:
- Config must be `.cts` (not `.ts`) — `.cts` forces CJS loading, Hardhat's `isRunningWithTypescript()` recognises it
- Test files must be `.cjs` — Mocha 10.x with `"type":"module"` calls `import()` first; `.cjs` imports work via Node's CJS-in-ESM bridge; `.ts`/`.cts` test files don't
- `TS_NODE_PROJECT=tsconfig.hardhat.json` must be set — prevents ts-node from picking up root tsconfig (`moduleResolution: bundler` breaks Hardhat)

---

## Pending Work

- [ ] **Ticket 6** — Claim API endpoint: `GET /api/claim?address=&distribution_id=` (returns proof + amount), `POST /api/claim` (executes on-chain). `computeLeaf()` view function is already exposed for proof verification.
- [ ] **`CORE_DAO_BRIDGE_CONTRACT`** — still `0x__PENDING_MOLTEN_CONFIRMATION__` in `.env.local`. Update when Molten confirms the bridge contract address.
- [ ] **Waitlist form** — wire up email capture on landing page (UI exists, not wired)
- [ ] **Deploy to Vercel** — not yet deployed
- [ ] **Reown Cloud domain whitelist** — add `localhost:3000` and production domain at cloud.reown.com → project `580f461c981a43d53fc25fe59b64306b`
- [ ] **Explorer page** — `explorer.html` uses D3.js, deferred full React conversion
- [ ] **GitHub repo** — `https://github.com/MintwareDevelopers/Mintware-Beta`

---

## Key Design Decisions

1. **`'use client'` on all pages** — RainbowKit/wagmi hooks require it. No server components in the app directory (except the explorer redirect).
2. **Inline styles on app pages** — preserves original HTML design fidelity. Landing page is the exception (Tailwind v4).
3. **shadcn/ui components exist but are unused** — scaffolded at project init; app uses custom CSS instead.
4. **Explorer stays static** — D3.js charts are complex; `/explorer` route redirects to the static HTML file in `/public`. Nav removed from explorer.html; logo-only back link to `/` added.
5. **ref_code is deterministic** — computed from wallet address, never depends on a database round-trip. InviteTab always renders immediately.
