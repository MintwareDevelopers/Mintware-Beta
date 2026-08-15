# Mintware Phase 1 — Audit Issues
> Produced by full-stack audit on 2026-03-19.
> Prioritized: P0 = blocks production, P1 = causes bugs, P2 = tech debt, P3 = cleanup.

---

## P0 — Blocks Production

### ISSUE-001: CRON_SECRET and SWAP_WEBHOOK_SECRET are empty
**Where:** `.env.local`, Vercel env vars
**Problem:** All cron routes (`/api/cron/*`) return 401 if called with no Bearer token, OR are wide open if the check is skipped in dev mode. Molten's swap webhook has no authentication.
**Fix:** Generate two random 64-char secrets. Set in Vercel env vars AND `.env.local`.
```bash
openssl rand -hex 32  # run twice, one for each
```

### ISSUE-002: NEXT_PUBLIC_DISTRIBUTOR_ADDRESS missing from Vercel
**Where:** `.env.local` and likely Vercel
**Problem:** The claim UI (`ClaimCard.tsx`, `onchainPublisher.ts`) reads `NEXT_PUBLIC_DISTRIBUTOR_ADDRESS` to know which contract to call. This variable is not in `.env.local` at all.
**Fix:** Add to both `.env.local` and Vercel:
- Testnet: `0xcf2EA99639C038a475B710b2Be82b974D777C306`
- Mainnet: `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE`

### ISSUE-003: Worktree `ecstatic-lewin` not merged to main
**Where:** Git
**Problem:** Critical changes exist ONLY in the worktree (not on GitHub main):
- `app/api/campaigns/join/route.ts` (NEW — the fix that replaced the broken Worker /join)
- `supabase/migrations/20260319000001_participants_and_activity.sql` (NEW tables)
- `components/campaigns/JoinButton.tsx` (modified to use local route)
- `app/campaign/[id]/page.tsx` (locallyJoined fix + ReferralCard + ActionsPanel props)
- `components/campaigns/ActionsPanel.tsx` (full rewrite with CTA buttons)
- `components/campaigns/ParticipantStats.tsx` (ref link fix)
**Fix:** Merge worktree to main, push to GitHub, redeploy Vercel.

### ISSUE-004: CORE_DAO_BRIDGE_CONTRACT still placeholder
**Where:** `.env.local`, `lib/campaigns/bridgeVerifier.ts`
**Problem:** Set to `0x__PENDING_MOLTEN_CONFIRMATION__`. Any code path touching the bridge verifier will fail. The cron route `bridge-verify` will error.
**Fix:** Get the contract address from Molten. Until then, keep the `bridge-verify` cron disabled in `vercel.json`.

---

## P1 — Active Bugs

### ISSUE-005: NEXT_PUBLIC_MW_TREASURY_ADDRESS is set to a contract address, not a treasury wallet
**Where:** `.env.local`
**Problem:** `NEXT_PUBLIC_MW_TREASURY_ADDRESS=0xcf2EA99639C038a475B710b2Be82b974D777C306` — this is actually the Base Sepolia **contract** address, not a treasury wallet. Any code sending platform fees to this address is sending to a contract that doesn't accept arbitrary transfers.
**Fix:** Remove this variable entirely. Replace all usages in code with the correct variables:
- For the LI.FI fee recipient: `NEXT_PUBLIC_MINTWARE_TREASURY` (0x3F9529...)
- For the distributor contract address: `NEXT_PUBLIC_DISTRIBUTOR_ADDRESS`

### ISSUE-006: `locallyJoined` is a band-aid, not a fix
**Where:** `app/campaign/[id]/page.tsx`
**Problem:** After joining, we set a client-side `locallyJoined = true` because the Attribution Worker's `GET /campaign?id=&address=` always returns `participant: null` (it reads its own DB, not our Supabase). This means:
- Refreshing the page resets `locallyJoined` to false → "Join Campaign" button reappears
- User appears unjoined after page refresh even if they are joined
**Fix (proper):** Build `GET /api/campaigns/[id]` that reads from our Supabase `participants` table and returns the real participant status. Replace the Worker call for participant state.

### ISSUE-007: Migration ordering conflict — `participants` table
**Where:** `supabase/migrations/`
**Problem:** Two migrations reference `participants` in conflicting order:
- `20260317000005_observer_and_cron.sql` — does `ALTER TABLE participants ADD COLUMN IF NOT EXISTS ...` (assumes table exists)
- `20260319000001_participants_and_activity.sql` — does `CREATE TABLE participants` (creates it)

If applied in timestamp order, `000005` runs first → fails because `participants` doesn't exist yet. The `CREATE TABLE` in `000319` fixes this but breaks migration idempotency.
**Fix:** Either:
a. Move the `CREATE TABLE participants` from `000319` into a migration with an earlier timestamp than `000005`, OR
b. Add a `CREATE TABLE IF NOT EXISTS participants (...)` stub at the top of `000005`

### ISSUE-008: `campaign_payouts` vs `daily_payouts` — two tables doing the same job
**Where:** Supabase schema
**Problem:**
- `campaign_payouts` (from `000005` observer migration): daily rank/referral payout records with `rank`, `type` (rank|referral), `epoch_date DATE`
- `daily_payouts` (from `000003` reconcile migration): per-wallet payout per distribution with `epoch_number INT`, `amount_wei`, `claimed_at`

These track similar data with different schemas. The `epochProcessor` writes to `daily_payouts`. The observer cron (if active) writes to `campaign_payouts`. The claim status route reads `daily_payouts`. So `campaign_payouts` is effectively orphaned.
**Fix:** Confirm `daily_payouts` is the canonical table. Drop `campaign_payouts` or document its separate purpose explicitly.

