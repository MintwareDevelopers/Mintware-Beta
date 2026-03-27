# Architecture

## Three Groupings Rule (ALWAYS ENFORCE)

Every feature, file, and refactor maps to one of:

| Grouping | Scope |
|---|---|
| **Web2** | UI, fast APIs, indexing, off-chain auth |
| **Web3** | Wallets, contracts, on-chain reads/writes, on-chain verification |
| **Rewards** | Referrals, points, distribution, quests, claims, tokenomics, anti-abuse |

**Rewards is the core pillar.** It may call into Web2 (DB reads) and Web3 (claim tx) but lives in its own grouping.

Test: "Does this exist to get value to the user for their on-chain behaviour?" → yes = Rewards.

## Directory Layout

```
app/
  layout.tsx              # Root layout — fonts, metadata, <Providers>, <Analytics>
  globals.css             # Tailwind base + @theme tokens + @layer components
  page.tsx                # Landing page — Tailwind v4
  (rewards)/
    dashboard/page.tsx    # Earn/campaigns dashboard — auth-guarded
    leaderboard/page.tsx  # Global leaderboard — auth-guarded
    campaign/[id]/page.tsx
    profile/page.tsx
  (web3)/
    agents/page.tsx       # AI Agent leaderboard — ERC-8004
    swap/page.tsx         # 0x/Molten routing, campaign rewards, Core chain
  explorer/page.tsx       # Redirects to /explorer.html

components/
  web2/
    MwNav.tsx             # Sticky nav
    MwAuthGuard.tsx       # Redirects unauthenticated → /
    AnimatedScore.tsx
    TokenIcon.tsx
    WalletDisplay.tsx
  web3/
    WalletDisplay.tsx
  rewards/
    campaigns/
      CampaignCard.tsx
      CampaignHeader.tsx
      ClaimCard.tsx
    referral/
      RefCodeInput.tsx
      ReferralSheet.tsx
      InviteTab.tsx

lib/
  web2/api.ts             # API base URL + shared helpers
  web3/onchainPublisher.ts
  rewards/referral/
    types.ts
    utils.ts
    useReferral.ts
  wagmi.ts
  supabase.ts
  eas.ts
  tokenMeta.ts

app/api/
  (web2)/
  (web3)/agents/
  (rewards)/
    referral/route.ts
    referral/apply/route.ts
    campaigns/swap-event/route.ts
  swap/quote/route.ts
  claim/route.ts
  claim/status/route.ts
  claim/mark-claimed/route.ts

public/
  explorer.html           # Static D3 explorer
  .well-known/
    agent.json            # A2A v0.3.0 agent card
    erc8004-registration.json
    agent-reputation-oracle.json
```

## Pages Reference

| Route | File | Auth |
|---|---|---|
| `/` | `app/page.tsx` | No |
| `/explorer` | `app/explorer/page.tsx` | No → redirects to `/explorer.html` |
| `/dashboard` | `app/(rewards)/dashboard/page.tsx` | Yes |
| `/leaderboard` | `app/(rewards)/leaderboard/page.tsx` | Yes |
| `/swap` | `app/(web3)/swap/page.tsx` | Yes |
| `/campaign/[id]` | `app/(rewards)/campaign/[id]/page.tsx` | Yes |
| `/profile` | `app/(rewards)/profile/page.tsx` | Yes |
| `/agents` | `app/(web3)/agents/page.tsx` | Yes |

## Key Design Decisions

1. **`'use client'` on all pages** — RainbowKit/wagmi hooks require it. No RSC in app dir (except explorer redirect).
2. **shadcn/ui exists but unused** — scaffolded at init; app uses custom CSS instead.
3. **Explorer stays static** — D3 complexity; `/explorer` redirects to `/public/explorer.html`. Nav removed; logo-only back link.
4. **`'use client'` pages intentional** — Server component migration deferred to Phase 2.
5. **Dev auth bypass** — `MwAuthGuard` skips redirect when `NODE_ENV === 'development'`.
