# Vaults & RWA — Build Spec

**Status:** Shipped to `main` and production (`mintware.finance`), 2026-07-27.
**Scope:** the two-surface (DeFi + RWA) vault system on a shared ERC-4626 base — amplification layer,
the full RWA deal pipeline (no new contracts), admin review surface, and the redemption lifecycle.

This is the engineering reference. Product-level docs: [Two-Surface Vaults](../vaults/overview.md) ·
[RWA Deals](../vaults/rwa-deals.md). Target architecture + sequencing:
[Phase 3 Two-Surface Architecture](phase3-two-surface-architecture.md). Live contract addresses:
[Smart Contracts](smart-contracts.md) and [Phase-3 Deploy Runbook](phase3-deploy-runbook.md).

---

## 1. Architecture

A multi-tenant vault coordination layer on **Uniswap V4** with two surfaces sharing one foundation:

- **Shared base:** `MintwareBaseVault4626` (ERC-4626) + a multi-tenant factory + `MintwareVaultRegistry`,
  `FeeVault` (7-day epochs), off-chain Attribution scoring with an on-chain soulbound mirror, a V4
  hook layer, and a Router.
- **DeFi surface:** permissionless yield — dynamic fees, idle-capital routing, MEV protection,
  attribution-weighted fee share.
- **RWA surface:** legal-wrapped tokenization — oracle-anchored price bands, `vRWA` bearer instrument,
  SPV + KYC registries, async redemption, kill-switch.