### ISSUE-009: Molten swap webhook is a stub
**Where:** `app/api/campaigns/swap-event/route.ts`
**Problem:** `SWAP_WEBHOOK_SECRET` is empty. Molten isn't configured to call this endpoint yet. The entire token pool reward pipeline (for WOLF campaign) depends on this webhook firing.
**Fix:**
1. Set `SWAP_WEBHOOK_SECRET` in both Vercel + Molten dashboard
2. Register `https://mintware-beta.vercel.app/api/campaigns/swap-event` as the callback URL in Molten

---

## P2 — Logic Gaps

### ISSUE-010: Attribution Worker owns campaign list display data
**Where:** `app/dashboard/page.tsx`, `app/campaign/[id]/page.tsx`
**Problem:** Campaign list and detail views are fetched from the external Attribution Worker. If the Worker is down or changes its schema, our app breaks. We have no control over this data.
**Fix (long-term):** Mirror campaign metadata from the Worker into our own `campaigns` Supabase table on create. Use our Supabase as the source of truth for campaign display. Use the Worker only for Attribution scores.

### ISSUE-011: Second Campaign Worker (`mintware-campaigns.ceo-1f9.workers.dev`) unused
**Where:** `.env.local` → `NEXT_PUBLIC_CAMPAIGN_WORKER_URL`
**Problem:** A second Cloudflare Worker URL is defined in env vars but no active code path uses it. It's unclear if this was a previous implementation or planned fallback.
**Fix:** Remove `NEXT_PUBLIC_CAMPAIGN_WORKER_URL` from all envs. If the Worker still has live traffic/data, document what it contains.

### ISSUE-012: Pool-settle cron may create redundant distributions
**Where:** `app/api/cron/pool-settle/route.ts`, `lib/campaigns/poolSettler.ts`
**Problem:** The cron runs every 15 minutes and builds a new Merkle tree from all `claimable` pending_rewards. If two cron runs overlap (e.g., settlement takes >15 min), two distributions could be created for the same rewards.
**Fix:** Add a Supabase advisory lock or check for `distributions WHERE status = 'pending' AND campaign_id = ?` before creating a new one.

### ISSUE-013: Price oracle has no staleness check
**Where:** `lib/campaigns/priceFeed.ts`
**Problem:** Price is fetched from CoinGecko (or custom feed) at swap time. If the price feed is stale or the API is down, rewards are calculated with the last known price.
**Fix:** Add a `fetched_at` timestamp check — reject prices older than 60 seconds.

### ISSUE-014: LI.FI integration duplicated across two files
**Where:** `lib/providers/lifi.ts` and `lib/swap/lifi.ts`
**Problem:** Two files implement LI.FI SDK integration. Unclear which is active and which is dead.
**Fix:** Consolidate into one file (`lib/providers/lifi.ts`). Delete the other.

---

## P3 — Cleanup

### ISSUE-015: 90 shadcn/ui components are dead weight
**Where:** `components/ui/`
**Problem:** 90 components scaffolded by shadcn at project init. None are used in app pages (all pages use inline styles). These inflate the bundle and add maintenance surface.
**Fix:** Don't delete yet (shadcn may be used in creator UI). Audit creator/ and campaign/ components for any `@/components/ui/` imports. If none, remove `components/ui/` entirely.

### ISSUE-016: `DEPLOYER_PRIVATE_KEY` and `DISTRIBUTOR_PRIVATE_KEY` in .env.local
**Where:** `.env.local`
**Problem:** Two real private keys are in `.env.local`. They are gitignored, so they won't be committed — but they exist in plaintext on disk. If Vercel sees these, they should be marked as sensitive.
**Fix:** Rotate both keys after each deployment. Never set `DEPLOYER_PRIVATE_KEY` in Vercel (it's only needed for local `hardhat:deploy:*` runs). `DISTRIBUTOR_PRIVATE_KEY` IS needed in Vercel for the cron signing path.

### ISSUE-017: `NEXT_PUBLIC_CAMPAIGN_WORKER_URL` in Vercel should be removed
**Where:** Vercel env vars (suspected)
**Problem:** If this was ever added to Vercel, it's a dead variable pointing to an unused Worker.
**Fix:** Remove from Vercel dashboard.

### ISSUE-018: `explorer.html` uses D3.js, not React
**Where:** `public/explorer.html`, `app/explorer/page.tsx`
**Problem:** The explorer page redirects to a static HTML file. It has no nav integration with the app. Lower priority but creates a dead-end user flow.
**Fix (deferred):** Acceptable for Phase 1. Convert to React page in Phase 2.

### ISSUE-019: `hungry-moore` worktree still exists
**Where:** `.claude/worktrees/hungry-moore/`
**Problem:** An old worktree from a previous session is still on disk. It may contain stale or conflicting changes.
**Fix:** Review and delete: `rm -rf ".claude/worktrees/hungry-moore"`

### ISSUE-020: Reown Cloud domain whitelist not configured
**Where:** https://cloud.reown.com → project 580f461c981a43d53fc25fe59b64306b
**Problem:** `localhost:3000` and the production Vercel domain are not whitelisted. WalletConnect connections may fail in production.
**Fix:** Add both domains in Reown Cloud dashboard.

---

## Summary by Priority

| Priority | Count | Issues |
|----------|-------|--------|
| P0 — Blocks production | 4 | 001, 002, 003, 004 |
| P1 — Active bugs | 5 | 005, 006, 007, 008, 009 |
| P2 — Logic gaps | 5 | 010, 011, 012, 013, 014 |
| P3 — Cleanup | 6 | 015, 016, 017, 018, 019, 020 |
| **Total** | **20** | |
