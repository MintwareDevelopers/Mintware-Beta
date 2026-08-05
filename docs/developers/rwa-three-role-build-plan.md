# RWA Three-Role Model — Build Plan of Record

**Status:** Build plan, adopted 2026-08-05. Implements the compliance structure in
[RWA Compliance — Three-Role Model](rwa-compliance-three-role-model.md). **Not yet built.**
**Applies to:** Reg D-issued assets (Reg A+ tier runs fully open and needs none of this).

## Locked decisions

1. **Contract strategy:** new USDC-only `MintwareULV4626` for the LP side; repurpose the existing
   `MintwareRWAVault4626` as the issuer wrapping + holder-redemption vault. (Three roles → separate
   contracts.)
2. **Trader gate enforcement:** at the **token level** — `MintwareVRWA._update`, driven by
   `SPVBeneficiaryRegistry` — not (only) in `beforeSwap`. See §2.
3. **KYC stack:** **Privy** (auth / wallet / UI gating) + **Persona** (basic KYC/AML verification;
   Sumsub is the noted fallback if non-US trader flow is heavy). Accreditation vendor
   (Parallel Markets / InvestReady) **deferred** until the 3(c)(7) question (below) is answered.
4. **Sequencing:** WS1 (trader gate) + WS3 (repurpose) + KYC integration ship **first** — trading
   is compliant on issuer-seeded depth. WS2 (public LP vault) is built with the LP gate as a
   **parameter** and its openness is set by counsel's 3(c)(7) ruling.

**Open blocker (counsel):** whether the USDC-only LP side needs a 3(c)(7) qualified-purchaser gate
under the Investment Company Act (Ondo OUSG precedent). Does not block WS1/WS3; parameterizes WS2.

---

## 1. Architecture — three roles → contracts

```
  LP (public, USDC)         POOL (V4, both sides)          TRADER (KYC'd)
  MintwareULV4626   ──USDC──▶  vRWA/USDC pool  ──vRWA──▶  verified wallet
  (USDC in/out,               MintwareOracleHook          (Persona-verified,
   never holds vRWA)          (bands + band fee)           in SPVBeneficiaryRegistry)
        │                          ▲
        │ USDC-side liquidity      │ vRWA inventory
        ▼                          │
   (vault holds the LP        MintwareRWAVault4626
    position; LPs hold        (issuer wrapping +
    USDC-denominated shares)   holder redemption)
```

**Enforcement is the vRWA transfer restriction.** Flip `MintwareVRWA` to `WHITELISTED`; a permitted
holder is `whitelisted[addr] || registry.checkBeneficiary(addr).verified`. Infra (PoolManager,
MWRouter, both vaults, issuer) is enrolled via `setWhitelist`; human traders clear via the registry.
Any vRWA transfer to a non-permitted address reverts — including the pool's swap payout to a trader,
regardless of routing.

---

## 2. Why token-level, not `beforeSwap`

In Uniswap V4, `beforeSwap(address sender, …)` sees `sender` = the caller of `PoolManager.swap`
(the router), **not** the end recipient of the vRWA. So a `beforeSwap` KYC check can't reliably gate
the actual trader on a routed swap — only the router, or router-supplied (spoofable) `hookData`.

`MintwareVRWA._update` runs on the ERC-20 transfer that actually delivers vRWA to the trader, so it
gates whoever truly receives the security. This is the Ondo OUSG model (KYC-registry allowlist at the
token). A `beforeSwap` check is **optional UX** (clean early revert before settlement) — not the gate.

---

## 3. Workstreams

### WS1 — Trader gate + pool as permitted holder  *(build now)*

**`MintwareVRWA.sol`**
- Add an `SPVBeneficiaryRegistry` reference (constructor or owner-settable).
- Change `_update`: in `WHITELISTED` mode, permit iff `whitelisted[from]||registry-verified(from)`
  AND same for `to`. Keep mint/burn (`from==0`/`to==0`) always-allowed.
- Keep the `whitelisted` mapping for **infra** addresses (not humans).

**Enrollment (deploy script / admin):** `setWhitelist(true)` for PoolManager, MWRouter, `MintwareULV4626`,
`MintwareRWAVault4626`, and the issuer address. Set `registry.setKycProvider(oracleSigner)`.

**Flip the mode:** `proposeTransferMode(WHITELISTED)` → wait 48h → `confirmTransferMode()`.

**Optional (WS1.5):** add a `beforeSwap` early-revert in `MintwareOracleHook` reading the registry via
router-forwarded recipient in `hookData` (UX only; not the enforcement). Permission bits unchanged
(`beforeSwap` already enabled, `HOOK_FLAGS = 0xA80`) → **no CREATE2 re-mine**.

**Tests (Forge):** transfer/swap-payout to non-verified reverts; verified trader succeeds; infra
addresses pass; existing redemption path (`confirmSettlement`) still works; expired/revoked KYC blocks.

### WS3 — RWA vault as issuer-inventory + holder-redemption vault  *(✅ BUILT 2026-08-05)*

**Model clarified:** `vRWA` is the tokenized security ITSELF (issuer-supplied), **not** a synthetic
wrapper minted to depositors. What shipped:

- **Public 4626 deposit CLOSED** — `_afterEnter` reverts `DepositsDisabled`, so `deposit`/`mint`/
  `depositWithLock` all revert. A depositor can no longer mint vRWA. (Public USDC LPing → the future ULV.)
- **`fundReserve(usdc)`** — the issuer capitalizes the USDC redemption reserve (non-reserve portion
  routes to the yield adapter, as the old deposit path did). **Reserve-funding decision resolved:
  issuer-funded.**