The **off-chain deal pipeline** (this cycle's deliverable) sits on top of the shared base and requires
**no new contracts** — it persists issuer/deal/redemption state in Supabase and gates it behind
Mintware review, so it ships to production ahead of the RWA contracts clearing legal.

---

## 2. Contracts

### DeFi family (`contracts-v4/src/`)
| Contract | Role |
|---|---|
| `MintwareDeFiVault4626.sol` | ERC-4626 DeFi vault; one-shot `seedTeamTokens` initializes the V4 pool |
| `MWSocialHook.sol` | Uniswap V4 hook — dynamic fee, MEV capture, attribution split |
| `FeeVault.sol` | Fee accrual + 7-day epoch distribution |
| `lib/LockLib.sol` | Lock tiers — Flex/Committed/Aligned/Core = 1.00/1.15/1.30/1.50×; early-exit penalty taper (2.0/1.0/0.5% → 0) |
| `lib/FeeLib.sol` | Attribution-weighted fee-share math |
| `MintwareVaultRegistry` | On-chain vault registry (`keccak256(chainId, vault)` → vaultId) |

### RWA family (`contracts-v4/src/rwa/`) — testnet, mainnet gated on legal

> **⚠ Target compliance structure changed (2026-08-05).** The table below is the *current* code
> ("permissionless everything, KYC only at settle"). Legal set the target to the **three-role model**
> (LP USDC-only/ungated · pool = whitelisted permitted holder · trader KYC-gated in `beforeSwap` on
> receipt). Not yet built; the current contracts diverge on 3 points. See
> [RWA Compliance — Three-Role Model](rwa-compliance-three-role-model.md).
| Contract | Role |
|---|---|
| `MintwareRWAVault4626.sol` | Mints `vRWA` 1:1; async `requestRedeem` → 30-day window → `confirmSettlement` (KYC at settle) |
| `MintwareVRWA.sol` | ERC-20 bearer token; transfer modes (permissionless / whitelisted / frozen); 48h timelock; guardian freeze |
| `MintwareOracleHook.sol` | Oracle-anchored price bands — ±15% core / ±45% spec; outside-spec swaps revert |
| `SPVBeneficiaryRegistry.sol` | KYC tiers (None / Basic / Accredited / Institutional) |
| `SPVAssetProviderRegistry.sol` | Issuer lifecycle (None / Registered / Verified / Suspended) + `metadataHash` |
| `PVDistributionEscrow.sol` | Merkle-based, KYC-gated dividend distribution |

**Fee split** (`FeeVault` default, owner-configurable, sums to BPS): 70% LPs / 15% referrers /
10% protocol treasury / 5% Attribution bonus pool. The bonus pool is a rolling pot — each epoch
seeds the next, and `sweep()` adds unclaimed rewards from expired epochs — redistributed to
Attribution-weighted LPs the following epoch.

---

## 3. Off-chain data model (Supabase)

Migrations `20260726000001_phase3_vault_registry.sql` and `20260727000001_rwa_deal_schema.sql`
(**applied to production**). The four new tables have **RLS enabled with no policies** → service-role
access only (the app reads exclusively via the service client).

| Table | Purpose |
|---|---|
| `social_vaults` (+ `surface`, `vault_standard`, `provider`, `registry_*`) | Vault rows; `surface ∈ {defi, rwa}` drives the surface-aware UI |
| `vault_issuers` | Issuer profiles; `status ∈ {REGISTERED, VERIFIED, SUSPENDED}` mirrors the SPV registry |
| `vault_deals` | Per-RWA-vault deal metadata; `review_status ∈ {draft, in_review, approved, rejected}` gates visibility |
| `vault_deal_documents` | Data-room links + documents; each individually reviewed |
| `vault_redemptions` | Async redemption requests; `status ∈ {pending, ready, settled}` |

RWA drafts have no token/seed/pool yet, so the migration relaxes the DeFi-only `NOT NULL`s on
`social_vaults.{project_token, seed_amount, pool_key}`.

---

## 4. API routes

All use the `createHandler` factory (`ctx.supabase`, `ctx.json`, `ctx.log`). Reads fall back to mock
data when tables are empty (the discovery seam), so nothing breaks pre-migration.

**Public**
| Route | Purpose |
|---|---|
| `GET /api/vaults/amplify-data` | Live stats + reputation leaderboard (real subgraph, honest empty state) |
| `GET /api/vaults/issuers[?verified=1]` | Issuer directory (create-flow dropdown) |
| `POST /api/vaults/issuers/register` | Self-serve issuer registration → REGISTERED (signed) |
| `POST /api/vaults/rwa` | Author an RWA deal → in_review (signed, VERIFIED-issuer gated) |
| `GET /api/vaults/[id]/deal` | Approved deal for a vault (approved-only, public) |
| `GET /api/vaults/redemptions?holder=` · `POST` | Holder's requests · request a redemption (signed) |

**Admin** (`verifyAdmin` — allowlisted wallet + dev bypass)
| Route | Purpose |
|---|---|
| `GET /api/admin/vaults/review` | Pending issuers + in_review deals + non-settled redemptions |
| `POST /api/admin/vaults/issuers/[id]` | Set issuer status (VERIFIED / SUSPENDED) |
| `POST /api/admin/vaults/deals/[id]` | Approve / reject a deal (+ cascade to documents) |
| `POST /api/admin/vaults/redemptions/[id]` | Advance ready / settled (+ KYC flag) |

---

## 5. Frontend surfaces

| Route | What |
|---|---|
| `/vaults` | Two-surface discovery + `VaultAmplify` (reputation-yield calculator, live stats band, lock tiers, trust panel, leaderboard) |
| `/vault/[id]` | Surface-aware: DeFi LP detail, or `RwaVaultDetailView` (deal page + `DealSection` + redemption rail) |
| `/vault/create` | Surface picker → DeFi wizard **or** `RwaCreateFlow` (issuer → instrument → deal → data room → review) |
| `/issuer/register` | Self-serve issuer onboarding |
| `/admin/vaults` | Mintware review queue — verify issuers, approve/reject deals, settle redemptions |
| `/redemptions` | Holder view of their redemption requests (pending / ready / settled) |
| `/style/vaults`, `/style/vaults/[id]` | Design previews behind `NEXT_PUBLIC_ATX_PREVIEW` |

**Shared components:** `components/vaults/VaultAmplify.tsx`, `components/vaults/DealSection.tsx`.
**Data layer:** `lib/rwa/{db,deal,issuer,redemptions}.ts` (server-only reads, mock fallback),
`lib/vaults/{discovery,subgraph}.ts`, `lib/web2/admin.ts`, `lib/web3/signedActionMessages.ts`.

---

## 6. Lifecycle state machine

```
ISSUER:   register ──▶ REGISTERED ──(admin verify)──▶ VERIFIED ──(admin)──▶ SUSPENDED
DEAL:     author ────▶ in_review ──(admin approve)──▶ approved  (│ reject ▶ rejected)
                                                          └──▶ published at /vault/[id]
REDEEM:   request ───▶ pending ────(admin)──▶ ready ──(admin settle, KYC)──▶ settled
```

Gates: only `VERIFIED` issuers can author; only `approved` deals render publicly; only `approved`
documents show in the data room.

---

## 7. Admin auth

`lib/web2/admin.ts` — browser-safe, no server secret in the client:

- The admin connects a wallet and signs a short-lived session message (`buildAdminMessage`), sent as
  `X-Admin-Message` / `X-Admin-Signature` headers on every admin request.
- `verifyAdmin(req)` recovers the signer and checks it against `ADMIN_WALLETS` (comma-separated env).
- **Dev bypass:** in development, admin auth is skipped (mirrors `MwAuthGuard`) so the surface is
  usable locally without an allowlist.

**Required prod env:** `ADMIN_WALLETS`. **Optional:** `NEXT_PUBLIC_VAULT_SUBGRAPH_URL` (live stats +
leaderboard real data), `UPSTASH_REDIS_REST_URL/TOKEN` (rate limiting; fails open if unset).

---

## 8. Shipped vs pending

**Shipped (production):** amplification layer · surface-split create flow · RWA deal authoring ·
review admin (issuers/deals/documents/redemptions) · issuer self-registration · published deal page ·
redemption request + settle (off-chain intent ledger) · schema + RLS.

**Pending:**
- **On-chain RWA deposits + settlement** — the RWA contract family is on testnet; mainnet is gated on
  the legal track. The redemption rail is an off-chain intent ledger until then.
- **Threshold seeding** — the fair-launch bootstrap (team escrows the token side, public co-seeds the
  quote side, pool deploys at a fill threshold, grows proportionally). Design is complete
  ([RWA create-seed design](phase3-rwa-create-seed-design.md)); the escrow/bootstrap contract is **not
  built** — it's the next separate contract track.
