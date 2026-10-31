# Architecture

## Three groupings

| Grouping | Scope |
|---|---|
| **Web2** | UI, APIs, indexing, off-chain authentication |
| **Web3** | Wallets, contracts, chain reads/writes, on-chain verification |
| **Rewards** | Referrals, points, distributions, claims, and anti-abuse |

Canonical page, API, cron, and contract inventories are generated in [`../STATE.md`](../STATE.md). Do not hand-copy
route lists there. Campaign issuance and the former LP Gateway mechanics are retired; RWA remains a testnet demo.

## Main boundaries

- `app/` contains Next.js App Router pages and routes; `components/` holds UI; `lib/` holds shared services and
  domain logic.
- `app/app/` is the one app. `(personal)` holds Markets, Portfolio, Swap, the RWA demo and the simulated Previews,
  open to everyone. `team/` and `org/` hold the Team workspace, which `V2AppGate` protects. The old `/v1` platform
  and `/markets/[pool]` redirect into `/app` (`next.config.mjs`); verify route groups in the generated inventory.
- `app/api/gateway/*` is a legacy route namespace for MarketEngine discovery, curation, registry, and transaction
  event recording. It does not expose the retired PositionManager/Staging system.
- `contracts-v4/src/vaults/MintwareMarketEngine*.sol` implements current V1 pool liquidity. Earn and refill are
  in `contracts-v4/src/payments/MintwareYieldVault.sol` and `MintwarePaymentGateway.sol`.
- `lib/rewards/universal/*` and `lib/rewards/vault/*` implement current rewards processing. The former campaign
  product is retired.
- `components/web2/providers.tsx` configures Privy and wagmi. RainbowKit is not used.

## Current surfaces

The detailed route inventory lives in `STATE.md`'s generated `AUTO:pages` block. Product behavior and status live
in [`lp-gateway.md`](lp-gateway.md), [`payments-ypn.md`](payments-ypn.md), and [`rwa-liquidity.md`](rwa-liquidity.md).
All contract products are testnet-only and unaudited; external audit gates real value.

## Design notes

1. Interactive wallet pages use client components where Privy/wagmi hooks are needed.
2. `proxy.ts`, `TeamGuard`, and `V2AppGate` implement separate route and workspace gates; check their code before
   changing access claims.
3. Personal and Team (including organization pages) share `AppShell`; the sidebar menu and the workspace
   switcher are the only things that change. The RWA demo lives in Personal, not in a workspace of its own.
4. `/explorer` redirects to `/`; the historical static explorer file, if present, is not in the current site map.
5. Keep archived product designs clearly historical. A source file or retained deployed contract does not make a
   retired product current.

**One app (2026-10-31).** V1 (`/v1`, its own top-bar shell) and the gated V2 app (`/app`) were merged into one
`/app` with Personal and Team workspaces, because the working features were split between a public demo shell and
a hidden app. V1Shell and V1Footer were deleted; their testnet notice (`V1DisclaimerGate`) now opens the Personal
workspace.
