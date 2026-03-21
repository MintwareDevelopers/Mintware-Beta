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
  globals.css             # Tailwind base + full @theme token system + @layer components classes
  page.tsx                # Landing page ('use client') — uses Tailwind CSS v4
  explorer/page.tsx       # Redirects to /explorer.html (D3-based, not yet converted)
  dashboard/page.tsx      # Earn/campaigns dashboard ('use client', auth-guarded)
  leaderboard/page.tsx    # Global leaderboard ('use client', auth-guarded)
  swap/page.tsx           # Swap page — 0x/Molten routing, campaign rewards, Core chain
  campaign/[id]/page.tsx  # Campaign detail — dynamic route ('use client', auth-guarded)
  profile/page.tsx        # User profile + score ('use client', auth-guarded)
  api/
    referral/route.ts         # GET /api/referral?address=, POST /api/referral
    referral/apply/route.ts   # POST /api/referral/apply — time-gated referral insert
    swap/quote/route.ts       # POST /api/swap/quote — LI.FI proxy (hides API key, enforces fee)
    campaigns/swap-event/route.ts  # POST — on-chain tx verification before reward credit

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

**Design tokens are CSS custom properties defined in `app/globals.css` `@theme` block.** Always use `var(--token)` references — never hardcode hex values. The token system works for both Tailwind v4 utility classes and inline `<style>` blocks.

### Color tokens

| Token | Value | Usage |
|---|---|---|
| `--color-mw-brand` | `#4f7ef7` | Nav, buttons, landing page |
| `--color-mw-brand-dim` | `rgba(79,126,247,0.07)` | Subtle brand tint |
| `--color-mw-brand-mid` | `rgba(79,126,247,0.14)` | Mid brand tint |
| `--color-mw-brand-deep` | `#3A5CE8` | Referral/campaign UI (distinct blue — do NOT merge with brand) |
| `--color-mw-brand-deep-glow` | `rgba(58,92,232,0.12)` | Referral glow effects |
| `--color-mw-ink` | `#1a1a1a` | Primary text |
| `--color-mw-ink-2` | `#3d3d3d` | Secondary text |
| `--color-mw-ink-3` | `#6b7280` | Muted text |
| `--color-mw-ink-4` | `#8A8C9E` | Lightest muted — referral UI |
| `--color-mw-ink-5` | `#9ca3af` | Extra light — dashboard/leaderboard |
| `--color-mw-surface` | `#f5f5f7` | Default surface |
| `--color-mw-surface-purple` | `#F7F6FF` | Referral/campaign light bg |
| `--color-mw-surface-card` | `#f9f9fb` | Dashboard/leaderboard cards |
| `--color-mw-green` | `#16a34a` | Earnings/success text |
| `--color-mw-live` | `#22c55e` | Live indicator dot (distinct green — do NOT merge with green) |
| `--color-mw-pink` | `#C2537A` | Sharing/referral |
| `--color-mw-teal` | `#2A9E8A` | Holding/success teal |
| `--color-mw-amber` | `#C27A00` | Pending/liquidity |
| `--color-mw-red` | `#ef4444` | Error/disconnect |
| `--color-mw-border` | `rgba(0,0,0,0.07)` | Default border |
| `--color-mw-border-strong` | `rgba(0,0,0,0.13)` | Stronger border |
| `--color-mw-border-mid` | `rgba(0,0,0,0.1)` | Mid border |
| `--color-mw-dark` | `#0A0D14` | Dark sections |
| `--color-mw-dark-text` | `rgba(255,255,255,0.88)` | Dark section text |
| `--color-mw-dark-sub` | `rgba(255,255,255,0.38)` | Dark section subtext |
| `--color-mw-dark-border` | `rgba(255,255,255,0.06)` | Dark section border |

> **Two intentional blues:** `--color-mw-brand` (`#4f7ef7`) is used in the nav/dashboard/leaderboard/swap. `--color-mw-brand-deep` (`#3A5CE8`) is used in referral/campaign components. They are visually distinct — do NOT merge them.

> **Two intentional greens:** `--color-mw-green` (`#16a34a`) is earnings/success text. `--color-mw-live` (`#22c55e`) is the live indicator dot. Do NOT merge.

### Spacing / shape tokens

| Token | Value |
|---|---|
| `--radius-sm` | `8px` |
| `--radius-md` | `12px` |
| `--radius-lg` | `16px` |
| `--radius-xl` | `20px` |
| `--transition-fast` | `0.15s` |
| `--transition-base` | `0.3s` |
| `--easing-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.07)` |
| `--shadow-sheet` | `0 -4px 40px rgba(58,92,232,0.12)` |

