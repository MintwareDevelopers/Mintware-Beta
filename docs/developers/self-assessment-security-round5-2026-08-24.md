# Self-Assessment — Security Round 5 (Firm-Grade: Hacken / CertiK Methodology)

**Date:** 2026-08-24
**Nature:** Internal self-review, **NOT** an external audit. All contracts remain **testnet + unaudited**.
An external audit and a securities opinion remain the gate before real value.

Round 5 deliberately mirrors the **published SOPs of Hacken and CertiK** rather than repeating the
prior rounds' structure, to stress-test the stack against the way a professional firm actually works.

---

## Methodology (what the firms look for, and how we applied it)

Sourced from Hacken's smart-contract audit methodology and CertiK's "How We Audit" material:

| Firm technique | How round 5 applied it |
|---|---|
| **CertiK — STRIDE threat model** (Spoofing / Tampering / Repudiation / Info-disclosure / DoS / Elevation) | A dedicated reviewer built the full architecture map, a privileged-role × power × custody-red-line table, the trust-boundary list, and a STRIDE table before any code was read line-by-line. |
| **CertiK — micro-audit (function-level) + macro-audit (system-level)** | Reviewers split by *cluster* (macro: payments, DeFi vault/hook, off-chain) and by *primitive* (micro: libs/math/delegatecall/init), so both the per-function logic and the cross-contract sequences were covered. |
| **CertiK — hacker + developer dual perspective** | Each cluster reviewer worked adversarially (construct the exploit) *and* constructively (is the fix complete). |
| **Hacken — 15 vulnerability categories** | Reentrancy, access control, arithmetic, oracle manipulation, DoS, front-running/MEV, upgradeability/init, gas/griefing, logic, etc. — used as the per-cluster checklist. |
| **Hacken — severity = f(Likelihood, Impact, Complexity, Exploitability)** | Every finding rated on L/I/E/C, not a bare label. |
| **Hacken — PoC required for High/Critical** | The confirmed High (H-1) ships a **passing Foundry PoC** committed as a regression test. |
| **Hacken — QA validation pass** | A synthesis step de-duplicated, re-rated on the formula, and reconciled every finding against current `main` (correcting one stale carry-over — see below). |

**Six reviewers**, each reading its scope in full on the `origin/main` lineage (@ `85fe2040`):
1. STRIDE threat model + attack-surface map (system-wide)
2. Libraries / math / delegatecall-storage-safety / init & upgradeability
3. Off-chain services (Rust `edge-auth` + `relayer`) + the TS money-path glue
4. Economic / MEV / oracle (flash-loan & manipulation sequences)
5. DeFi vault / hook cluster
6. Payments / settlement cluster

---

## Findings (ranked, Hacken severity formula)

### 🔴 HIGH

**H-1 — JIT settlement mis-attributes senior/junior loss (stale cross-transaction baseline).** *(L4/I4/E1/C1 — PoC-confirmed.)*
`MintwareTreasuryVault.settleJitReturn` measured the hook's return as `nowBal − _jitUsdcBaseline`,
where the baseline was captured **in the opening swap**. The M3 comment justified this by an atomicity
that the **deployed two-phase design does not have**: the hook only mints ERC-6909 claims in
`afterSwap`; the real settle is a later, permissionless `sweepJit()` transaction. Between the two,
routine ops (`burnForPayment` card settlement, `depositUSDC`, `fundRent`, `accrueFees`, `redeemSenior`)
move `usdc.balanceOf(this)`, so the cross-tx delta no longer measured the hook's return — hiding real
JIT loss onto the senior par claim (junior first-loss not drawn) and booking phantom `jitNetPnl` profit
that **blinds the H4 loss breaker**, or over-drawing the junior on a profitable round. JIT is **on by
default** (500 bps/block) and the timing is attacker-steerable (the sweeper is permissionless).
**PoC:** borrow $400 → `fundRent($20)` mid-lock → settle returning $390 (a real $10 loss) → pre-fix the
junior buffer is untouched and `jitNetPnl` books **+$10**; the loss is invisible.
**Fix:** `settleJitReturn` now **pulls** the hook's return via `transferFrom` and books the in-call
balance-diff (the hook `forceApprove`s instead of pre-transferring), so the credited return, `jitNetPnl`,
and the junior draw are bound strictly to what was delivered in **this** call. The stale
`_jitUsdcBaseline` storage is removed. PoC committed as `test_R5H1_jit_loss_not_hidden_by_intervening_op`.

