# Phase 3 — Two-Surface Vault Architecture (Plan of Record)

**Status:** Planning → Foundation
**Branch:** `feature/phase-3` (off the post-merge `codex/ef-builder-review` HEAD `4fcd4c29`)
**Source spec:** `Mintware_Build_Spec_v1.0_ClaudeCode.pdf` (treated as *loose suggestion — outcome is the target, not the file list*)
**Created:** 2026-07-26

This document is the authoritative roadmap for Phase 3. The PDF spec is idealized/clean-room; this plan reconciles it with what Mintware has actually shipped and defines what we build. When a track lands, its detailed contract/API reference moves into the relevant `.claude/rules/*.md` file — this doc holds the *target + sequencing*, the rules docs hold *what exists*.

---

## 1. North Star (the outcome we're after)

A multi-tenant vault coordination layer on **Uniswap V4** with **two surfaces sharing one foundation**:

- **Surface 1 — DeFi:** permissionless yield coordination. Volatility-adjusted fees, idle-capital routing, MEV protection, attribution-boosted fee share.
- **Surface 2 — RWA:** legal-wrapped tokenization. Oracle-anchored price bands (±15% core / ±45% spec), `vRWA` instrument (whitelist-gated at transfer for Reg D; open for Reg A+), SPV + KYC registry, async redemption, kill switch.

**Shared foundation both surfaces inherit:** ERC-4626 base vault, multi-tenant factory, FeeVault epochs (7-day), Attribution (off-chain scoring + on-chain soulbound mirror), a V4 hook layer, and a Router.

---

## 2. Locked decisions (2026-07-26)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Surface scope this cycle | **Both surfaces in parallel** | DeFi hardening and RWA build proceed together off the shared foundation; RWA mainnet gated on the legal track. |
| D2 | Attribution model | **Keep off-chain scoring as source of truth + add a thin on-chain soulbound *mirror*** | Preserves live 100+ chain (incl. Solana) coverage; adds on-chain verifiability/composability without rebuilding the scoring engine. |
| D3 | Vault base | **Commit to ERC-4626 base + multi-tenant factory** | Shared foundation for both surfaces; unlocks composability (Aave/Morpho/Pendle). |
| D4 | Approach | **Evolve, don't greenfield** | Migrate proven `SocialVault`/`FeeVault`/`MWSocialHook` logic into the new structure rather than matching the PDF's exact file list. |

---

## 3. Current state → target (condensed gap analysis)

Full analysis: [[spec_v1_direction]] (memory). Three buckets:

### 🟢 Already deliver the outcome (keep / migrate, don't rebuild)
- V4 hook + LP vault + CREATE2/HookMiner deploy → `contracts-v4/src/{MWSocialHook,SocialVault}.sol` (live Base Sepolia)
- 7-day epoch fee distribution → `FeeVault.sol` + `contracts/MintwareDistributor.sol` (Merkle) — **epoch cadence matches spec**
- Reputation-boosted fee share → `FeeLib.sol` multipliers (1.0–1.95×)
- Lock tiers → `LockLib.sol` (4 tiers, 1.0–1.5×)
- Attribution scoring → off-chain 6-signal Worker (`attribution-scorer…workers.dev`), live 100+ chains incl. Solana
- Referral / network graph → referral system + `/explorer` D3 graph
- Emergency kill-switch pattern → `Pausable` + `emergencyWithdraw` in Distributor
- MEV → revenue → `MWSocialHook.afterSwap` deviation-capture

### 🟡 Partial / needs reshaping
- **ERC-4626 base** — `SocialVault` is bespoke, not 4626 (blocks composability)
- **Multi-tenant factory** — none on-chain; deploy is one-shot; multi-tenancy is Supabase-only
- **MEV *protection*** — only capture exists; no TWAP / sandwich detect / cooldown
- **Fee model** — no entry/exit/band fees (early-exit penalty instead); split is 70/15/10/5 buckets, not 50/25/25
- **Pool profiles + volatility/depth dynamic fees** — absent (static admin-set fee override)
- **Idle-capital routing** — absent entirely
- **Vault subgraph** — the in-repo subgraph indexes AI agents, not vaults; vault data is Supabase-first

### 🔴 Net-new
- **Entire RWA surface** — `vRWA`, SPV/KYC registries, oracle price bands, async redemption, reserve ratios
- **On-chain soulbound Attribution token** (mirror of off-chain score)
- **On-chain Router** — routing is via LI.FI proxy today. Design: [`phase3-router-design.md`](phase3-router-design.md) (best-execution meta-router: MW pools for listed assets, LI.FI fallback; prerequisite for RWA tradability)
- **Chainlink Data Streams / appraisal feed** — Pyth (DeFi) + CoinGecko today