### Shared layout classes (`@layer components` in `globals.css`)

These classes extract the most-repeated layout patterns — use them in inline `<style>` blocks to reduce duplication:

| Class | Purpose |
|---|---|
| `.mw-card` | White card with `surface-card` bg, `radius-md`, border, 16px padding |
| `.mw-card-purple` | `surface-purple` bg, `radius-md`, border (no padding — set per-use) |
| `.mw-pill` | Base inline-flex pill — `radius-xl`, 3×10px padding, 11px 600-weight text |
| `.mw-pill-live` | Green live badge |
| `.mw-pill-ended` | Grey ended badge |
| `.mw-pill-soon` | Blue coming-soon badge |
| `.mw-label` | All-caps section label (11px, 600-weight, 1.5px letter-spacing) |
| `.mw-divider` | 1px horizontal rule using `--color-mw-border` |

### Fonts
- `Plus Jakarta Sans` (`--font-jakarta`) — UI labels, body text
- `DM Mono` (`--font-mono`) — wallet addresses, codes, large numbers

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

## Contract Infrastructure (Ticket 5 — complete, contract upgraded to v2)

### Files
| File | Purpose |
|---|---|
| `contracts/MintwareDistributor.sol` | On-chain Merkle drop settlement contract (**v2.0.0**) |
| `contracts/MockERC20.sol` | Test-only ERC-20 (mintable, dev only) |
| `contracts/test/MintwareDistributor.test.cjs` | Hardhat test suite (**needs update for v2 changes**) |
| `hardhat.config.cts` | Hardhat config (`.cts` = TypeScript CJS, required with `"type":"module"`) |
| `tsconfig.hardhat.json` | Separate TS config for Hardhat (module: commonjs, not bundler) |
| `scripts/deploy.cjs` | Deploy + auto-verify on Base/CoreDAO/BNB |

### v2 Breaking Changes (from smart contract audit)
All changes are in `MintwareDistributor.sol`. Off-chain code that calls the contract must be updated.

| # | Change | Impact |
|---|---|---|
| 1 | `ORACLE_SIGNER` (immutable) → `oracleSigner` (mutable, timelocked rotation) | Read `oracleSigner` not `ORACLE_SIGNER`. New functions: `proposeOracleSigner`, `confirmOracleSigner`, `cancelOracleRotation` |
| 2 | `ROOT_TYPEHASH` now includes `uint256 deadline` | Oracle must add `deadline` to signTypedData message. `claim()` and `batchClaim()` take a `deadline` param. `getRootDigest()` takes `deadline`. `/api/claim` must return and pass through `deadline`. |
| 3 | `campaignToken[id]` → `campaigns[id].token` | Use `campaigns[campaignId].token` to read campaign's ERC-20. New: `campaigns[id].creator`, `.closed`, `.closedAt`. New view: `getCampaign(campaignId)`. |
| 4 | Events restructured — `bytes32 indexed campaignIdHash` added | Indexers must filter on `keccak256(bytes(campaignId))`. Event params reordered. |
| 5 | `depositCampaign` uses balance-diff accounting | `campaignBalances` now reflects tokens *received*, not `amount` param. Safe for fee-on-transfer tokens. |
| 6 | New functions | `batchClaim()`, `closeCampaign()`, `withdrawCampaign()`, `emergencyWithdraw()`, `getCampaign()` |
| 7 | `ReentrancyGuard` added | `nonReentrant` on all state-changing functions |

### Oracle rotation flow
```
proposeOracleSigner(newAddr)   ← onlyOwner
  ↓  (wait 48 hours)
confirmOracleSigner()          ← onlyOwner — activates new signer
  OR
cancelOracleRotation()         ← onlyOwner — cancels if compromise detected
```

### Campaign lifecycle (new in v2)
```
depositCampaign()   ← anyone; first depositor becomes creator
  ↓  (campaign runs, epochs distributed, users claim)
closeCampaign()     ← onlyOwner (Mintware controls when campaigns end)
  ↓  (7-day WITHDRAWAL_COOLDOWN — users submit final claims)
withdrawCampaign()  ← campaign creator only — recovers remaining balance
```
Emergency path: `pause()` → `emergencyWithdraw()` → (new contract if needed)

### Off-chain changes required for v2

**`/api/claim/route.ts`** — oracle signing must include `deadline`:
```typescript
// Add deadline to the message (e.g. 30 days from now)
const deadline = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
const signature = await walletClient.signTypedData({
  domain, primaryType: 'RootPublication',
  types: { RootPublication: [
    { name: 'campaignId',  type: 'string'  },
    { name: 'epochNumber', type: 'uint256' },
    { name: 'merkleRoot',  type: 'bytes32' },
    { name: 'deadline',    type: 'uint256' },  // ← NEW
  ]},
  message: { campaignId, epochNumber, merkleRoot, deadline },  // ← add deadline
})
// Return deadline in API response so frontend can pass it to claim()
```