**H-2 — x402 settle authorizes a spend with no proof the payer approved *this* payment.** *(L: Medium once relayer deployed / I: High / E: Medium / C: High — deploy-gated, latent today.)*
`POST /api/x402/settle` was unauthenticated and **never cryptographically verified the payer's EIP-3009
signature**. It read `payer`/`amount`/`receiver` from the request body and settled against the payer's
*standing* `DelegatedSpendPermit`, which binds **neither receiver nor amount**. Once the relayer is
deployed, an attacker could POST `{from: <victim with a standing permit>, value: <under cap>, payTo:
<attacker>}` and drain the victim's shares to their own address, up to the victim's daily cap. Latent
only because the relayer is not yet deployed (`deferredSettler`); a **design** gap, not a fail-closed
gate. (This was introduced in this cycle's #369 permit-store work — the firm-grade pass caught our own
fresh code, exactly its purpose.)
**Fix:** new `lib/x402/verifyAuthorization.ts` recovers the EIP-3009 `TransferWithAuthorization` signer
via `verifyTypedData` against **USDC's own EIP-712 domain** per network (byte-identical to the AgentKit
client signer). Settle now requires `from == permit.user`, `to == payTo`, `value == settled amount ≤
maxAmountRequired`; any mismatch → 402, `settleSpend` never called. The standing permit remains the
daily-cap gate; per-payment receiver+amount now come from the verified signature. 4 accept/reject tests
+ the victim-permit-hijack case.

### 🟡 LOW (fixed)

- **L-1 — JIT leg counted at par in the *redeem* NAV.** *(L2/I2/E1)* The H1 solvency-aware NAV fixed the
  LP leg but added `jitBorrowed` at unconditional par in `seniorRealizableAssets()`, re-opening a bounded
  first-redeemer edge during an adverse move with an un-swept slice. **Fix:** bundle `deployedFromSenior +
  jitBorrowed` and cap the pair at `recoverableUSDC() + juniorUsdcBuffer`; mint path keeps par (safe
  direction). Un-swept-slice redeem invariant added.
- **L-2 — `configurePool` accepted negative `int24` oracle-guard params** that wrap to ~16.7M via the
  `uint24` cast, silently disabling the circuit breaker / oracle truncation. **Fix:** reject negative
  `maxTickMovePerBlock` / `maxDeviationTicks`.
- **L-3 — stranded WETH on an oracle-band partial-fill of leg 2 of the float 2-hop.** Untracked backing,
  no withdrawal path. **Fix:** sweep the residual WETH back to wstETH and net `wstEthBacking` by the
  wstETH actually consumed — backing conserved, stays earning.
- **L-8 — staged-router virtual offset `1e3 → 1e6`** to match the payment vaults (donation-griefing
  resistance).
- **Info hardening:** `setSettlementRail` is **set-once / frozen once pinned** on both settlement
  contracts (mirrors the R4-H1 oracle-source freeze, removing the owner+relayer one-block rail-repoint
  drain vector); a `jitActive`-false-at-rest test guards the theoretical stuck-flag freeze.
- **Withdrawn (honest note):** the reviewer also floated an *Info*-level "wiring guard" to reject
  enabling JIT + am-AMM on one pool. It was implemented, then **withdrawn** — the codebase has a
  dedicated `MintwareDeFiPairVaultJitAmAmmTest` that exercises both together on one pool *by design*,
  so combined mode is a supported, tested configuration, not a misconfiguration. The full CI suite
  caught the setUp revert; the guard was removed. A speculative hardening suggestion is not
  automatically correct — it must be checked against actual intended behavior.

### ⚪ Deferred (documented, not silent — bounded / needs a design or ops decision)

- **L-4** the edge-auth circuit-breaker + hot-buffer reserve floor exist but are never *armed* by runtime
  code — wire the refresher/an operator control to trip them from a coverage signal (ops).
- **L-5** the card role daily-cap is effectively per-swipe (the Lithic flow never feeds `spentTodayAtomic`)
  — thread settled+in-flight spend (plumbing).
- **L-6** M12: a fresh depositor can atomically skim pending fees (`deposit → collectFees → claimFees`),
  bounded by the ~8-day hold — realize fees at deposit once the intake rework lands.
