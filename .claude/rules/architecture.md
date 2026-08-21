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

> **Canonical route lists live in [`../STATE.md`](../STATE.md)** (generated `AUTO:pages` +
> `AUTO:crons` blocks). The tables below are the annotated, hand-maintained view. Campaigns and
> RWA are **SHELVED** — their pages/routes were removed (archived to `docs/archive/`). Do not
> reintroduce `/dashboard`, `/campaign/[id]`, `/swap`, `/leaderboard` at the root, or any
> `(rewards)/campaign*` surface as if live.

## Directory Layout

```
app/
  layout.tsx              # Root layout — fonts, metadata, <Providers>, <Analytics>
  globals.css             # Tailwind base + @theme tokens + @layer components
  page.tsx                # Landing page — Tailwind v4
  about/ defi/ docs/ teams/ attribution/   # Marketing pages (public)
  vaults/ yield-payment-network/ agents/   # Marketing pages (public)
  explorer/page.tsx       # Redirects to /explorer.html
  [address]/page.tsx      # Public wallet → Attribution profile lookup
  app/                    # ▼ Retail app — bifurcates User / Team after Launch (soft gate)
    page.tsx              # Launch entry
    account/              # USER: Liquid Sovereign Account — the money home (auth)
    swap/ vaults/         # USER: real LI.FI swap · vault list
    vault/[id]/ vault/create/   # USER: vault detail / create (auth)
    leaderboard/ profile/       # USER: reputation leaderboard · identity (auth)
    agents/               # Agent parking account + x402 (spend-in-place)
    arc/                  # Circle Arc settlement demo
    team/                 # TEAM: treasury terminal
      page.tsx            #   Overview
      vaults/ swap/ cards/ policy/ team/ developers/
  (web3)/
    agent/[address]/      # Agent detail (auth)
    agents/leaderboard/   # Agent leaderboard — ERC-8004
  (rewards)/
    vaults/               # /vaults marketing surface
    ref/[code]/           # Referral capture → redirect

components/
  marketing/  ui/  ui2/  vaults/
  web2/
    MwNav.tsx  MwFooter.tsx  MwAuthGuard.tsx  AppMode.tsx  ScopeSwitcher.tsx
    TeamGuard.tsx  useTeamSession.ts  CommandPalette.tsx  LaunchModal.tsx
    providers.tsx         # Privy + wagmi provider tree (NOT RainbowKit)
  web3/  rewards/referral/

lib/
  web2/api.ts             # API base URL + shared helpers
  web3/wagmi.ts           # @privy-io/wagmi createConfig (NOT getDefaultConfig)
  web3/useMintwareIdentity.ts
  rewards/universal/*     # live rewards pipeline (campaign engine shelved)
  rewards/vault/weighted* # vault-weighted epoch rails
  attribution/*  x402/*  auth/*  eas.ts  supabase.ts

app/api/
  (web2)/    attribution/score-v2 · profile · swap/quote · vault(s) · waitlist
  (web3)/    agents/* · wallet-link
  (rewards)/ referral(/apply) · auth/connect · eas/attest-score
             cron/* (universal-*, vault-*, treasury) · universal/trade-signal
             vault/{deposit,withdraw,weighted-claim,attribution-snapshot}
  (admin)/   oracle/* (testnet deploy + smoke helpers)
  x402/      account · score · supported · verify · settle
  team/session

public/
  explorer.html           # Static D3 explorer
  .well-known/
    agent.json  erc8004-registration.json  agent-reputation-oracle.json  x402.json
```

## Pages Reference

Auth = `MwAuthGuard` (soft-gate today; dev bypass when `NODE_ENV === 'development'`). The
User/Team hard gate is `proxy.ts` + `TeamGuard`, flag-gated on `TEAM_HARD_GATE` (default off).

### Marketing / public (no auth)

| Route | File |
|---|---|
| `/` | `app/page.tsx` |
| `/about` · `/defi` · `/docs` · `/teams` · `/attribution` | `app/{about,defi,docs,teams,attribution}/page.tsx` |
| `/vaults` | `app/(rewards)/vaults/page.tsx` |
| `/yield-payment-network` | `app/yield-payment-network/page.tsx` |
| `/the-math` | `app/the-math/page.tsx` — interactive yield-engine simulator (floor + fees + MEV stack, take-home vs a fund, real DeFi precedents). Footer-linked as "The Math"; the on-platform home of the value-prop model. |
| `/agents` | `app/agents/page.tsx` (public — leads with earn + x402) |
| `/agents/leaderboard` | `app/(web3)/agents/leaderboard/page.tsx` (auth) |
| `/agent/[address]` | `app/(web3)/agent/[address]/page.tsx` (auth) |
| `/[address]` | `app/[address]/page.tsx` — Attribution profile lookup |
| `/explorer` | `app/explorer/page.tsx` → redirects to `/explorer.html` |
| `/ref/[code]` | `app/(rewards)/ref/[code]/page.tsx` |
| `/legal` | `app/legal/page.tsx` — **INTERNAL, auth-gated** (`MwAuthGuard`), NOT public: structural & regulatory posture memo (non-custodial-software positioning, five bright lines, risk register). `/proof`-doc style, light-only. Not legal advice. |

### Retail app `/app/*` (User / Team split)

| Route | File | Tier | Auth |
|---|---|---|---|
| `/app` | `app/app/page.tsx` | entry | No |
| `/app/account` | `app/app/account/page.tsx` | User — Liquid Sovereign Account | Yes |
| `/app/swap` | `app/app/swap/page.tsx` | User | No |
| `/app/vaults` | `app/app/vaults/page.tsx` | User | No |
| `/app/vault/[id]` | `app/app/vault/[id]/page.tsx` | User | Yes |
| `/app/vault/create` | `app/app/vault/create/page.tsx` | User | Yes |
| `/app/leaderboard` | `app/app/leaderboard/page.tsx` | User | No |
| `/app/profile` | `app/app/profile/page.tsx` | User — identity | Yes |
| `/app/agents` | `app/app/agents/page.tsx` | Agent parking account + x402 | No |
| `/app/arc` | `app/app/arc/page.tsx` | Circle Arc settlement demo | No |
| `/app/team` | `app/app/team/page.tsx` | Team — Overview | No |
| `/app/team/{vaults,swap,cards,policy,team,developers}` | `app/app/team/*/page.tsx` | Team treasury terminal | No |

## Key Design Decisions

1. **`'use client'` on interactive pages** — Privy/wagmi hooks require it. Explorer redirect is the RSC exception.
2. **Privy is the single wallet layer** — RainbowKit was removed (PR #175). Provider tree in `components/web2/providers.tsx`; wagmi via `@privy-io/wagmi` `createConfig`. See `.claude/rules/web3.md`.
3. **User/Team split is soft-gated today** — the retail app forks into User + Team after Launch; hard gating (Privy RBAC + middleware + `verifyPrivySession`) is flag-gated on `TEAM_HARD_GATE` (default off = showcase). See `.claude/STATE.md`.
4. **Campaigns + RWA shelved** — the campaign dashboard/claim/`/campaign/[id]` surface and RWA pages were removed and archived. The live rewards path is the universal pipeline (`lib/rewards/universal/*`) + vault-weighted epoch rails.
5. **shadcn/ui exists but unused** — scaffolded at init; app uses custom CSS + `components/ui`/`ui2`.
6. **Explorer stays static** — D3 complexity; `/explorer` redirects to `/public/explorer.html`.
7. **Dev auth bypass** — `MwAuthGuard` skips redirect when `NODE_ENV === 'development'`.
