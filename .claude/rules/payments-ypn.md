# Payments — YPN, Settlement & the Off-chain Services

> **Status (2026-08-18):** the YPN loop is **proven live on Circle's Arc testnet** on branch
> `feat/ypn-vault-convergence` — **testnet + unaudited, NOT on `main`**. Never present as production.
> External audit + a real card issuer (CPN) gate real value. Canonical state: [`../STATE.md`](../STATE.md).

## What YPN is

The **Yield Payment Network** — a vault balance that stays **spendable as USDC** (cards, x402, Arc
settlement) *while it keeps earning*. Spend never un-parks capital: it's a hold against the earning
position → settle (burn shares → USDC to the payee). The "never idle, never locked, always yours" pillar.

- **Tranches:** community capital is **senior** (par, USDC-spendable); team capital is **junior**
  (first-loss). Fuses the matched-liquidity × ULV lineage (see [`vaults.md`](vaults.md)) with a payment
  gateway + a USDC yield adapter.
- **⭐ The ETH senior tranche** — the headline value prop — has its own explainer:
  [`../../docs/developers/eth-senior-tranche.md`](../../docs/developers/eth-senior-tranche.md). A community
  dollar that stays a spendable **$1 while earning DeFi yield**, because the junior tranche absorbs the
  volatility. The senior NAV is **price-free** and, since the 2026-08 audit (H1), **solvency-aware on
  redemption**: **par while covered, pro-rata haircut in the tail** (no first-redeemer run) — which is what
  makes "always $1" honest rather than a marketing claim. Live on Base Sepolia (testnet+mock+unaudited);
  see that doc for addresses. ⚠ The par-spendable-yield shape is the **#1 legal item** ([`/legal`](../../app/legal/page.tsx)) —
  public copy must avoid "deposit / savings / guaranteed / fixed APY" framing.
- Marketing surface: `/yield-payment-network` (zero-opportunity-cost cash narrative).

## On-chain stack (Forge — details in [`smart-contracts.md`](smart-contracts.md))

- `MintwareTreasuryVault` + `MintwareV4LiquidityModule` + standalone `MintwareTreasuryJitHook`
  (borrow-idle → JIT → settle atomically; junior backstops; senior NAV untouched).
