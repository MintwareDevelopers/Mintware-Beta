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

### 2026-03-31 — Main can soft-disable Solana from one flag
- Affects `.claude/rules/architecture.md` and `.claude/rules/web3.md`. Added `NEXT_PUBLIC_ENABLE_SOLANA` via `lib/web3/featureFlags.ts` so the live app can stay EVM-first without deleting Solana work. When the flag is false, Solana adapters do not auto-connect, Solana connect/link UI is hidden in nav, profile, dashboard, and swap, and auth falls back to EVM-only while the dormant Solana code remains available for later re-enable.

### 2026-04-01 — Universal TradeSignal processing starts as pure pipeline modules
- Affects rewards architecture and future settlement work. Added `lib/rewards/universal/{types,tradeSignalIngestor,classifier,allocator,merkleBuilder}.ts` plus `universalPipeline.test.ts` to establish a pure, testable path from hook-emitted trade facts to classification, allocation, and claimable Merkle outputs. LP-pool allocations are intentionally excluded from direct wallet Merkle leaves so they can continue through a separate LP settlement path later.

### 2026-04-01 — Universal trade-signal ingestion lands in a backend-only ledger first
- Affects rewards architecture, API routes, and schema. Added `trade_signals` as a backend-only Supabase ledger plus `lib/rewards/universal/store.ts` and `app/api/(rewards)/universal/trade-signal/route.ts`. The route requires `TRADE_SIGNAL_INGEST_SECRET` outside local development and only normalizes/upserts raw hook facts; classification and settlement remain downstream concerns.

### 2026-04-01 — Universal TradeSignal polling uses a cron route plus sync cursor
- Affects rewards architecture, API routes, and schema. Added `trade_signal_sync_state`, `lib/rewards/universal/indexer.ts`, and `app/api/(rewards)/cron/universal-trade-signals/route.ts` so Mintware can poll `TradeSignal` logs from a configured core-hook deployment with a durable last-synced-block cursor. Base/Base Sepolia are supported first, and the cron route is gated by `CRON_SECRET`.

### 2026-03-31 — Solana RPC centralization
- Solana RPC configuration now lives in `config/solana.ts` instead of being hardcoded in individual components/routes. Use `NEXT_PUBLIC_SOLANA_RPC_URL` for the client wallet adapter, `SOLANA_RPC_URL` plus optional `SOLANA_RPC_FALLBACK_URL` for server verification, and prefer `/api/wallet-link` over direct client Supabase reads so Solana identity state stays behind one API boundary.

### 2026-03-31 — Solana native settlement planning
- Affects `.claude/rules/architecture.md`, `.claude/rules/web3.md`, `.claude/rules/rewards.md`, and `.claude/rules/schema.md`. The repo already supports linked Solana wallets and a combined-score direction, but not Solana-native reward settlement. The working plan in `docs/solana-native-settlement-plan.md` keeps unified identity and unified score while introducing dual payout rails: existing EVM claims for EVM campaigns and a new Solana-native claim rail for Solana-funded campaigns.

### 2026-03-31 — Canonical rewards identity + Solana reward schema
- Affects `.claude/rules/rewards.md` and `.claude/rules/schema.md`. Added `lib/rewards/identity.ts` as the shared canonical wallet resolver for rewards code: EVM primaries stay canonical, linked Solana wallets resolve back to that canonical reward identity, and standalone wallets still work unchanged. Added migration `20260331000001_solana_reward_rails.sql` so campaigns and distributions can declare EVM vs Solana settlement, plus a `solana_claims` table for the native Solana rail, without breaking the existing EVM reward flow.

### 2026-03-31 — Solana points ingestion modeled after EVM swap attribution
- Affects `.claude/rules/rewards.md`, `.claude/rules/web3.md`, and `.claude/rules/security.md`. `processSwapEvent()` in `lib/rewards/swapHook.ts` now resolves a canonical reward wallet before participant gating and activity writes, so linked Solana wallets can credit the same rewards identity as EVM. Added `app/api/(rewards)/campaigns/sol-swap-event/route.ts` as a Solana-specific points ingestion endpoint that mirrors the live EVM swap-event flow: verify tx first, resolve campaigns, then reuse the shared swap processor. For now it intentionally supports only `campaign_type='points'` with `reward_chain='solana'`; token-pool settlement stays blocked until the native Solana claim rail exists.

