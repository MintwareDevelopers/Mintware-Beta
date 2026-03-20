# Mintware — Session Memory

Working reference for Claude Code. Tracks decisions made, gotchas hit, and current state across sessions.
CLAUDE.md is the technical spec. This file is the running log.

---

## Current State (as of 2026-03-19)

### What's live
- **Deployed:** `mintware-beta.vercel.app`
- **GitHub:** `https://github.com/MintwareDevelopers/Mintware-Beta` (`origin`)
- **Reown domains allowlisted:** `localhost:3000` + `mintware-beta.vercel.app`
- **Env vars on Vercel:** `LIFI_API_KEY` (server-only), `NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED`, `MINTWARE_TREASURY_ADDRESS`, `NEXT_PUBLIC_MINTWARE_TREASURY`, Supabase keys

### What's genuinely pending
| Item | Notes |
|---|---|
| **Waitlist form** | `WaitlistButton` in `app/page.tsx` fakes it — changes button text only. Needs `POST /api/waitlist` + Supabase `waitlist` table. |
| **Test suite update** | `contracts/test/MintwareDistributor.test.cjs` needs updating for v2 contract changes (new `deadline` param in `claim()`, new functions). |
| **Oracle backend update** | `/api/claim/route.ts` oracle signing must add `deadline` to `RootPublication` typedData message and return it in the response. Frontend `claim()` call must pass it. |
| **`CORE_DAO_BRIDGE_CONTRACT`** | Still `0x__PENDING_MOLTEN_CONFIRMATION__` in `.env.local`. |
| **Explorer page** | `explorer.html` uses D3. Deferred. |

---

## Today's Work Log (2026-03-19)

### MintGuard Security Hardening (completed)
All 8 items done in one sprint:
1. Source maps off (`productionBrowserSourceMaps: false`)
2. CSP headers + `frame-ancestors: none` in `next.config.mjs`
3. LI.FI quote proxy — `POST /api/swap/quote`, API key server-only, fee injected server-side
4. On-chain tx verification — `verifySwapTx()` in `swap-event/route.ts`
5. Fee calldata enforcement — treasury address must appear in `tx.input`
6. Rate limiting — `middleware.ts`, sliding window per IP
7. Referral time-gate — `POST /api/referral/apply`, referrer must be ≥ 24h old
8. `localStorage` → `sessionStorage` for `mw_ref_sheet_dismissed`

**Key decision:** `useReferral.ts` no longer writes to `referral_records` directly via browser Supabase client. All inserts go through the API route which enforces the time-gate server-side.

### Vercel / Infra (completed)
- `LIFI_API_KEY` added as server-only env var
- `NEXT_PUBLIC_LIFI_API_KEY` deleted from Vercel
- Note: Vercel "Sensitive" flag isn't available when scoping to All Environments — skip it, the server-only naming is what matters

### Design Token Unification (completed)
Pure refactor — no visual changes. All hardcoded hex values replaced with `var(--token)` across 10 files.

**Why CSS custom properties and not `lib/design-tokens.ts`:** Tailwind v4 uses `@theme` in CSS (not `tailwind.config.ts`). App pages use inline `<style>` blocks. CSS custom properties work for both — a TS file can't feed inline styles without a runtime import.

**Two intentional blues — do NOT merge:**
- `--color-mw-brand` (`#4f7ef7`) — nav, dashboard, leaderboard, swap
- `--color-mw-brand-deep` (`#3A5CE8`) — referral, campaign components

**Two intentional greens — do NOT merge:**
- `--color-mw-green` (`#16a34a`) — earnings/success text
- `--color-mw-live` (`#22c55e`) — live indicator dot

Added `@layer components` in `globals.css`: `.mw-card`, `.mw-card-purple`, `.mw-pill`, `.mw-pill-live`, `.mw-pill-ended`, `.mw-pill-soon`, `.mw-label`, `.mw-divider`.

### Smart Contract Audit + v2 Upgrade (completed today)

Full audit of `MintwareDistributor.sol`. Found 2 HIGH, 1 MEDIUM, 2 LOW, 4 INFO issues.
All fixed in v2 — contract rewritten from scratch with full NatSpec.

**H-1 — No fund recovery** → `closeCampaign()` (owner) + `withdrawCampaign()` (creator, 7-day cooldown after close)

