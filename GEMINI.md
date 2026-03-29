# Mintware Phase 1 — Project Context for Gemini

## Architecture: Three Groupings

Every feature must map to one of:

| Grouping | Scope |
|---|---|
| **Web2** | UI, fast APIs, indexing, off-chain auth |
| **Web3** | Wallets, contracts, on-chain reads/writes, on-chain verification |
| **Rewards** | Referrals, points, distribution, quests, claims, tokenomics, anti-abuse |

**Rewards is the core pillar.** When unsure: "does this exist to get value to the user for their on-chain behaviour?" → yes = Rewards.

---

## What This Project Is

Mintware is a DeFi reputation + rewards platform:
- **Attribution** (live) — on-chain reputation scoring across 100+ chains
- **Mintware** (coming soon) — social LP vaults and reward pools weighted by Attribution score

This is the Phase 1 web app — **Next.js 16 App Router**.

---

## Tech Stack

- **Framework:** Next.js 16.1.6, App Router, Turbopack
- **Language:** TypeScript 5.7
- **Wallet:** RainbowKit 2 + wagmi 3 + viem 2
- **Data fetching:** @tanstack/react-query 5
- **Styling:** Tailwind CSS v4 (landing page only); inline `<style>` blocks (all app pages)
- **Database:** Supabase (`@supabase/ssr` v0.9.0)
- **Package manager:** **pnpm** — never npm/yarn

---

## Key Conventions

- All app pages use `'use client'` — RainbowKit/wagmi hooks require it
- Inline `<style>` blocks on app pages — do not refactor to CSS modules or Tailwind
- Design tokens are CSS custom properties in `app/globals.css` `@theme` block — always use `var(--token)`, never hardcode hex
- `ref_code` is deterministic: `"mw_" + address.slice(2, 8).toLowerCase()` — never depends on DB
- API base: `https://attribution-scorer.ceo-1f9.workers.dev` — import from `lib/api.ts`, never hardcode

---

## Key Color Tokens

| Token | Value | Usage |
|---|---|---|
| `--color-mw-brand` | `#4f7ef7` | Nav, buttons |
| `--color-mw-brand-deep` | `#3A5CE8` | Referral/campaign UI (distinct — do NOT merge with brand) |
| `--color-mw-ink` | `#1a1a1a` | Primary text |
| `--color-mw-surface` | `#f5f5f7` | Default surface |
| `--color-mw-green` | `#16a34a` | Earnings/success |
| `--color-mw-live` | `#22c55e` | Live indicator dot (distinct — do NOT merge with green) |
| `--color-mw-dark` | `#0A0D14` | Dark sections |

---

## Project Structure

```
app/
  layout.tsx, globals.css, page.tsx (landing)
  dashboard/, leaderboard/, swap/, profile/
  campaign/[id]/
  api/referral/, api/swap/quote/, api/campaigns/swap-event/, api/claim/

components/
  providers.tsx, MwNav.tsx, MwAuthGuard.tsx
  referral/RefCodeInput.tsx, ReferralSheet.tsx, InviteTab.tsx
  campaigns/CampaignCard.tsx, CampaignHeader.tsx

lib/
  wagmi.ts, api.ts, supabase.ts
  referral/types.ts, utils.ts, useReferral.ts

contracts/
  MintwareDistributor.sol (v2.0.0), MockERC20.sol
```

---

## Supabase Tables

- `wallet_profiles` — one row per wallet: `address`, `ref_code`, `last_seen_at`
- `referral_records` — `referrer`, `referred`, `ref_code`, `status`
- `referral_stats` — VIEW: `address`, `ref_code`, `ref_link`, `tree_size`, `tree_quality`, `sharing_score`
- `pending_rewards` — per-tx reward locks (Token Reward Pool)
- `distributions` — Merkle epoch distribution records
- `epoch_state` — current epoch window + running point accumulator

---

## Smart Contract (MintwareDistributor v2)

Key v2 changes:
- `oracleSigner` is mutable (timelocked rotation) — not `ORACLE_SIGNER`
- `ROOT_TYPEHASH` includes `uint256 deadline` — oracle must sign it, claim() takes it
- `campaigns[id].token` replaces `campaignToken[id]`
- Events include `bytes32 indexed campaignIdHash = keccak256(bytes(campaignId))`
- Leaf encoding: `keccak256(keccak256(abi.encode(address, uint256)))` — uses `abi.encode` (64-byte padded), NOT `encodePacked`

---

## Security Notes

- Source maps off in production
- Strict CSP headers in `next.config.mjs`
- LI.FI quote proxied via `/api/swap/quote` (API key server-only, fee injected server-side)
- On-chain tx verification before any reward credit (`verifySwapTx`)
- Rate limiting in `middleware.ts` (in-memory, per-instance)
- Referral inserts gated server-side (`POST /api/referral/apply`) — 24h time-gate on referrer