### 2026-03-31 — Rewards UI is now reward-rail aware
- Affects `.claude/rules/architecture.md`, `.claude/rules/rewards.md`, and `.claude/rules/web3.md`. Rewards discovery surfaces should distinguish network-of-activity from settlement rail: campaign cards and headers now show whether rewards settle on EVM or Solana, the dashboard no longer tells Solana users that every campaign is EVM-only, and the live swap UI filters down to EVM-settled campaigns because the current swap widget still routes through the EVM reward flow.

### 2026-03-31 — Claim APIs now treat Solana settlement as a separate rail
- Affects `.claude/rules/rewards.md`, `.claude/rules/web3.md`, and `.claude/rules/schema.md`. `/api/claim/status` now tags rewards with `reward_chain` and `settlement_chain`, and Solana-settled rewards are surfaced as `solana_pending` instead of being exposed as normal EVM claims. `/api/claim` and `/api/claim/mark-claimed` now explicitly reject Solana-settled distributions so the live MintwareDistributor path remains EVM-only until the native Solana claim rail is implemented.

### 2026-04-01 — Supabase advisor hardening should be explicit and idempotent
- Affects schema/security migrations. Added a dedicated backstop migration for Security Advisor drift so public-schema tables do not rely on intent alone: `waitlist` stays backend-only under RLS, `participants` and `activity` are reasserted as public-read/backend-write, AI agent profiles and scores become explicit public-read/backend-write tables, `ai_agent_mwp_hashes` stays backend-only, and `vault_rebalance_proposals` becomes public-read/backend-write. Also attempts to move safe leaderboard/stat views toward `security_invoker` semantics.

### 2026-04-01 — Dashboard-only views are a schema debt
- Affects schema/security hygiene. `ai_agent_leaderboard` now has a canonical repo-managed `security_invoker` definition, but `referral_stats` and `campaign_leaderboard` are still dashboard-managed and only alterable best-effort from migrations. Export those view definitions into versioned SQL before relying on Security Advisor cleanliness long-term.

### 2026-04-01 — Function search_path warnings can be fixed without recreating bodies
- Affects schema/security hygiene. For Supabase `Function Search Path Mutable` warnings, prefer an idempotent `ALTER FUNCTION ... SET search_path = pg_catalog, public` pass keyed off `pg_proc` rather than rewriting function bodies. This safely hardens both repo-managed functions and legacy live-only functions whose SQL bodies are not yet in version control.

### 2026-04-01 — Supabase migration history should be reconciled from live markers, not pushed blindly
- Affects schema/deployment hygiene. When remote `schema_migrations` is far behind local, do not run `supabase db push` against production. First prove which migrations are already reflected in the live schema using marker queries, then backfill only those versions into `supabase_migrations.schema_migrations` with `ON CONFLICT DO NOTHING`, leaving genuinely unapplied migrations (for us, `20260331000001_solana_reward_rails.sql`) untouched.

### 2026-04-01 — Platform core architecture prioritizes universal execution over incremental V4 reuse
- Affects vaults, smart contracts, and rewards architecture. The long-term direction is now a clean four-layer platform: a universal execution hook, an off-chain Attribution/intelligence brain, non-custodial Merkle settlement, and product-specific liquidity wrappers like Social LP. Existing `MWSocialHook`, `SocialVault`, `FeeVault`, and vault reward code remain reference inputs, but future build work should optimize for the platform primitive instead of preserving the current vault-native shape.