- **vRWA-keyed redemption (decision: on-chain, issuer-settled)** — `requestRedeem(vrwaAmount)` burns the
  holder's vRWA into a `rwaRedemptions` request (NOT keyed on 4626 shares), so a **secondary-market
  holder with zero vault shares can redeem**. `confirmSettlement(holder)` — issuer-only, KYC-gated,
  after the 30-day window — pays USDC at par (1:1) from the reserve, recalling from yield on shortfall.
- `listAndSeedPool` (issuer inventory + seed) unchanged.

**Tests (green, Forge 201/201):** `test_deposit_disabled`, `test_secondary_market_holder_redeems_at_par`
(the headline: no shares → redeems), pending-guard, reserve/yield routing, KYC + issuer gates; flow test
reworked to list → trade (no deposit-wrap).

**UI follow-up (not in the contract PR):** the `RwaVaultDetail` "Invest" panel still offers a public
deposit that now reverts on-chain — it should be replaced with a buy-on-secondary-market primary action.
Gated on an undeployed `vault_address`, so not live-facing yet. Overlaps WS1's RWA-UI edits.

### WS2 — `MintwareULV4626` (public USDC LP vault)  *(gated on 3(c)(7); build in parallel, parameterized)*

New contract extending `MintwareBaseVault4626`, `asset() == USDC`:
- `_afterEnter`: **no vRWA mint**; deploy USDC as pool liquidity (single-sided range on the USDC side).
- Make `_deployLiquidity` / `_removeLiquidity` / `_rebalanceLiquidity` **real** (unlike the RWA vault's
  no-ops) — the ULV actively manages the USDC-side position.
- **The mechanical wrinkle:** a V4 LP position is a claim on *both* tokens, so as traders sell vRWA into
  the pool the ULV position accrues vRWA. The *vault* holds it (it's a whitelisted permitted holder);
  **LPs must be paid back in USDC only.** Fund USDC-only withdrawals via a reserve buffer + keeper
  rebalance (swap vault-held vRWA → USDC through the pool). This is the existing reserve model made active.
- **LP gate parameter:** `requireQualifiedPurchaser` (default `false`). When set, `_afterEnter`/deposit
  gates the LP on `registry` level ≥ `ACCREDITED`. Counsel's 3(c)(7) ruling flips this flag — not a rewrite.
- Async USDC redemption via the base machinery.

**Tests:** LP deposits USDC → shares, holds **no** vRWA; withdrawal returns USDC only even when the
position holds vRWA; QP flag on → sub-accredited deposit reverts; fees accrue to LPs.

---

## 4. KYC / Privy integration

**Layer 1 — Privy (keep, already merged on `main`):** login, embedded wallet, session, and **UI gating**.
Store the KYC result on the Privy user as custom metadata (`kyc_status`, `kyc_level`) so the "Trade" and
"Provide liquidity" buttons gate *before* an on-chain attempt. Privy is **not** the verification — it can't
check IDs, screen sanctions, or attest accreditation.

**Layer 2 — Persona (basic KYC/AML, the trader gate):** embedded Persona inquiry launched from the app
after Privy login. Covers `KYCLevel.BASIC` (identity, sanctions/PEP, jurisdiction). Sumsub is the drop-in
fallback if non-US flow dominates.

**Layer 3 — Oracle → registry (on-chain truth):** Persona webhook → `POST /api/kyc/webhook` → verify
signature → resolve wallet → oracle signer (the `kycProvider`) calls
`SPVBeneficiaryRegistry.verifyBeneficiary(wallet, level, providerHash, countryCode, expiresAt, isRestricted)`.
`providerHash` = hash of the Persona inquiry ref (no PII on-chain). Push status back to Privy metadata.

**Flow:** Privy login → (if unverified) Persona inquiry → webhook → oracle writes registry → Privy metadata
updated → UI unlocks → on-chain vRWA transfer gate is the hard enforcement.

**New env:** `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, `RWA_KYC_ORACLE_PRIVATE_KEY` (the `kycProvider`
signer — secret manager only, never committed), `NEXT_PUBLIC_SPV_BENEFICIARY_REGISTRY`,
`NEXT_PUBLIC_VRWA_ADDRESS`. Route uses `createHandler` (`ctx.supabase`/`ctx.json`/`ctx.log`).

**Deferred (only if 3(c)(7) forces an LP gate):** Parallel Markets or InvestReady for the
accreditation/QP tier → writes `ACCREDITED`/`INSTITUTIONAL` to the same registry; ULV `requireQualifiedPurchaser`
reads it.

---

## 5. Sequencing

| Phase | Ships | Gated on |
|---|---|---|
| **1 (now)** | WS3 rewire · WS1 trader gate · Persona/Privy/oracle KYC · enroll infra · flip vRWA to WHITELISTED | — (compliant trading on issuer-seeded depth) |
| **2** | WS2 public USDC ULV, `requireQualifiedPurchaser` parameterized | counsel's 3(c)(7) answer (openness) + reserve-funding decision (§WS3) |
| **2b (conditional)** | Accreditation vendor + QP gate on | only if Phase-2 ruling requires QP |

---

## 6. Risks / open items

- **3(c)(7) ruling** — sets whether WS2 LP side is open or QP-gated (parameterized, not blocking).
- **RWA-vault reserve funding** — must be decided before WS3 code (§WS3).
- **ULV keeper** — new off-chain infra to rebalance vault-held vRWA → USDC for withdrawals.
- **vRWA backing** — on-chain vRWA is only as sound as the off-chain SPV legal wrapper actually holding
  the asset; the token gate is compliance, not custody.
- **Whitelist completeness** — every transient vRWA holder (PoolManager especially) must be enrolled
  before flipping to WHITELISTED, or pool interactions revert. Cover in the deploy script + a pre-flip check.