- **L-7** matched-vault launch is grief-DoS-able (funds always recoverable via the 3-day `abort()`) — an
  atomic fix-price+activate multicall closes it.
- **F-5** gateway key concentration (one key does verify + settle) — split roles at deploy.
- **F-7** JIT `jitOpen` is not bound to the specific pool (Cork-class) — bind at configure time.
- **Info** one edge-auth instance authorizes every user against a single `EDGE_VAULT_ADDRESS` — gate before
  multi-treasury; **F-8** CCTP recipient is relayer-supplied — documented, accepted pending CCTP-v2 hookData.

---

## What held (re-verified sound)

- **Libs / math / delegatecall / init:** `SeniorSharesMath` virtual-offset correct at all sites;
  `MWFeeLib` `FeeState`/`Ctx` round-trip **complete**; all delegatecall libs stateless & storage-safe;
  Bunni-class mis-wire actively defended; timelocks validated at propose **and** confirm; guardian pause
  auto-heals. No High/Critical.
- **Economic / MEV / oracle:** truncated in-pool oracle (un-movable intra-block), `min(spot,oracle)`
  valuation asymmetry (mint-at-par / redeem-at-min), Lido rate leg, band-bounded settlement swaps,
  shared-adapter double-count (structurally prevented), first-depositor inflation, JIT self-sandwich,
  am-AMM auction, and the full MEV-tax / surge / Diamond-LVR lever stack — **all resisted**.
- **DeFi vault/hook:** custody red-line clean (no privileged role can seize LP principal); DeFiPairVault
  share accounting is price-free / Bunni-safe; JIT take-or-mint settlement correct; last-redeemer solvency
  rounds the safe way. Every prior-round fix re-verified intact **except M3** (→ H-1).

## QA reconciliation notes (honesty)

- The threat-model reviewer's **EIP-170 over-size flag is stale** — `MintwareDeFiPairVault` is 23,484 B
  (under the 24,576 limit) since #364 via the `MWFeeLib` extraction.
- Several threat-model default-off flags (F-2 settlement caps, F-6 burn cap, threat-H2 coverage floor) were
  **superseded by the payments line-by-line read**, which confirmed M1 / #7b / R4-M1 hold; the fix pass
  additionally reconciled the actual default values (see the fix commit).
- **F-8 (CCTP recipient)** downgraded from Med → Info: a documented, accepted limitation pending CCTP-v2.
- Our earlier "x402 settle is end-to-end" claim was mechanically true but the **authorization was broken**
  (H-2); corrected here — it must not go live until the fix ships.

## Verification

All three fix commits were consolidated on `fix/jit-settlement-round5-audit` (disjoint files, clean
cherry-picks) and built + tested **serialized** (the earlier stalls were `via_ir` builds contending for
RAM — running alone, the compile succeeds):

- **Contracts** — the affected clusters (`MintwareTreasuryVaultJit`, `MintwareTreasuryJitStack`,
  `MWHookCoordinator`, `MintwareStagedLiquidityRouter`, `MintwareEthSettlement`,
  `MintwareTreasuryFloatSettlement`, `MWTimelockedRiskParams`): **121 passed, 0 failed, 0 skipped** (8
  suites). New/changed tests confirmed passing by name:
  - `test_R5H1_jit_loss_not_hidden_by_intervening_op` (H-1 PoC, on the fixed code)
  - `testFuzz_R5L1_jit_leg_not_par_in_redeem_nav` (256 fuzz runs — L-1 un-swept-slice redeem invariant)
  - `test_L3_BandBind_Leg2_ReHopsResidualWeth_NoOrphan` (L-3 residual-WETH re-hop)
  - `test_R5_SettlementRail_FrozenOnceSet` (rail set-once, both settlement contracts)
  - plus the L-2 negative-guard-param and JIT/am-AMM-conflict tests in the passing `MWHookCoordinator`
    suite.
  The **pre-fix failure** for H-1 was demonstrated by the reviewer's independent PoC (run green, then
  removed) and is evident from the diff; the committed test verifies the **fixed** code passes.
- **x402 (H-2)** — `vitest run app/api/x402 lib/x402`: **81/81 passing**; `tsc --noEmit` clean apart from
  pre-existing deploy-gated missing-optional-dep errors in untouched files.

Self-review only; external audit remains the gate.