### 2026-04-01 — Build new platform-core work from the clean production-safe baseline
- Affects implementation workflow. The repo-accurate blueprint for the platform rebuild should be executed from `/tmp/mintware-prod-safe-baseline` on `codex/prod-safe-baseline`, not from the dirty Solana workspace. Treat `MWSocialHook`, `SocialVault`, `FeeVault`, and the vault reward modules as reference material for `MintwareCoreHook`, `PolicyManager`, `MintwareFeeSink`, and the universal allocator, rather than modifying the production/feature branches in place.

### 2026-04-01 — Universal settlement closes epochs from the raw trade-signal ledger
- Affects rewards architecture, API routes, and schema. Added `universal_reward_epochs` / `universal_reward_allocations`, a `settled_epoch_id` cursor on `trade_signals`, `lib/rewards/universal/{epochAllocator,settler}.ts`, and `app/api/(rewards)/cron/universal-epoch-close/route.ts`. The first allocator is intentionally stable-settlement-first: it reads raw hook facts, joins Attribution percentile context via `/score`, classifies signals, writes epoch/allocation rows, and emits wallet-only Merkle outputs while preserving LP pool allocations separately. Allocation provenance is stored as `source_trade_ids[]` because recipient rows are aggregated across many trades.

### 2026-04-01 — Universal epochs bridge into the existing distributor rail via synthetic pool campaigns
- Affects rewards architecture, API routes, and schema. Added `lib/rewards/universal/{distributionBridge,bridgeCron}.ts`, `app/api/(rewards)/cron/universal-distribution-bridge/route.ts`, and a bridge migration linking `universal_reward_epochs` back to `distributions`. The compatibility layer creates a deterministic synthetic campaign id per `(chain_id, pool_id)`, mirrors wallet allocations into `distributions` and the live `daily_payouts` claim schema, and optionally calls the existing `publishDistribution()` signer when `UNIVERSAL_DISTRIBUTOR_ADDRESS` is configured. This lets universal pool epochs reuse the current claim/status APIs without pretending they are legacy user-authored campaigns.

### 2026-04-01 — Universal cron runs as a sequential pipeline
- Affects rewards architecture, API routes, and deployment config. Added `app/api/(rewards)/cron/universal-pipeline/route.ts` and scheduled it in `vercel.json` so the universal flow runs in order every 15 minutes: `TradeSignal` sync first, then epoch settlement, then distributor bridging/publication. The standalone cron routes remain useful for manual replay and debugging, but the scheduled production path should favor the orchestrated pipeline to reduce timing drift between stages.

### 2026-04-01 — Universal core stack is live on Base Sepolia
- Affects vaults, smart contracts, and deployment config. Deployed the first universal execution-layer contracts to Base Sepolia from the clean `codex/prod-safe-baseline` worktree: `PolicyManager` at `0xe402528Ca39E1365FD20Fab65468DCbf1fc5e74B`, `MintwareFeeSink` at `0x6B0283b2Cb0F8395B006Fd771e993dEc55ff3F35`, and `MintwareCoreHook` at `0x6AAa7c5031249B9ABf7aEEf65c97bbc4Aa4680c4`. Local env/docs now anchor the universal pipeline to that hook address for Base Sepolia, while the old `MWSocialHook` remains a separate legacy Phase 2 deploy.

### 2026-04-01 — Codex now has a non-destructive bridge into the Claude context system
- Affects project operating context and future session continuity. Added `.Codex/rules/` as a mirror of `.claude/rules/` plus `.Codex/context/{project-map,environments,memory-index}.md` so Codex can see the same holistic project picture without deleting or moving the original Claude memory/rule files. `.claude/` stays preserved; `.Codex/` is the bridge layer.

### 2026-04-01 — Codex context now includes a one-page operating brief and Markdown index
- Affects project operating context and documentation discovery. Added `.Codex/context/current-truth.md` as the human-readable state-of-the-platform brief and `.Codex/context/markdown-map.md` as the first-party Markdown inventory, so future sessions can load the whole knowledge base without trawling vendored docs or old worktree copies.

