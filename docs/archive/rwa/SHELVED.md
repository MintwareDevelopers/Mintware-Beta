# RWA surface — SHELVED (2026-08-05)

The Real-World-Asset (RWA) product surface was deliberately shelved off the Mintware platform to
refocus on the reputation-first DeFi core (Attribution → rewards → social LP vaults). RWA was a
second, separable business ("compliant tokenized-asset trading") that shared infrastructure but not
the reputation thesis. **This is not a deletion — everything is preserved and revivable.**

## Where the RWA work lives (preserved)

- **`archive/rwa-surface`** branch — a full snapshot of the platform *with* RWA (main before the shelve).
  The single point to diff/restore from.
- **PRs #28–34** (branches `feat/mw-router`, `feat/rwa-flow`, `feat/rwa-ws1-trader-gate`,
  `feat/rwa-ws3-issuer-vault`, `feat/rwa-ws2-hook-multilp`, `feat/rwa-ws2-ulv`, `feat/rwa-data-oracle-poc`)
  — the **latest, best** RWA work: the three-role compliance model, the pure-token vault, the USDC-only
  ULV, the Persona KYC oracle, and the RwaCollateralOracle composability proof. These branches remain
  pushed; they were never merged to `main`.

## What the shelve removed (on `chore/shelve-rwa` → main)

1. **Contracts** — `contracts-v4/src/rwa/*` (RWA vault, vRWA, oracle hook, SPV registries, distribution
   escrow), their tests, and the RWA demo deploy scripts. The DeFi contract stack imports none of it.
2. **App / API / lib** — `/rwa`, `RwaVaultDetail`, `RwaCreateFlow`, `/issuer`, `/admin/vaults`,
   `/redemptions`, `DealSection`, the campaign `SurfaceSelect`, `lib/rwa/*`, `holdSnapshot`/`holdLocks`,
   `navKeeper`, `rwa/appraisal`, and all RWA API routes. The two-surface UI was un-woven to DeFi-only
   (vault detail/create single-surface, `/vaults` toggle removed, discovery + VaultAmplify DeFi-only,
   campaigns DeFi-only).
3. **Copy** — homepage RWA section removed + vault preview reframed to DeFi; `/defi` RWA link and the
   RWA nav item removed.
4. **Docs / config** — RWA developer docs deleted; the two RWA cron entries removed from `vercel.json`.

Verified after removal: **Forge 156/156**, source typecheck clean, `vercel.json` valid.

## Left in place on purpose

- **Supabase migrations** — the applied RWA migrations stay in history (`vault_deals`, `vault_issuers`,
  `vault_redemptions`, `kyc_records`, `campaigns.surface`, etc.). The tables go **dormant** (the app no
  longer reads them); drop them later if desired, don't delete applied-migration files.
- **Shared infra kept** — `FeeVault`, `MWRouter`, the ERC-4626 base + factory, Attribution, the rewards
  engine — all serve DeFi and stay.

## Known residual RWA references (follow-up, non-blocking)

These are internal/secondary and were left for a focused follow-up rather than rushed:
- `app/docs/page.tsx` — a thesis page partly built on the RWA "wrapper" argument; needs a reputation-first
  rewrite (its `/rwa` link target is already gone).
- `.claude/rules/vaults.md`, `.claude/rules/rewards.md` — dev rule files still describe the two-surface /
  RWA-incentive design.
- A few unused RWA-copy consts (`STEPS`/`TRAD`/`MW` in `app/page.tsx`, dead `SurfaceSplit` in
  `VaultAmplify.tsx`) — tree-shaken from the bundle, harmless.

## To revive RWA later

Base a branch on `archive/rwa-surface` (or cherry-pick from PRs #28–34, which carry the *compliant*
version), then re-merge against the then-current `main`. The three-role compliance model in those PRs is
the version to bring back — not `main`'s older permissionless RWA.