**Frontend `claim()` call** — add `deadline` param:
```typescript
// claim(campaignId, epochNumber, merkleRoot, oracleSignature, deadline, amount, merkleProof)
//                                                              ↑ new param between sig and amount
```

### Running tests
```bash
pnpm hardhat:test          # test suite (needs updating for v2 — see above)
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

### Leaf encoding — verified (unchanged in v2)
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

## Security Hardening (MintGuard — completed)

All items implemented in one sprint. See git history for full diff.

### What was done

| # | Item | Status |
|---|------|--------|
| 1 | Source maps off in production | ✅ `productionBrowserSourceMaps: false` in `next.config.mjs` |
| 2 | CSP headers | ✅ Strict CSP + `frame-ancestors: none` in `next.config.mjs` |
| 3 | LI.FI quote proxy | ✅ `POST /api/swap/quote` — API key server-only, fee injected server-side |
| 4 | On-chain tx verification | ✅ `verifySwapTx()` in `swap-event/route.ts` — checks receipt + calldata |
| 5 | Fee enforcement (calldata) | ✅ Treasury address must appear in `tx.input` or reward credit denied |
| 6 | Rate limiting | ✅ `middleware.ts` — sliding window per IP on sensitive POST endpoints |
| 7 | Referral time-gate | ✅ `POST /api/referral/apply` — referrer must be ≥ 24h old |
| 8 | sessionStorage for ref sheet | ✅ `ReferralSheet.tsx` — `localStorage` → `sessionStorage` |
| 9 | Server component migration | ⏸ Deferred — Phase 2 hardening |
| 10 | Bot farming / Sybil resistance | ⏸ Deferred — campaign hardening sprint |

### Rate limits (`middleware.ts`)
| Route | Method | Limit |
|---|---|---|
| `POST /api/campaigns/swap-event` | POST | 10 req/min per IP |
| `POST /api/campaigns/join` | POST | 5 req/min per IP |
| `POST /api/swap/quote` | POST | 20 req/min per IP |

> **Note:** Rate limiter uses in-memory Map (per serverless instance). Limits burst within one instance — sufficient against simple bots. For full cross-instance limiting, replace with Upstash Redis `@upstash/ratelimit`.

### LI.FI Quote Proxy (`app/api/swap/quote/route.ts`)
- Client calls `POST /api/swap/quote` instead of `li.quest` directly
- Server injects `fee: 0.005` + `referrer: MINTWARE_TREASURY_ADDRESS` (always, when integrator is verified)
- `LIFI_API_KEY` is server-only (renamed from `NEXT_PUBLIC_LIFI_API_KEY`)
- If a user strips fee params before `executeRoute()`, the calldata check in `swap-event` will catch it and deny the reward with `skip_reason: 'fee_not_paid'`

### On-chain Verification (`verifySwapTx` in `swap-event/route.ts`)
Checks before any reward credit:
1. `eth_getTransactionReceipt` — tx must exist and `status === 0x1`
2. `receipt.from === wallet` — prevents wallet spoofing
3. `tx.to` must be a known LI.FI router (`0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`)
4. Treasury address must appear in `tx.input` calldata (fee enforcement)
- **Fail-open on RPC error** — logs warning, allows through so legit users aren't blocked by RPC flakiness

### Referral Time-gate (`app/api/referral/apply/route.ts`)
- `useReferral.ts` calls `POST /api/referral/apply` instead of inserting `referral_records` directly via browser Supabase client
- Server checks referrer's `last_seen_at ≥ 24h` before `now()` — rejects with `referrer_too_new` if too fresh
- Prevents bots pre-seeding ref codes from wallets that never actually used the platform

### Env Vars

| Variable | Visibility | Notes |
|---|---|---|
| `LIFI_API_KEY` | Server-only | Renamed from `NEXT_PUBLIC_LIFI_API_KEY`. Set in Vercel and `.env.local`. |
| `NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED` | Public | Gates fee injection in proxy and calldata check |
| `MINTWARE_TREASURY_ADDRESS` | Server-only | Used in proxy fee injection + calldata verification |
| `NEXT_PUBLIC_MINTWARE_TREASURY` | Public | Fallback for treasury (client display only) |

**Vercel action complete:** `LIFI_API_KEY` set as server-only. `NEXT_PUBLIC_LIFI_API_KEY` deleted.

---

## Pending Work

- [ ] **Waitlist form** — `WaitlistButton` in `app/page.tsx` only fakes submission (changes button text, no API call). Needs `POST /api/waitlist` route + Supabase `waitlist` table insert.
- [ ] **`CORE_DAO_BRIDGE_CONTRACT`** — still `0x__PENDING_MOLTEN_CONFIRMATION__` in `.env.local`. Update when Molten confirms the bridge contract address.
- [ ] **Explorer page** — `explorer.html` uses D3.js, deferred full React conversion.

### Confirmed complete (verified this session)
- [x] **Ticket 6 — Claim API** — `app/api/claim/route.ts` + `app/api/claim/status/route.ts` fully implemented (Merkle proof, oracle signature, rate limiting, claimed-at guard).
- [x] **Deploy to Vercel** — Live at `mintware-beta.vercel.app`.
- [x] **Reown Cloud domain whitelist** — `localhost:3000` and `mintware-beta.vercel.app` both allowlisted. Project `580f461c981a43d53fc25fe59b64306b`.
- [x] **GitHub remote** — `origin` → `https://github.com/MintwareDevelopers/Mintware-Beta` configured.
- [x] **LIFI_API_KEY** — Renamed from `NEXT_PUBLIC_LIFI_API_KEY`. Server-only in Vercel. Old public key deleted.
- [x] **Design token unification** — All hardcoded hex values replaced with `var(--token)` references across all 10 files. Source of truth: `app/globals.css` `@theme` block + `@layer components`.
- [x] **MintGuard security hardening** — All 8 items complete (see Security Hardening section above).
- [x] **Surface hierarchy overhaul (commit 92566e8, merged to main)** — Blue-grey `#F8F9FC` app bg; white stat cards with shadow tokens; 30px stat values on dashboard; table header bg on leaderboard; swap banner + route row shadows; profile body bg tint; nav logo 19px/800; `CampaignCard` 3px blue left accent + 20px stat values; shadow tokens on `CampaignHeader` and `InviteTab`. Files: `app/globals.css`, `app/dashboard/page.tsx`, `app/leaderboard/page.tsx`, `app/swap/page.tsx`, `app/profile/page.tsx`, `components/MwNav.tsx`, `components/campaigns/CampaignCard.tsx`, `components/campaigns/CampaignHeader.tsx`, `components/referral/InviteTab.tsx`.
- [x] **Full redesign v1 (branch: full-redesign-v1)** — Attribution-as-hero principle applied across all pages. Dark `#0A0D14` hero on dashboard (score + tier + campaign stats), leaderboard (user rank at 56px), swap (attribution context panel), profile (score at 56px as primary number), campaign detail (multiplier projection card before JoinButton). Leaderboard me-row left border accent. `--radius-2xl`, `--shadow-feature` tokens added. Connect Wallet button upgraded to `#2563EB`/weight 600.

