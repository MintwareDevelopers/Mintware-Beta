# Mintware — Go-Live Audit

**Date: 2026-08-07. Scope: the whole platform (contracts, oracle, backend, frontend, copy, ops)
assessed for launch readiness.** Consolidates this session's oracle audit, core-loop reality check,
API-security scan, and dedicated frontend/UX + copy/legal deep-dives into one authoritative view.

> **Read the framing first — "go live" has two very different bars.**
> - **Testnet beta** (Base Sepolia, faucet funds, no real money at risk): a *reasonable* bar.
> - **Mainnet launch** (real deposits, real rewards): a *much higher* bar — and it has **hard blockers**
>   that no amount of frontend polish removes.
> Every verdict below is given for **both**.

---

## 1. Verdict

| | Testnet beta | Mainnet launch |
|---|---|---|
| **Overall** | 🟡 **CONDITIONAL GO** — after the §3 must-fixes (mostly small) + operator config | 🔴 **NO-GO** — hard blockers below |
| Contracts | Base-Sepolia vault deployed & works | **Audit PENDING** · reward path (weighted distributor) undeployed |
| Oracle / keys | fine for testnet | **exposed `ORACLE_PRIVATE_KEY` not rotated** · single hot key |
| Money at risk | none (faucet USDC) | real — and the vaults are unaudited |
| Honesty | good, once §3 copy items land | must not present unaudited vaults as safe |

**Mainnet hard blockers (non-negotiable):**
1. **Independent contract audit is PENDING** — the vault/hook/distributor family has not been audited.
   Do not accept real deposits into unaudited contracts.
