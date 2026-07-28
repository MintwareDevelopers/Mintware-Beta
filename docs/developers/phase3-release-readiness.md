# Phase 3 — Production Release Readiness (go/no-go)

**Status: 🔴 NOT ready to ship as-is** — audit 2026-07-28. Blockers are **config + a few fixes**, not architecture.
`feature/phase-3 → main` auto-deploys to mintware.finance via Vercel.

**Scope:** 15 commits ahead of main · 34 files · +3,130 / −22.

---

## 🔴 Must-fix — reaches the live site
- [x] **Homepage example TVLs — hidden (option B applied).** ✅ `VaultAmplify` now renders real TVL only for real vaults; example rows show `—` (name / surface / model-APY + "Example" tag remain). Stats band was already honest. `components/vaults/VaultAmplify.tsx:518`
- [ ] **`/vaults` mock fallback** renders fabricated cards on API failure (dismissible banner only). Harden fetch + drop prod mock, or keep gated.
  `app/(rewards)/vaults/page.tsx:32-82`
- [ ] **`NEXT_PUBLIC_VAULTS_LOCKED` decision** — defaults UNLOCKED (vaults live). Set `'true'` in Vercel if vaults are still coming-soon.
  `app/(rewards)/vaults/page.tsx:54`, `app/(rewards)/profile/tabs/LiquidityTab.tsx:67`
- [ ] **Apply 2 migrations to prod Supabase** — `20260727000002_seed_schema.sql`, `20260728000001_rwa_incentive_surface.sql`. Else every RWA surface silently serves mock.
- [x] **`swap-event` hardened** — endpoint is open *by design* (client-side LI.FI can't carry a secret; real protections = payload validation + $10k cap + tx-hash dedup + on-chain fee verify). ✅ Added per-IP rate-limit (20/min, fails open without Upstash). `SWAP_WEBHOOK_SECRET` only gates Molten's server callback. `app/api/(rewards)/campaigns/swap-event/route.ts`
- [ ] **Confirm no non-prod `NODE_ENV` deploy** — admin dev-bypass grants RWA-queue admin (approve deals, verify issuers, settle redemptions) when `NODE_ENV !== 'production'`.
  `lib/web2/admin.ts:21,35`
- [ ] **Keep `NEXT_PUBLIC_ATX_PREVIEW` OFF in prod** — gates all `/style/*` mock pages (always-mock attribution profile, fake VERIFIED issuer, mock redemptions).

## 🟡 Should-fix — correctness / abuse
- [x] **Float money-math → BigInt** — ✅ fixed `usdToWei` to exact integer arithmetic (no precision loss at 18 decimals / sub-cent payouts); Vitest still 188/188. `lib/rewards/priceFeed.ts`
- [x] **`eas/attest-score`** — already protected: rate-limited (1/hr per IP) + 30-day attestation cache (repeat calls return the cached UID, no re-attest). No signer-spend hole; no change needed. `app/api/(rewards)/eas/attest-score/route.ts:130`
- [ ] R5 duration-match bonus inert (`lockDays: 0`). `app/api/(rewards)/cron/rwa-hold-snapshot/route.ts:19`
- [ ] `attest-reward` empty-secret fallback (`SWAP_WEBHOOK_SECRET ?? ''`). `app/api/(rewards)/eas/attest-reward/route.ts:119`

## ✅ Verified clean
- No hardcoded secrets — all `process.env`, `.env*` gitignored.
- Admin **write** routes guarded (verifyAdmin / signed-message / CRON_SECRET).
- `/style/*` (incl. concept landing) gated on `NEXT_PUBLIC_ATX_PREVIEW`.
- Working tree clean (cache + local session files only).
- Dead code (deprecated referral route, legacy helpers) documented, low-risk.

## ⏳ Pending checks
- [x] `pnpm test:all` — **GREEN**: Vitest 188 · Hardhat 74 · Forge 181 (2026-07-28)
- [ ] `pnpm build` (`next build --webpack`) — run with dev servers stopped

## Env / flag config to verify in Vercel before deploy
| Var | For | Note |
|---|---|---|
| `NEXT_PUBLIC_VAULT_SUBGRAPH_URL` | real vault data | unset ⇒ mock TVLs on homepage |
| `NEXT_PUBLIC_VAULTS_LOCKED` | vault gating | `'true'` = coming-soon overlay |
| `NEXT_PUBLIC_ATX_PREVIEW` | `/style` gate | **must be unset/false in prod** |
| `SWAP_WEBHOOK_SECRET` | swap-event auth | **must be set** |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `COVALENT`, hook/vault addresses | features | verify present |

**Migrations:** apply both pending files to prod Supabase before/with the deploy.