**H-2 — Immutable oracle** → Mutable `oracleSigner` with 48h propose/confirm/cancel timelock. Old `ORACLE_SIGNER` constant is gone.

**M-1 — Pause without rescue** → `emergencyWithdraw(token, to, amount)` — only callable `whenPaused`

**L-1 — No sig expiry** → `deadline` added to `ROOT_TYPEHASH`. Oracle sets expiry per signing. **Breaking change** — see off-chain update requirements below.

**L-2 — Fee-on-transfer tokens** → Balance-diff accounting in `depositCampaign`. `campaignBalances` now = tokens actually received.

**Other:** `ReentrancyGuard` added, `batchClaim()` added, events now include `bytes32 indexed campaignIdHash`, cheap checks reordered to top of `_claim()`.

#### v2 Breaking Changes summary
| Old | New |
|---|---|
| `ORACLE_SIGNER` (immutable) | `oracleSigner` (mutable) |
| `campaignToken[id]` | `campaigns[id].token` |
| `claim(..., sig, amount, proof)` | `claim(..., sig, deadline, amount, proof)` |
| `getRootDigest(id, epoch, root)` | `getRootDigest(id, epoch, root, deadline)` |
| Events: no indexed campaignId | Events: `bytes32 indexed campaignIdHash` |

#### Off-chain updates still needed for v2
1. `/api/claim/route.ts` — oracle signing must include `deadline` in typedData message + return it in response
2. Frontend `claim()` calldata — add `deadline` between `oracleSignature` and `amount`
3. Test suite — update for new function signatures and test new functions

---

## Persistent Gotchas

### Dev server
- Always use `pnpm dev` from the project root — never `npm` or `yarn`
- Lock file issue: `Unable to acquire lock at .next/dev/lock` → `pkill -f "next dev"` then delete `.next/dev/lock`
- Preview tool requires PATH set: `/Users/nicolasrobinson/.nvm/versions/node/v22.22.1/bin` — baked into `.claude/launch.json`
- First compile is slow (~10–15s) due to RainbowKit + wagmi

### Hardhat
- Config is `.cts` not `.ts` — required because project has `"type": "module"`
- Test files must be `.cjs` — not `.ts` or `.cts`
- Always prefix hardhat commands with `TS_NODE_PROJECT=tsconfig.hardhat.json` — baked into `pnpm hardhat:*` scripts

### CSS
- Landing page (`app/page.tsx`) uses Tailwind v4 utility classes
- All other app pages use inline `<style>` blocks — do not refactor to Tailwind or CSS modules unless asked
- Never hardcode hex values — always use `var(--token)` from `globals.css`
- Tailwind v4 config is in `globals.css` `@theme` block, not `tailwind.config.ts`

### Referral system
- `ref_code` is deterministic: `"mw_" + address.slice(2, 8).toLowerCase()` — never read from DB
- `InviteTab` always renders immediately from wallet address — no loading state
- `useReferral.ts` calls `POST /api/referral/apply` — never writes to Supabase directly
- `ReferralSheet` dismissed state is in `sessionStorage` (not localStorage) — intentional, resets per tab

### Supabase tables
| Table | Purpose |
|---|---|
| `wallet_profiles` | One row per wallet: `address`, `ref_code`, `last_seen_at` |
| `referral_records` | `referrer`, `referred`, `ref_code`, `status` (pending/active) |
| `referral_stats` | VIEW — `address`, `ref_code`, `ref_link`, `tree_size`, `tree_quality`, `sharing_score` |
| `pending_rewards` | Token Reward Pool per-tx locks |
| `distributions` | Points Campaign Merkle epoch records |
| `epoch_state` | Active epoch window + point accumulator |
| `waitlist` | **Does not exist yet** — needs creating when waitlist form is wired up |

---

## Architecture Reminders

- All app pages are `'use client'` — RainbowKit/wagmi requires it. No server components in app dir except explorer redirect.
- `lib/api.ts` exports `API` base URL — always import from there, never hardcode `attribution-scorer.ceo-1f9.workers.dev`
- `lib/api.ts` also exports `fmtUSD()`, `daysUntil()`, `shortAddr()`, `iconColor()`
- Rate limiter in `middleware.ts` is in-memory per serverless instance — sufficient for simple bots, not cross-instance
- Two intentional blues, two intentional greens — documented in CLAUDE.md CSS Conventions