### 2026-04-01 — Default Codex workflow should stay in the main repo, not hidden worktrees
- Affects architecture/process hygiene. Future Codex work should default to `/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build` on normal `codex/*` branches so the user can audit one visible filesystem reality. Isolated `/tmp` worktrees are now an exception path only when explicitly requested or when a risky change truly warrants it and the reason is stated up front.

### 2026-04-01 — Vault P0 hardening favors explicit consistency over half-wired features
- Affects vaults, deployments, and smart contracts. Canonicalized the private-ready lock-tier schedule around `1.0× / 1.15× / 1.3× / 1.5×`, aligned the attribution snapshot route to the current `FeeVault` EIP-712 domain name (`"FeeVault"`), fixed the `vault-epoch-close` app URL fallback precedence bug, and changed `FeeVault.compound()` from a misleading partial side effect into an explicit `CompoundingDisabled()` revert until the real compounding path is implemented.

### 2026-04-01 — Vault route hardening should assume retries and nested relation ambiguity
- Affects vault APIs and schema hygiene. Added a vault migration to store `lp_deposits.tx_hash` with a unique index, made `/api/vault/deposit` idempotent on that tx hash, made `/api/vault/withdraw` return the existing pending queue entry instead of duplicating requests, tightened rebalance-proposal submission status transitions, and normalized `current_epoch` to a single active/latest object in the vault read routes so the UI is not forced to interpret raw nested relation arrays.

### 2026-04-02 — Vault creation now finalizes only after confirmed seed completion
- Affects vault APIs, schema hygiene, and the private bootstrap flow. Added `team_seeds.tx_hash` with a partial unique index, introduced `/api/vault/seed-complete` as the idempotent bridge from on-chain `seedTeamTokens()` to Supabase state, and updated `/vault/create` so a vault is only shown as created after the seed tx is confirmed and the backend records the team seed plus flips `social_vaults.status` to `active`.

### 2026-04-02 — Vault routes should stay fully dark while Phase 2 is gated
- Affects vault UX and launch discipline. When `NEXT_PUBLIC_PHASE2_ENABLED` is off, the vault listing should not render mock/product content under a blur overlay, direct vault create/detail routes should redirect home, and profile pages should show “coming soon” text instead of linking users into inaccessible vault flows.

### 2026-04-02 — Vault private-ready math and state should reconcile exactly
- Affects vault crons and rebalance safety. Rebalance proposals now refuse non-active vaults, published epochs stamp `closed_at` even on zero-pool/zero-deposit skips, and vault epoch payouts reconcile their final rounded leaf so Merkle totals match the intended pool instead of drifting by accumulated 6-decimal rounding.

### 2026-04-02 — Vault snapshot and rebalance assumptions should match real persisted state
- Affects vault contracts and API discipline. `FeeVault.ATTRIBUTION_SNAPSHOT_TYPEHASH` now matches the real snapshot payload signed by `/api/vault/attribution-snapshot`, and `/api/vault/rebalance` now loads the vault row first so chain/tick context can fall back to persisted `social_vaults` metadata instead of always trusting the caller to supply the live range manually.

### 2026-04-02 — Public docs should describe vaults and universal core at product level
- Affects docs, architecture messaging, and vault launch discipline. GitBook copy was tightened to stay high level: live products remain front and center, Social Vaults are clearly framed as gated/private development, and universal core is described as background infrastructure rather than a public product or testnet-address inventory.

### 2026-04-02 — Codex should verify code paths before making repo claims
- Affects architecture/process discipline. Added an explicit rule that answers about codebase behavior, architecture, or design should be grounded in the actual files and traced code paths first, not memory, naming assumptions, or "what makes sense." When uncertain, check the implementation before answering.

### 2026-04-02 — `/agents` should show both integrations and live rankings
- Affects agent UX and routing clarity. The public `/agents` page now embeds a live leaderboard preview from `/api/agents/leaderboard` so users can see actual agent rankings on the main agents surface, while `/agents/leaderboard` remains the dedicated full ranking page.

