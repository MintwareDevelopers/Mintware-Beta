# LP Gateway V1 — Real-Funds Audit Pack (for the Fable 5.1 re-audit)

> **Purpose.** A complete, self-contained map so the re-audit hammers the *real* attack surface instead of a
> blank page. Goal: reach a state where **a bounded amount of our own funds** can be used safely.
>
> **Honest frame (read first).** No AI audit (Fable or Opus) replaces a professional external audit before
> real value — that remains the gate for **user** funds. For **our own funds we choose to risk**, the bar is:
> re-audit clean → fix everything → **hard cap total exposure** → start tiny → monitor → scale. Nothing below
> should be read as "it's safe"; it's "here's exactly what to try to break, and what must be true first."

---

## 1. Scope

| Layer | Files | LOC |
|---|---|---|
| **Contracts** (`contracts-v4/src/gateway/`) | `MintwareLpGatewayPositionManager.sol` (core, 524), `MintwareLpGatewayFactory.sol` (105), `MintwareLpGatewayStaging.sol` (80) | ~709 |
| **Off-chain money paths** (`lib/gateway/`, `app/api/gateway/`) | `harvest*.ts`, `registry.ts`, `positionReader.ts`, `poolState.ts`, `routerSwap.ts`, `v4SwapExec.ts`, routes `deposit`/`withdraw`/`position`/`curate`/`meta`/`request`, crons `gateway-{deploy,harvest,discover,snapshot}` | ~3,080 |
| **Integrations (external, in the threat model)** | Uniswap **v4 PositionManager** + PoolManager + **Permit2**; **Morpho-shaped ERC-4626** staging adapter; **USDG** (Paxos, 6dp) | — |

The money-critical subset to weight heaviest: `MintwareLpGatewayPositionManager.sol` (share math, NAV, deploy,
harvest, withdraw), `lib/gateway/harvestMath.ts` + `harvest.ts` (fee split), `lib/gateway/registry.ts`
(deposit-routing trust root), and the **off-chain buffer ledger** (`card_spend_buffers`, credited by harvest).

## 2. System overview & money flow

```
deposit(USDG) ─▶ stage in Morpho 4626 adapter (earns)          [principal, staged]
             └▶ owner deploy(capped fraction) ─▶ LP into a curated 3rd-party v4 pool   [LP position]
                                              └▶ harvest(): collect fees (0-Δliquidity) ─▶ perf-fee skim
                                                       └▶ 90% credited pro-rata to depositors' spend buffers  [fees/buffer]
withdraw(shares) ─▶ pro-rata idle + LP realization (conservative mark) ─▶ USDG out     [principal + gains]
```

**Actors:** depositor (untrusted); **owner/deployer** (operator — calls `deploy`/`harvest`/`setPaused`/`compoundQuote`);
**oracle seat** (`getOracleSigner('root')`, signs harvest/deploy crons); **curator** (approves which pools get an
instance). **Assets at risk:** depositor principal, staged capital, the LP position, and accrued fees/buffers.

## 3. Trust model — ON-CHAIN-ENFORCED vs OFF-CHAIN-TRUSTED (the crux for real funds)

| Property | Enforcement |
|---|---|
| Share issuance / redemption math, virtual-offset inflation defense | **On-chain** (`SeniorSharesMath`) |
| Same-block guard, deviation breaker, conservative NAV mark | **On-chain** |
| Fees swept to `harvestRecipient` before any principal change (H-02) | **On-chain** |
| `harvestRecipient` immutable, `renounceOwnership` disabled, deployer-gated `setController` | **On-chain** |
| Deposit **routing** target (which PM a deposit hits) | **Off-chain** `gateway_instances` + on-chain `verifyInstanceOnChain` (H-01) at registration |
| **⚠ Per-depositor fee/buffer accounting (who is owed what spendable USDG)** | **OFF-CHAIN** (`card_spend_buffers`, credited by the harvest cron) — **M-05** |
| Harvest execution + perf-fee skim + pro-rata credit | **Off-chain cron** signed by the oracle seat |

**The single most important real-funds fact:** harvested fees leave the position to the **owner/oracle seat**,
and each depositor's spendable buffer is an **off-chain IOU** credited by our cron (M-05, only *partially*
remediated — H-02 guarantees fees *reach* the recipient, not that the off-chain ledger is trustless). For
**our own funds**, we are both operator and depositor, so this trust collapses to "trust ourselves" — acceptable.
It is **not** acceptable for third-party funds without the on-chain segregated-settlement re-architecture.