---

## Key Design Decisions

1. **`'use client'` on all pages** — RainbowKit/wagmi hooks require it. No server components in the app directory (except the explorer redirect).
2. **Inline styles on app pages** — preserves original HTML design fidelity. Landing page is the exception (Tailwind v4).
3. **shadcn/ui components exist but are unused** — scaffolded at project init; app uses custom CSS instead.
4. **Explorer stays static** — D3.js charts are complex; `/explorer` route redirects to the static HTML file in `/public`. Nav removed from explorer.html; logo-only back link to `/` added.
5. **ref_code is deterministic** — computed from wallet address, never depends on a database round-trip. InviteTab always renders immediately.
6. **LI.FI fee is double-enforced** — proxy injects fee server-side; on-chain calldata check in `swap-event` verifies treasury address is present. A user who strips fee params before `executeRoute()` still can't earn rewards.
7. **Referral inserts are server-gated** — `useReferral.ts` never writes to `referral_records` directly. All inserts go through `POST /api/referral/apply`, which enforces the 24h referrer time-gate.
8. **Rate limiter is per-instance, not global** — `middleware.ts` uses an in-memory `Map`. Good enough to stop simple bots; upgrade to Upstash Redis for full cross-instance limiting if needed.
9. **`'use client'` pages intentional** — All app pages use `'use client'` because RainbowKit/wagmi hooks require it. Server component migration is deferred to Phase 2.
10. **Design tokens live in `globals.css`, not a JS file** — Tailwind v4 uses `@theme` in CSS (not `tailwind.config.ts`). CSS custom properties work universally for both Tailwind utilities and inline `<style>` blocks. Never use a `lib/design-tokens.ts` pattern — it can't feed inline styles without a runtime dependency.