- Payment gateway: `settleSpend` / `burnForPayment`.
- `MintwareERC4626YieldAdapter` — **fee-aware** (values NAV via `previewRedeem`, exits via `redeem`) so a
  fee-charging yield source (Arc's XyloVault, 10 bps exit) can't overstate the NAV backing par-spendable USDC.

## Off-chain services (Rust — `services/`)

| Service | Role | Surface |
|---|---|---|
| **edge-auth** (axum) | Sub-150 ms authorization: decide → reserve a hold off cached **NAV** with a VaR haircut → sign. Fail-closed bearer. Two Pre-audit #6 spend-safety gates in the decision core (`portfolio::PortfolioGuard`, both OFF by default): an always-liquid **hot-buffer reserve floor** (`reserve_floor_breached`) + a system-wide **circuit-breaker** (`circuit_breaker_open`), set via `MemStore::set_liquidity_reserve`/`set_breaker`. | `POST /authorize` · `GET /holds/:id` · `GET /available/:user` (read-only live spendable = NAV − holds − cap − liquidity − hot-buffer reserve; 0 while the breaker is open) · `POST /webhooks/rain` |
| **relayer** | Builds + submits `settleSpend` and the CCTP bridge orchestration. **A signing/submission library — no HTTP server yet** (a live `settle` endpoint = a separate server + funded key, deploy-gated). | `settle.rs` · `cctp.rs` · `batch.rs` · `submit.rs` |

Tests: `cd services/edge-auth && cargo test` (86) · `cd services/relayer && cargo test` (23); both
`cargo clippy -D warnings` clean.

**edge-auth is now actually hosted** (2026-08-20) — `https://mintware-edge-auth-production.up.railway.app`
on Railway (project `mintware-edge-auth`), pointed at the live Arc spend stack. First real deploy of this
service anywhere; previously only ever run locally during test sessions. `EDGE_SIGNER_KEY` is unset there
(no ≥$250-lane edge signature yet — matches the card-settle route's own sub-$250 cap), so the ≥$250 lane
still fails closed by design, not by omission. `services/edge-auth/railway.json` + `rust-toolchain.toml`
pin the build (Railway's default Nixpacks Rust toolchain was too old for this crate's dependency tree —
needed 1.90+, pinned to 1.94 to match the version this repo's tests are proven green on) and the
build/start commands (Railpack's auto-detected binary name didn't match this crate's `[[bin]] name`).
`EDGE_AUTH_URL`/`EDGE_AUTH_SECRET` are set on Vercel Production + Preview. The `relayer` row above is
still accurate — settle stays a separate, undeployed task.

## The Arc loop (proven on testnet, on-chain)

`deploy → deposit → earn → CCTP Base→Arc → card settle in USDC → edge authorizes ~10 ms off live Arc NAV.`
Topology: v4-ETH **earn** on Base ↔ **CCTP** ↔ USDC **spend** on Arc (Circle's USDC-native L1, chain
`5042002`, USDC is the gas token). Contracts are chain-agnostic (EIP-712 reads `block.chainid`).
Runbook: [`../../docs/developers/session-handoff-arc.md`](../../docs/developers/session-handoff-arc.md) ·
integration: [`../../docs/developers/arc-settlement-integration.md`](../../docs/developers/arc-settlement-integration.md).

## Where it connects

- **Agent-facing x402** (park/pay actions, facilitator, discovery) → [`agents.md`](agents.md).
- **Env + testnet deploys** (edge/relayer/Arc/x402 vars) → [`deployments.md`](deployments.md).
- **Vaults / ULV / pool tiering** → [`vaults.md`](vaults.md).
- **Human org cards (Lithic sandbox)** → below.

## Human org cards — Lithic sandbox (2026-08-19)

The showcase loop: **issue → activate → swipe → authorize → settle**, live at `/app/org/[slug]/cards`
(a real page — `app/app/team/cards/page.tsx` stays the illustrative mock; they are NOT the same
surface). `lib/org/rolePresets.ts`'s `contributor` preset already said "spend up to $2,000/day from
the treasury via card / x402" — cards were always meant to draw on the same org treasury + role-cap
system `/api/orgs/[id]/pay` uses for vendor payouts, not a separate product. **Lithic sandbox only**
— production issuance is a separate KYB-gated Lithic tier, not a config flip, and is NOT what "CPN"
elsewhere in this doc refers to (CPN is the Circle-relationship card issuer the honesty banners
treat as the real gate for going live with real value; Lithic is the demo/showcase rail).

**Provider primary/fallback:** Lithic is the primary card-issuing provider (fast self-serve sandbox,
default-open real-time ASA decisioning). Rain is a fallback option only, not wired — see the
Crossmint/Rain/Bridge/Lithic comparison in session notes if resurrecting that evaluation.

- `lib/cards/lithic.ts` — provider-specific leg: sandbox card creation + `simulateSwipe()` (fires a
  real ASA round-trip via Lithic's own `simulateAuthorization`, for demoing without a physical
  card) + ASA webhook parse/verify (`standardwebhooks` under the hood via the SDK, fails closed
  without `LITHIC_WEBHOOK_SECRET`). Sandbox PAN is stored (`org_cards.sandbox_pan`) only because
  Lithic's simulate call needs it and a sandbox PAN has no real-world payment value — not a pattern
  for a real PAN.
- `lib/org/cardAuthorize.ts#decideCardSwipe` — the decision: belt (`org_members.role`'s daily cap)
  + suspenders (the *same* `httpEdgeAuthorizer` port x402 uses). Fails closed when
  `EDGE_AUTH_URL`/`_SECRET` are unset, same posture as everywhere else.
- `app/api/cards/lithic/webhook/route.ts` — the real-time ASA responder (manual Standard-Webhooks
  verification) + logs every decision to `card_swipe_events` (the spend feed's source).
- `app/api/cards/lithic/capture-webhook/route.ts` — the **automatic settlement** counterpart. Lithic's
  general Events webhook (`card_transaction.updated` → `status: SETTLED`, DISTINCT secret
  `LITHIC_EVENT_WEBHOOK_SECRET`) fires when the network clears a charge; this matches it back to the
  `card_swipe_events` row (`provider_event_ref` = the shared transaction token) and, behind the
  auto-settle valve, runs the same settle core. **Enrollment is a one-time dashboard step** (create
  an Event Subscription → this URL, subscribe `card_transaction.updated`, copy its signing secret),
  symmetric with how ASA was enrolled.
- `lib/org/settleSwipe.ts#settleSwipeEvent` — the **shared settle core** both the button and the
  capture webhook call, so the manual and automatic paths can't drift. Auth-free (the caller gates);
  holds all the pre-flight money-safety guards (approved · unsettled · <$250 · optional lower auto
  cap · activated permit · not expired). 7 Vitest cases lock the valve + refusals.
- `app/api/orgs/[id]/cards/{route,list,[cardId]/activate,simulate-swipe,events,settle}.ts` — issue
  (owner) · list + activate (member signs a standing EIP-712 `DelegatedSpendPermit` once, reused
  across many swipes per `docs/page.tsx`'s "long-lived permit is reusable") · simulate-swipe (any
  member, fires the real ASA round-trip) · events (spend feed) · settle (owner, sub-$250 only —
  see below).
- `org_cards` (migration `20260819000002`) + `card_swipe_events` + permit columns (migration
  `20260819000003`) — identity mapping, the decision audit trail, and the member's standing permit.
- **Settlement is real** (reuses the exact `settleSpend` proven live — leg 3 of
  `lib/proof/latestRun.ts`, tx `0x7fd4b3f0…` — via `getOracleSigner('root')` in the RELAYER_ROLE
  seat). Two triggers, one core (`settleSwipeEvent`): the **owner-clicked button** (default; a human
  is the review checkpoint) and the **capture webhook** (opt-in automatic). Capped under $250 both
  ways (≥$250 needs an unwired edge-auth `ShortLivedHoldAuth`). The webhook's auto path is gated by a
  three-part **safety valve** so an unsupervised signer stays bounded: `LITHIC_AUTO_SETTLE_ENABLED`
  must be `'true'` (default OFF → everything stays a manual click), `LITHIC_AUTO_SETTLE_MAX_USD`
  (default $50) leaves larger swipes for manual review, and the shared core's hard <$250 ceiling
  applies regardless. This is still **not** the always-on relayer HTTP server in "Deploy-gated
  remainder" — it's the same on-demand oracle-signer pattern, now optionally fired by a capture event
  instead of a click, for small swipes only.

## Treasury provisioning — REQUIRED post-deploy steps (learned from the 2026-08-20 E2E)

Standing a treasury vault up is not enough for the card/settle path to work — two config steps are
mandatory, and skipping either fails **silently on-chain** (the tx mines with status 0):

1. **Grant `RELAYER_ROLE` to the ORACLE signer on the gateway.** `settleSpend` is submitted by
   `getOracleSigner('root')` (e.g. `0x7fd88b02…`), NOT the deployer. `DeployTreasuryV2.s.sol` grants
   it when its `RELAYER` env is set — but the **factory** path (`MintwareTreasuryVaultFactory`) grants
   roles to `gatewayAdmin` (the deployer), so the oracle signer must be granted separately:
   `cast send <gateway> "grantRole(bytes32,address)" $(cast keccak RELAYER_ROLE) <oracleSigner>`.
   `requiredGatewayRoleGrants()` (`lib/web3/vault/treasuryProvisioning.ts`) returns the exact grants.
   (Without it, settle reverts `AccessControlUnauthorizedAccount` — and a caller that doesn't check
   `receipt.status` would mis-record it as settled; the settle core now checks it.)

2. **Point edge-auth at THIS vault.** edge-auth authorizes off a SINGLE, env-configured vault
   (`EDGE_VAULT_ADDRESS` / `EDGE_VAULT_KIND`) — the `/authorize` request carries only `{user, amount,
   hold_id}`, **no vault**. So a card only authorizes correctly when edge-auth's `EDGE_VAULT_ADDRESS`
   is the org's treasury. **Known limitation:** one edge-auth instance = one treasury. True
   multi-treasury (many orgs, one edge-auth) needs a **per-vault NAV** feature — the refresher tracking
   several vaults and `/authorize` keying by vault address. Tracked as a follow-up, not wired.

## Deploy-gated remainder (not code)

Always-on auto-settling relayer HTTP server + its own funded key (today's card settle is
owner-triggered against the oracle signer instead — see above; vendor pay + x402 settle still need
this for their own automatic paths) · edge-auth-signed high-value (≥$250) card settlement leg · CPN
card issuer for production (the genuine Circle-relationship piece; Lithic above is sandbox-only and
a different thing) · Arc mainnet (Sept 16, 2026) · external audit of the converged stack.