## 4. Threat model — actors & capabilities to test

1. **Malicious depositor** — inflation/donation, first-depositor, rounding, same-block round-trip, withdraw > entitlement, cost-basis corruption.
2. **Pool/counterparty manipulator (MEV)** — move the hookless (no-TWAP) pool price to mis-mark NAV on deposit/withdraw/deploy; single-block (C-01/H-03 defended) **and cross-block on a thin pool (H-03 residual)**.
3. **Compromised owner key** — can it steal principal, redirect fees, brick funds, or disable the breaker? (Design intent: no.)
4. **Compromised oracle seat** — harvest/deploy signer; can it drain, mis-credit buffers, or grief?
5. **Malicious curator** — register a hostile PM/pool as a deposit target (H-01 defense) or a hostile adapter (I-01).
6. **External failure** — v4 PositionManager/Permit2 edge cases; Morpho adapter fee-on-exit / insolvency; **USDG (Paxos) freeze/pause (M-07)**.
7. **Off-chain attacker** — unauth routes, replay, buffer-reveal leakage, cron double-credit, curator-auth bypass.

## 5. Attack-surface checklist — what Fable 5.1 should try to break

**A. Share accounting (`PositionManager` deposit/withdraw + `SeniorSharesMath`)**
- Donation/inflation vs the virtual offset; first-depositor dust; rounding direction (who eats the wei?); can `withdraw` return more than the pro-rata claim under any NAV/price? same-block guard bypass (multi-address, flashloan, reentrancy)?

**B. NAV / pricing (hookless, no on-chain TWAP)**
- Verify the **clamped-follower reference** can't be walked to an attacker-chosen value across N blocks cheaper than the value extracted; verify **directional conservative mark** (withdraw `min(spot,ref)`, deposit `max`) truly caps both inflation-on-exit and cheap-entry; the **cross-block thin-pool residual (H-03)** — quantify the pool depth at which it becomes profitable and confirm curation is the only backstop; deploy-time price bounding (M-03).

**C. Harvest & the fee split (`harvest.ts`, `harvestMath.ts`)**
- `_sweepFees` ordering (H-02) on every principal-changing path; perf-fee skim rounding (rounds down — confirm buffer never over-credited); pro-rata credit correctness under concurrent deposits/withdraws between harvests; **cron idempotency** (double-harvest / double-credit, L-02); **paired-leg conversion** — non-USDG fees left unconverted (M-05); the off-chain credit ledger integrity.

**D. Deploy (`deploy(quote,paired,minLiquidity,deadline)`)**
- Capped fraction (most capital stays idle); `minLiquidity` floor (M-03); Permit2 allowance **revoked** after mint (L-04); can a manipulated price at deploy mint a bad position?

**E. Access control**
- Owner vs deployer vs oracle separation; `setController` deployer-only (M1); `renounceOwnership` disabled (M-01/L-06); `harvestRecipient` immutable; **factory adapter-reuse guard (M2)** + the deferred `adapter.asset()==quote` check (I-01); `Ownable2Step` two-phase.

**F. Withdraw**
- Pro-rata idle sourcing (M-06, no bank-run first-mover); never-bricks (M-01, conservative mark not a revert); returns **principal only**, fees stay in buffer (H-02); `min=0` on the decrease (L-01, deliberate — confirm the conservative mark actually protects value).

**G. Off-chain money paths**
- `deposit`/`withdraw` routes: signed-message auth + `gateway_deposit_events` UNIQUE(tx_hash) idempotency (M-04) — try replay/basis-corruption; `position` buffer disclosure owner-gated (L-03); `curate` bearer fail-closed (C-01); registry `verifyInstanceOnChain` (H-01) — try to register a substituted PM/pool; **oracle-seat key** handling; cron auth + idempotency.

**H. Integrations**
- v4 afterSwap/settlement timing; Permit2 nonce/allowance; Morpho adapter `previewRedeem`/`redeem` fee-aware NAV (can a fee-charging 4626 overstate NAV?); USDG freeze (M-07, accepted).

## 6. Prior findings & residual-risk register

**Closed (verify they *stay* closed under the new review):** C-01, H-01, H-02, H-03 (single-block), M-01,
M-02 (`pokePrice` removed), M-03, M-04, M-06, L-02/03/04/06/09, I-02.

**Open / residual — the real-funds blockers to adjudicate:**