**Stack note:** we are *ahead* of the spec — Next 16 (spec: 14), Solidity 0.8.26 (spec: 0.8.25), wagmi 3 / viem 2. No Safe multisig deploy yet.

---

## 4. Target architecture

```
                         MintwareVaultFactory
                 createVault(VaultConfig) → (vaultId, vault, vRWA)
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                             ▼
        MintwareBaseVault4626 (abstract, ERC-4626)
        · deposit/withdraw · lock tiers · withdrawal queue
        · epoch triggers · V4 unlock/liquidity plumbing
        · virtual: _deployLiquidity / _removeLiquidity
                   _calculateDynamicFee / _rebalanceIdleCapital
                    │                             │
        ┌───────────┴───────────┐     ┌───────────┴────────────┐
        ▼                       ▼     ▼                        ▼
  MintwareDeFiVault4626              MintwareRWAVault4626
  (ex-SocialVault, now 4626)        vRWA mint/burn · async redeem
  targetPools · profiles            reserves 40/60 · kill switch
        │                                   │
        ▼ hook stack (DeFi)                 ▼ hook stack (RWA)
  MEV · DeFi(vol/depth) · Idle ·     Oracle(bands) · MEV · Idle ·
  Attribution · FeeVault             Attribution · FeeVault

  Shared: FeeVault (epochs) · MintwareDistributor (claims) ·
          Router · Attribution off-chain Worker + soulbound mirror ·
          SPV/KYC registries (RWA only)
```

**Hook approach:** keep the pragmatic model — extend capabilities on the existing hook rather than a religious split into 6 separate contracts, *unless* the V4 permission-bit / gas story makes separate hooks cleaner. Decide per-capability during Track A/B.

---

## 5. Build tracks

### 🔑 Track 0 — Foundation (critical path; blocks A & B)
**Deliverables**
1. `MintwareBaseVault4626.sol` — abstract ERC-4626. Migrate `SocialVault` machinery: lock tiers (`LockLib`), 2-step withdrawal + notice/min-hold, V4 `unlock`/liquidity callbacks, epoch triggers. Expose `_deployLiquidity` / `_removeLiquidity` / `_calculateDynamicFee` / `_rebalanceIdleCapital` as `virtual`.
2. `MintwareVaultFactory.sol` — `createVault(VaultConfig) → (vaultId, vault, vRWA)`, `getVault`, upgradeable implementation, on-chain registry. `VaultConfig { provider, underlyingToken, minDeposit, entryFeeBps, exitFeeBps, hooks[], enableMEVProtection, enableIdleCapital, idleTargetRatio }`.
3. `MintwareDeFiVault4626.sol` — refactor of `SocialVault` onto the base (behavior preserved, now 4626).
4. Adapt `FeeVault` wiring to factory-created vaults (per-vault registration).
5. Forge test harness for base + factory + DeFi refactor. Fresh Base Sepolia redeploy.
6. **Off-chain reconciliation:** factory becomes registry source of truth; Supabase `social_vaults`/`vault_epochs` index it. Migration plan for existing rows.

**Risks:** existing deployed `SocialVault` on Base Sepolia — plan a clean redeploy, not an upgrade. Confirm `via_ir` + 0.8.26 + vendored v4-core interplay with OZ ERC4626.

### Track A — DeFi surface hardening (depends on Track 0)
- Real **MEV protection**: TWAP accumulator + `detectSandwich` + per-trader cooldown, layered on top of existing capture.
- **Volatility/depth dynamic fee**: `calculateVolatilityFee` / `calculateDepthFee` replacing the static override.
- **Pool profiles**: BLUE_CHIP ±5% / EMERGING ±10% / MEME ±20% tick ranges driving `_deployLiquidity`.
- **Idle-capital hook**: route idle to yield pools, `idleTargetRatio` 60%.
- **Fee model decision**: adopt entry/exit + 50/25/25 split vs. keep current penalty/bucket model — align to spec *outcomes*, document the choice.