### 2026-04-03 — Privy is merged but production still needs a post-upgrade redeploy
- Affects web3 onboarding and deployment workflow. Privy auth + embedded wallet support is already merged on `main` at commit `ec56a62d`, Privy dashboard settings and `NEXT_PUBLIC_PRIVY_APP_ID` were configured, but the live site stayed on an older production deploy because Vercel Hobby blocked new deployments due to unsupported frequent cron schedules. Once Vercel is upgraded, redeploy `main` (or commit `ec56a62d`) to make the Privy UI live.

### 2026-04-03 — Ethereum UX upgrade is implemented and pushed on `origin/claude/elastic-booth`
- Affects swap/trading, claims, campaign funding, vault flows, onboarding copy, and the Ethereum adoption roadmap. The first major Ethereum Foundation-inspired UX pass is now implemented and pushed on `origin/claude/elastic-booth`, even though it has not yet been manually merged back onto a fresh `codex/*` branch because `origin/main` has newer conflicting work in a few overlapping files.
- Swap/trading now has a pre-wallet confirmation sheet, fiat-first fee display, gas insufficiency warning, route and chain clarity, a readiness checklist, delayed wallet-help guidance, and a preflight call before sending LI.FI transactions.
- Claims now have clearer plain-language copy, safer batch-claim behavior, wrong-chain handling, and preflight simulation before EVM claim writes.
- Campaign funding now checks allowance before asking for approval, explains spender permissions more clearly, distinguishes permission vs deposit steps, and preflights `depositCampaign()` before submission.
- Vault deposit and seed flows now do allowance checks, include zero-first fallback behavior for problematic approvals, run preflight simulation before final writes, and expose clearer step/recovery messaging. Vault create success copy was also corrected so it no longer implies the user must manually call `seedTeamTokens()` after a successful seeded flow.
- Landing/nav copy was shifted toward lower-anxiety adoption language such as exploring first and connecting when ready to trade.
- This upgrade intentionally does **not** yet include ERC-20 gas payment, approval management/revoke UI, persistent resumable flow state across refresh, or deeper intent-based chain abstraction. Company-paid gas sponsorship is still not the target product policy.

### 2026-04-03 — Production truth now needs a whole-platform map, not just feature notes
- Affects architecture, deployments, schema discipline, and launch readiness. Mintware now has enough moving parts that "production ready" can no longer be judged from one subsystem at a time. The current live model is EVM-first with Privy onboarding, Ethereum UX improvements on the main transaction surfaces, Solana paused from the live product, and newer backend domains for universal rewards and AI agents.
- The biggest remaining production risk is drift rather than one broken feature: `vercel.json` now runs daily crons while some route comments still describe older schedules, [`docs/ARCHITECTURE.md`] is materially stale, and Supabase migration history is no longer a clean mirror of production. Remote-only migrations `20260401000001-3`, local-only migrations `20260329000003` and `20260401000004-7`, plus duplicate local version numbers mean future schema changes should be treated carefully until migration history is reconciled.
- New source-of-truth docs for this state live in [`docs/developers/platform-system-map.md`] and the refreshed [`docs/developers/production-readiness-inspection.md`]. Treat those as the current operating map until the older architecture doc is rewritten.

### 2026-04-03 — Live Supabase schema is closer to universal-ready than migration history suggests
- Affects schema discipline, universal rewards, and Solana pause interpretation. Direct linked-database inspection confirmed that production already contains `trade_signals`, `trade_signal_sync_state`, `universal_reward_epochs`, `universal_reward_allocations`, plus `universal_reward_epochs.distribution_id` and `published_at`, even though the repo records those versions as local-only migrations. That means the missing remote-only migrations `20260401000001-3` almost certainly carried at least part of the universal rollout, and the repo is missing part of the true production history.
- At the same time, `sol_distributions` does not exist remotely and `trade_signals.settled_epoch_id` is also absent, which fits the current product reality: Solana distributor work is not live, and the universal pipeline likely evolved without that specific bridge column. Treat future schema work as reconciliation first, feature work second, and use [`docs/developers/supabase-migration-reconciliation.md`] as the working record.
