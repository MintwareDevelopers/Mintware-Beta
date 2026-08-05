# RWA Deal Go-Live Runbook (per deal)

Takes ONE approved RWA deal from paperwork → a live, tradeable, oracle-banded vRWA/USDC market.
Every step is grounded in shipped code (PR #29 + the router PR #28). Do them in order; each has a
verification gate. Nothing here is automatic — a real asset going on-chain is a deliberate act.

> **Scope.** This lists a deal's **secondary market** (wrap → list → trade). It does NOT cover SPV
> formation, the legal opinion, or the KYC-vendor contract — those gate step 0 and are the business's.

---

## 0. Preconditions (all must be true before you start)

- [ ] **The MW meta-router is activated on this chain** (router PR #28): `MWRouter` + a `V4Quoter` are
      deployed, and env is set — `NEXT_PUBLIC_MW_ROUTER_ENABLED=true`, `MW_ROUTER_ADDRESS_BASE[_SEPOLIA]`,
      `MW_V4_QUOTER_BASE[_SEPOLIA]`, `MW_ROUTER_ADDRESSES=<MWRouter>`, chain RPC. The RWA trade path *is*
      the router — without it there is no trade step.
- [ ] **Legal / SPV green light**: SPV formed, legal opinion in hand, KYC vendor live. RWA mainnet is
      legal-gated by design. For Reg D deals KYC is enforced at the trade/transfer boundary (whitelisted
      vRWA) and re-checked at redemption (step 6); Reg A+ deals trade openly.
- [ ] **The deal is `approved`** in the app (`vault_deals.review_status = 'approved'`, admin review done).
- [ ] You have the **issuer's market-making USDC** (the seed) and a funded **deployer key** for gas.
- [ ] Decide the **appraisal (NAV)** and the **bands** (default ±15% core / ±45% spec). The initial pool
      price should equal the appraisal.

---

## 1. Deploy the connected on-chain stack

`DeployRwaFlow.s.sol` deploys vRWA + the RWA vault + a CREATE2-mined `MintwareOracleHook` wired to *that*
vault, then **lists + seeds** the oracle-banded vRWA/USDC pool in one shot (the flow proven in
`MintwareRWAFlow.t.sol`).

```bash
DEPLOYER_PRIVATE_KEY=0x…            # funded with gas; plays owner/issuer/keeper + supplies USDC seed
POOL_MANAGER=0x…                    # Uniswap V4 PoolManager on the target chain
USDC=0x…                            # the deal underlying (real testnet/mainnet USDC)
TREASURY=0x…                        # optional (default: deployer)
USDC_SEED=50000000000               # optional, default 50000e6 — issuer market-making USDC
VRWA_SEED=50000000000               # optional, default 50000e6 — vRWA inventory minted to the vault
forge script contracts-v4/script/DeployRwaFlow.s.sol --rpc-url <chain> --broadcast --verify
```

**Record the logged addresses** — you need them in step 2:
`vault`, `vRWA`, `oracleHook`, and the pool key (`currency0`, `currency1`, `fee` = dynamic-fee flag,
`tickSpacing`).

**Verify (on-chain):**
- [ ] `vault.poolInitialized() == true`, `vault.totalLiquidity() > 0`.
- [ ] `getSlot0(poolId)` sqrtPrice == the appraisal price.
- [ ] `hook.vault() == vault`, `hook.bands(poolId).configured == true`, appraisal set.
- [ ] `vrwa.minter() == vault`. **Transfer mode by tier:** for a **Reg D** deal assert
      `vrwa.transferMode() == WHITELISTED` AND the pool (PoolManager), router, vault, and issuer are
      enrolled as permitted holders before any trade — shipping `PERMISSIONLESS` for a Reg D asset is a
      compliance failure. `PERMISSIONLESS` is correct **only** for Reg A+ deals.

---

## 2. Record the deployment + list on the meta-router

Feed the step-1 addresses to the admin route. This (a) records the deployment on the vault row, (b)
**upserts a `router_pools` row** so the router will trade the pair, (c) flips vault status to `live`.

```bash
curl -X POST https://<host>/api/admin/vaults/rwa/<VAULT_ID>/list \
  -H 'Content-Type: application/json' \
  -H '<admin auth header — same as other /api/admin/vaults routes>' \
  -d '{
    "chain_id": 8453,
    "vault_address":     "0x…vault",
    "vrwa_address":      "0x…vRWA",
    "hook_address":      "0x…oracleHook",
    "router_address":    "0x…MWRouter",
    "pool_currency0":    "0x…currency0",
    "pool_currency1":    "0x…currency1",
    "pool_fee":          8388608,          // LPFeeLibrary.DYNAMIC_FEE_FLAG (0x800000)
    "pool_tick_spacing": 60
  }'
```

**Verify (DB + registry):**
- [ ] `social_vaults` row: `status='live'`, `vault_address`/`vrwa_address`/`hook_address` + pool key set,
      `listed_at` stamped.
- [ ] A `router_pools` row exists for `(chain_id, currency0, currency1)` with `active=true` and the
      correct `router`/`hooks`/`fee`/`tick_spacing`.

---

## 3. Verify the TRADE path (the router hand-off)

The pair is now listed; the meta-router should compare it against LI.FI and, when the pool wins, route
internally through `MWRouter`.

- [ ] `POST /api/swap/best-route` with the vRWA/USDC pair returns `winner: 'mw-internal'` when the pool
      price beats LI.FI (LI.FI has no vRWA route, so internal should win whenever the quote is valid).
- [ ] Do a small **in-band test swap** (USDC → vRWA) through the app's swap flow. It should succeed and
      the oracle hook should charge the band fee (core, 0.75%).
- [ ] Confirm an **out-of-band** attempt reverts (`PriceOutOfBands`) — e.g. quote a trade that would exit
      the ±45% spec band. (This is the safety property `MintwareRWAFlow.t.sol::test_stage4` proves.)

---

## 4. Verify the WRAP path + rewards

- [ ] On the deal page (`/vault/<id>`), the **Deposit button is now active** (it un-gates on
      `vault_address`). A deposit approves USDC + calls the vault's ERC-4626 `deposit` → mints vRWA 1:1.
- [ ] After a test deposit: the wallet holds vRWA; `vault.totalPrincipal()` increased; USDC sits as
      reserve (no yield adapter set yet).
- [ ] **Rewards credit on internal swaps**: an `MWRouter` swap tx is allowlisted by `verifySwapTx`
      (`MW_ROUTER_ADDRESSES`), so a campaign-tagged swap credits points. Confirm one credits (no
      `router_mismatch` / `fee_not_paid` skip).

---

## 5. Ongoing operations

- **Keeper / NAV**: the appraisal must be refreshed as the RWA's NAV moves (`hook.setAppraisal`, keeper
      only). Stale appraisal (> the hook's freshness assumptions) or a wrong NAV mis-sets the bands. Wire
      this to the `rwa-nav-appraisal` keeper cron before real volume.
- **KYC for redemptions** (the legal boundary): `SPVBeneficiaryRegistry.setKycProvider(...)`, and the
      provider `verifyBeneficiary(holder, level, …)` for each redeemer. `confirmSettlement` reverts
      without it. KYC is checked ONLY here — never on deposit or trade.
- **Reserve / yield**: optionally `setYieldAdapter` + route the 60% non-reserve to yield; `harvestYield`
      splits 70/30. Keep enough USDC reserve to cover queued redemptions.
- **Monitoring**: pool price vs appraisal (deviation), reserve ratio, redemption queue, router
      internal-vs-LI.FI win rate.

---

## 6. Rollback / kill switches (fastest → most surgical)

- **De-list from the router (instant, no redeploy):** set the `router_pools` row `active=false`. The
      meta-router immediately stops routing the pair internally and falls back to LI.FI (which for vRWA
      means "no route" — trading pauses). This is the primary lever.
- **Freeze vRWA transfers (emergency):** guardian calls `vrwa.emergencyFreeze()` → `FROZEN`. Halts all
      vRWA transfers incl. pool swaps. Recovery is the 48h-timelocked `proposeTransferMode`/`confirm`.
- **Suppress trading via bands:** the keeper can tighten/withhold the appraisal so swaps fall out of band
      and revert. Coarser than de-listing; use only deliberately.
- **Disable the whole router:** unset `NEXT_PUBLIC_MW_ROUTER_ENABLED` — kills internal routing chain-wide
      (affects DeFi pools too; last resort).

---

## 7. Go / no-go summary

Ship only when: step-0 preconditions ✅ · on-chain stack verified (step 1) · listed on router (step 2) ·
in-band swap + out-of-band revert confirmed (step 3) · deposit mints vRWA + rewards credit (step 4) ·
keeper + KYC operational (step 5) · rollback rehearsed (step 6).

> Reminder: until a real deal completes this runbook, the RWA vaults visible in the app are **fictional
> demo seed** (`scripts/seed-demo-rwa-vaults.mjs`). Don't confuse the showcase with a live asset.