### Track B — RWA surface (depends on Track 0; mainnet gated on Track E)
- `MintwareRWAVault4626.sol` — `vRWA` mint on deposit / burn on redeem, async redemption (`requestRedeem` → 30-day window → `confirmSettlement`), reserves 40% / yield 60%, oracle-band dynamic fee, reserve-ratio invariant (≥120%).
- `MintwareVRWA.sol` — ERC-20 bearer, `TransferMode { PERMISSIONLESS, WHITELISTED, FROZEN }`, `emergencyFreeze`, issuer mint/burn.
- `MintwareOracleHook.sol` — Chainlink + appraisal feed, price-band enforcement (±15/±45), `setAppraisal` / `getActiveBands` / `isPriceValid`.
- `SPVBeneficiaryRegistry.sol` — KYC records (NONE/BASIC/ACCREDITED/INSTITUTIONAL), verify/revoke/check. **KYC checked ONLY at redeem / dividend claim / SPV governance — never in the DeFi/deposit/trade path.**
- `SPVAssetProviderRegistry.sol`, `PVDistributionEscrow.sol` — issuer due-diligence + KYC-gated distribution.
- Testnet prototype proceeds now; mainnet waits on Track E.

### Track C — Attribution soulbound mirror (independent, parallel)
- `MintwareAttributionToken.sol` — soulbound ERC-721 (IERC5192), `attest()` / `recalculateFor(wallet)` / `verifyAttributionThreshold(...)`, transfer-blocked. Value is *attested* from the off-chain Worker via the existing EIP-712 oracle pattern (as in `AIAttribution`/`FeeVault`). Worker stays canonical. Map the 6 signals → an on-chain summary (and, if useful, an economic/network/technical rollup for surface weighting) without moving computation on-chain.

### Track D — Indexing + Frontend (follows contracts)
- Vault subgraph: `Vault` (surface, assetClass, totalAssets, currentEpoch, provider), `Depositor`, `Epoch`, `Attribution`, `Badge`, `RedemptionRequest`. Decide TheGraph vs Goldsky; migrate hot vault reads off Supabase-first where it helps.
- Frontend pages: **Vault Discovery** (DeFi+RWA, TVL/APY/profile tags), **Vault Detail** (hook-stack viz + epoch countdown), **Issuer Profile** (RWA), **Attribution Dashboard** (unify the scattered `/profile` tabs), **Redemption Queue** (RWA). Adopt `useWatchContractEvent` for live epoch/settlement.

### Track E — Legal / Business (parallel; **gates RWA mainnet** — not engineering)
- SPV formation, KYC vendor selection (Sumsub/Onfido), legal opinion, issuer partner (e.g. LiquidHectar). Owned by the business; engineering surfaces the integration points and testnet-prototypes against mocks.

### Track F — Docs / infra hygiene (rolling)
- Restructure `.claude/rules/`: reframe `vaults.md` to two-surface; forward-pointers in `architecture.md`, `smart-contracts.md`, `schema.md`, `deployments.md`; keep this plan authoritative for the target.
- **Priority-0 security:** rotate the oracle private key currently in `.claude/rules/deployments.md` (plaintext, committed) and purge it from git history. Move to Safe 3-of-5 for deploys.

---

## 6. Critical path & sequencing

```
Track 0 (Foundation) ──┬── Track A (DeFi hardening) ──┐
                       └── Track B (RWA contracts) ────┼── Track D (subgraph + frontend) ── testnet E2E
Track C (soulbound) ───────────(parallel, any time)────┘
Track E (legal) ───────────────(parallel)────────────────────── gates RWA mainnet
Track F (docs/hygiene) ────────(rolling)
```

Nothing in A or B starts before the Track 0 base/factory interface is stable. C, E, F run independently.

---

## 7. Open questions

Carried from the spec's own open list + our context:
1. OZ ERC-4626 vs custom minimal base? (lean OZ ERC4626 + our extensions, verify v4-core interplay)
2. FeeVault: distribute in underlying vs a common reward token? (currently underlying via Merkle)
3. OracleHook: single Chainlink feed vs multi-source median for RWA?
4. RWA redemption: FIFO vs pro-rata across pending?
5. IdleCapitalHook: whitelisted target pools vs any high-yield V4 pool?
6. Fee model: adopt spec's entry/exit + 50/25/25, or keep penalty + 70/15/10/5? (Track A decision)
7. Attribution rollup: do we expose economic/network/technical on-chain for surface weighting, or mirror the single scalar only?

---

## 8. Doc maintenance

- This file = target + sequencing (updated as decisions land).
- Each track updates its `.claude/rules/*.md` **when its code merges**, not before — avoid documenting unbuilt contracts.
- Memory index: [[spec_v1_direction]] links here.