| ID | Residual | Real-funds implication |
|---|---|---|
| **M-05** | Per-depositor fee/buffer accounting is an **off-chain IOU**; harvested fees leave to the owner seat; paired-leg fees can go unconverted. Only *partially* remediated (fees provably *reach* the recipient). | **The** architectural gap. Fine for **our own** funds (we are the operator). A blocker for third-party funds — needs on-chain segregated settlement. |
| **H-03 (residual)** | Patient **cross-block** manipulation on a **thin** pool can still mis-mark NAV; defenses (follower + conservative mark + capped deploy) narrow but don't eliminate it. | Mitigation is **deep-pool curation + capped deploy**. Auditor should quantify the depth threshold and confirm the cap holds. |
| **M-07** | USDG (Paxos) freeze/pause bricks deposits & withdrawals; no owner rescue hatch (by design, to keep the trust model). | Accepted inherent risk; document for anyone using it. |
| **I-01** | Factory `adapter.asset()==quote` check deferred (no common getter). | Isolation leans on the production adapter's one-time `onlyVault` + curation. |
| **L-01/05/07/08** | Low residuals (deliberate `min=0`, fee-free-USDG assumptions, follower bounds). | Documented; re-confirm none compose into a Medium under real value. |

## 7. Direct asks for the auditor (answer each)

1. Can **anyone** (depositor, manipulator, owner, oracle, curator) end a sequence of legal calls holding **more
   value than they put in / are owed**? Give the cheapest PoC or prove impossibility.
2. At what **pool depth** does the H-03 cross-block residual become profitable, and does capped-deploy + curation
   actually bound the loss to a tolerable %?
3. Is the **off-chain buffer ledger** (M-05) exploitable by anyone *other than* the operator? (For own-funds we
   accept operator trust — confirm no *third* party can corrupt or drain it.)
4. Can a **compromised owner or oracle key** steal principal, brick funds, or silently mis-credit — beyond the
   griefing we accept? Enumerate the blast radius of each key.
5. Any **share-math / rounding** path that drifts value across many small ops (dust harvesting)?
6. Any **reentrancy / callback** surface via v4 PositionManager, Permit2, or the 4626 adapter?

## 8. Real-funds go-live checklist (must all be true before ANY own funds)

- [ ] Fable re-audit run against this pack; **every Confirmed finding fixed + re-tested**; Opus reconciles findings (two independent models).
- [ ] **M-05 decision recorded** — for own-funds-only: explicitly accept operator-trust of the buffer ledger, *and* confirm no third party can corrupt it. (On-chain segregated settlement stays the gate for user funds.)
- [ ] **Hard exposure cap** — a bounded max total deposit (ops or on-chain), starting tiny (e.g. low-hundreds of USDG), scale only on clean operation.
- [ ] **Deep-pool curation only** — no thin/meme pools for real funds (H-03 backstop); deploy ratio capped.
- [ ] **Oracle-seat key** — hardware-backed / Privy enclave, minimally funded, rotation plan; blast radius reviewed (#4).
- [ ] **Breaker tested live** — `setPaused` blocks deposits, never withdraw; withdraw proven non-bricking.
- [ ] **Deploy params reviewed** — `maxDeviationBps=500`, `LP_GATEWAY_PERF_FEE_BPS`, `minLiquidity` sane for the real pool.
- [ ] **Contracts verified on explorer**; the exact deployed bytecode == audited source.
- [ ] **Monitoring/alerts** on harvest, out-of-range, deviation-breaker trips, and buffer credits.
- [ ] Forge fork tests green against a **mainnet-fork** of the real pool (not just the mock rig).

## 9. How to run it on Fable 5.1

Feed §3–§7 as the working set. Ask Fable to go **area by area** (§5 A–H), and for each finding return:
**severity** (Critical/High/Med/Low), **CONFIRMED vs PLAUSIBLE**, a **concrete failure scenario / PoC**
(inputs → wrong output), and a **minimal fix**. Then hand the Confirmed set back here — I'll implement + verify
the fixes and re-run Forge/Vitest, and reconcile against an independent Opus pass if you want the second lens.

---

*Sources in-repo: [`lp-gateway-v1-security-review.md`](lp-gateway-v1-security-review.md) (prior firm-grade review),
[`lp-gateway.md`](../../.claude/rules/lp-gateway.md), the memories `lp_gateway_v1_audit` / `lp_gateway_testnet_live`.*