2. **The reputation-weighted reward path is not deployed** — `MintwareWeightedDistributor` + the pair
   vaults exist and are tested (PR #48) but are deployed **nowhere**. "Earn reputation-weighted rewards"
   is not real on any chain yet.
3. **Exposed `ORACLE_PRIVATE_KEY` has not been rotated** (committed once, scrubbed but recoverable in git
   history — see oracle audit). Any mainnet oracle signing with it is compromised-by-default.
4. **Rate-limiting is inactive** (Upstash env unset → fails open); opening mainnet traffic without it
   invites abuse.

**Testnet beta is reachable** because none of the above risks real money — the honest loop is *connect →
real Attribution score → deposit test USDC into a real Base-Sepolia vault → withdraw → refer → real swap
(mainnet)*. The remaining testnet gate is §3's small must-fixes + operator config.

---

## 2. Findings by dimension (severity-ranked)

Severity: 🔴 blocks the relevant launch · 🟠 should-fix · 🟡 polish. Citations are `file:line`.

### 2.1 Smart contracts & on-chain
- 🔴 (mainnet) **Audit pending** — no independent audit of the vault/hook/distributor family. Copy already
  says "audit pending" (good); the *action* is: get the audit before mainnet.
- 🔴 (mainnet) **Reward path undeployed** — `MintwareWeightedDistributor` + pair vaults (PR #48) are not
  deployed on any chain; the current campaign `distributions`/`pending_rewards` tables are empty.
- 🟠 **One address reused across roles** — `0x4Deb74E9…Db9BE` serves `DISTRIBUTOR_ADDRESS_BASE`,
  `_ARBITRUM`, and `UNIVERSAL_DISTRIBUTOR` and is byte-identical to the Base-Sepolia FeeVault. Confirm the
  real per-chain distributor addresses before mainnet campaigns.
- ✅ Deployed & real: AIAttribution v3 (`0x11Ef2c7D…C421`, Base mainnet), ERC-8004 registry
  (`0x8004A169…`, Base), the Base-Sepolia SocialVault/hook. Guardian kill-switch + timelocked rotation
  exist on the new contracts (PR #48).

### 2.2 Oracle & key management  *(full detail: `oracle-audit-and-hardening-plan.md`)*
- 🔴 (mainnet) **Rotate `ORACLE_PRIVATE_KEY`** — exposure confirmed (commit `dd48a569`).
- 🟠 **Single hot EOA** signs across roles; PR #48 adds per-role key separation + a role resolver, but the
  physical split (provision `WEIGHT_/RANGE_/AGENT_/ROOT_ORACLE_PRIVATE_KEY`) is an operator step.
- 🟡 Trust-minimization (KMS/HSM → multisig, alerting) is roadmap (Tier 1).

### 2.3 Backend / API security
- ✅ **No secrets in tracked files.** No committed private keys / service-role keys.
- 🟠 **Rate-limiting INACTIVE** — `createHandler` rateLimit fails open until `UPSTASH_REDIS_REST_URL/TOKEN`
  are set. PR #50 adds limits to the two genuinely-open lead forms (`teams/apply`, `waitlist`); they
  activate only once Upstash is set. **Set Upstash before opening traffic.**
- ✅ **The create/register routes are NOT open** — `vaults/create`, `campaigns/create`, `agents/register`
  verify a signed message (`recoverMessageAddress`) despite `auth:'none'`. Earlier "22 unauth routes" was
  a false alarm from the declarative-auth heuristic.
- 🟡 Non-constant-time bearer compare (`routeHandler.ts`) — minor.

### 2.4 Build & deploy
- ✅ `tsc --noEmit` clean on the beta branch.
- 🟠 **Full production build not verified here** — the dev-server lock + session limits prevented running
  `next build --webpack`. `createHandler` does **not** set `export const dynamic`, so ~38 Supabase-reading
  routes are exposed to the known Vercel gotcha ("reading 'length' of undefined"). **Verify via a Vercel
  preview deploy of the branch** (the project's normal check) before relying on it.
- 🟠 **Concurrent-branch risk** — two sessions were committing to this repo simultaneously; `main` moved
  under this work. Coordinate a single deploy driver.
- 🟡 CI workflows exist (`ci.yml`, `anchor-deploy.yml`) — confirm they're actually green, not just present.

### 2.5 Data integrity
- 🟠 **Fabricated seed in prod Supabase** — 15 `social_vaults` rows all point at one Base-Sepolia contract
  with invented TVL; the 7 campaigns are fictional. PR #50 stops the *cards* from rendering fake TVL, but
  the rows remain. **Clean/reseed one honest vault** before beta.
- 🟠 **Fictional leaderboard fallback** — `/leaderboard` shows `DEMO_ENTRIES` when the worker is empty
  (`leaderboard/page.tsx:68`). Gate behind an explicit demo flag so real users never see a fake board.

### 2.6 Core user flows  *(reality of what a tester can actually do)*
- ✅ connect (EVM) · ✅ real Attribution score · ✅ real swap (LiFi, mainnet) · ✅ referrals (24h anti-sybil
  delay on a fresh wallet's own code) · ✅ **testnet vault deposit now works** (PR #50 chain-switch).
- 🟠 Campaigns earn→claim is not real (nothing funded) — keep it framed as preview.

### 2.7 Frontend / UX  *(full list in the UX deep-dive)*
- 🔴 **Mobile nav overflows** — `MwNav.tsx:59-127` has no mobile treatment; the authenticated nav
  horizontally overflows on 375px across every logged-in page. **The headline mobile bug.**
- 🔴 **Unguarded crash renders on partial API bodies** — `profile/page.tsx:178` (`totalLo/Hi.toLocaleString`),
  `app/[address]/page.tsx:680,684` (`chains`/`totalTxCount`). A 200 with a partial score object crashes the page.
- 🔴 **Vault-detail infinite skeleton** — `vault/[id]/page.tsx:313-325` `Promise.all` has no try/catch, so a
  fetch failure never clears `loading`. Wrap in try/finally.
- ✅ **Vault deposit wrong-network guard** — the UX agent flagged this against `main`; **already fixed in
  PR #50** (chain-switch to Base Sepolia before approve/deposit).
- 🟠 Silent bounce-to-home for logged-out deep links (`MwAuthGuard.tsx:22`) — show a "connect wallet"
  screen instead. Broken "View SDK docs" 404 (`agents/leaderboard:197`). Dead "Get notified →"
  (`rewards/page.tsx:309`). Public `VaultCard`/"Create" link to auth-gated targets → bounce.
- 🟡 `$NaN`/`NaN%` renders on partial fields — **`fmtUSD` NaN hardened in this commit**; a few call sites
  (`agent/[address]:141`, `Leaderboard.tsx:129`) still pass raw values worth guarding.

### 2.8 Copy / claims / legal honesty  *(full list in the copy deep-dive)*
- 🔴 **`/style/swap` + `/style/leaderboard` shipped shelved-RWA / "real-world yield" copy + a fabricated
  leaderboard to the public** (ungated). **FIXED in this commit** — both now `notFound()` in production.
- 🟠 **Over-broad reward claims** — `rewards/page.tsx:162,188` say the multiplier applies to "every action,
  every campaign"; per the framing doc it's Points-Campaigns-only. Scope it.
- 🟠 **RWA/issuer leftovers in the `/rewards` Teams view** — "tokenizing an asset", "issuers", "deal"
  (`rewards/page.tsx:132,143,450`). Reword to protocols/teams.
- 🟠 Homepage Growth-Vaults card shows component yields (8.5%, +0.6%) without an "illustrative" label
  (`app/page.tsx:219-231`); mock vault card asserts a $247.5K TVL (`vaults/page.tsx:27-45`).
- ✅ Production surfaces (`/`, `/defi`, `/teams`, `/about`, `/docs`, `/attribution`, `/swap`) are otherwise
  careful: "audit pending" stated, testnet labelled, illustrative calculators labelled, no "audited /
  risk-free / guaranteed / fixed-APY" anywhere, no surviving invented TVL/wallet stats.
- 🟡 Social handle mismatch (`@MintwareDev` in OG vs `@Mintware_org` in footer) — pick one.

### 2.9 Ops / monitoring / incident response
- 🟠 **Alerting is log-only** — stuck/unsigned/failed states are `console.log`, no PagerDuty/Slack. On a
  cron miss or oracle failure you find out from a user. Wire real alerts before mainnet.
- 🟠 **Cron reliability** — Vercel Hobby caps crons at once/day; a missed run stalls distributions a full
  day with manual-SQL recovery. Fine for beta; needs redundancy for mainnet.
- 🟠 **Guardian pause coverage is partial** — vaults/hook have `MWGuardianPausable`; PR #48 extends it to
  the new distributor + attribution token. Confirm every live money-path is pausable before mainnet.

---

## 3. Remediation roadmap

### To open the TESTNET BETA — CODE DONE ✅ (operator config remains)
**Code — all shipped on PR #50:** chain-switch + testnet banner + de-faked cards + rate-limits · `/style`
RWA-page gating + `fmtUSD` NaN · **mobile-nav hamburger (UX #1)** · **3 crash/skeleton guards (UX #2–4)** ·
**`DEMO_ENTRIES` leaderboard gated** to preview/dev · **reward multiplier copy scoped + RWA/issuer wording
dropped from `/rewards`.** Reward-path hardening + per-role keys are on PR #48.
Optional remaining polish (non-blocking): label the homepage vault-yield component rows "illustrative"
(`app/page.tsx:219-231`); broken "View SDK docs" 404; dead "Get notified →" CTA; marketing-nav mobile menu.
**Operator (the actual gate now):** set `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS`/`NEXT_PUBLIC_USDC_ADDRESS`
(Base Sepolia) · set Upstash env · clean/reseed the fabricated `social_vaults` rows · verify a **Vercel
preview build** passes · confirm CI green.

### To open MAINNET (the high bar — do NOT skip)
1. **Independent contract audit** of the vault/hook/distributor family. Blocker.
2. **Deploy the reward path** (weighted distributor + pair vaults) and wire it (PR #48 is code-complete).
3. **Rotate `ORACLE_PRIVATE_KEY`** on-chain + provision the per-role keys.
4. **Activate rate-limiting** (Upstash) and **real alerting** (not log-only).
5. **Move oracle signing to KMS/HSM → multisig** (oracle Tier 1).
6. Confirm every live money-path is guardian-pausable; run the fresh invariant fuzz on the wired vaults.

---

## 4. What this session already closed
- **PR #48** — reputation-weighted reward path built & hardened (real oracle verification, guardian,
  no-over-allocation, timelocked rotation, per-role keys, weighting engine, fail-closed liveness). Tested,
  unmerged.
- **PR #50** — beta vault usability + honesty (chain-switch, testnet banner, de-faked cards, open-route
  rate-limits). Unmerged.
- **This commit** — `/style` RWA lab pages gated out of prod; `fmtUSD` NaN hardened.

Nothing here is merged to `main` — all reviewable, and (per §2.4) coordinate a single deploy driver.
