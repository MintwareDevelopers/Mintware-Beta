# Full-Platform Adversarial Audit — 2026-08-09

9 independent adversarial auditors (contracts / wiring / frontend) + adversarial verification of
high/critical findings. **35 findings: 2 critical · 9 high · 13 medium · 10 low · 1 info.**

Legend: **[NEW]** not previously known · **[KNOWN]** already documented · **[DEPRECATED]** on the
single-sided `MintwareDeFiVault4626` stack we are replacing with the pair vault · **[GO-FWD]** on
code we intend to keep/deploy.

## 🔴 CRITICAL

1. **[NEW][GO-FWD] Weighted distributor `claim()` has no post-sweep guard → double-spend.**
   `MintwareWeightedDistributor.claim()` (L249-285) vs `sweep()` (L294-311): a late claim after an
   epoch is swept drains other epochs/vaults. **Fix priority #1.**
2. **[KNOWN][DEPRECATED] Par-value 4626 redemption ignores live NAV → first-mover bank run.**
   `MintwareBaseVault4626` totalAssets()=principal. Already documented ("don't put real value on
   it"); the **fix is the pair vault** (PR #89). Retire the 4626 from the deployable set.

## 🟠 HIGH

3. **[NEW][GO-FWD] Circuit-breaker deadlock bricks swaps.** `MWHookCoordinator`: the oracle heals
   only in `afterSwap`, but a reverting `beforeSwap` (breaker) prevents `afterSwap` → permanent DoS
   after one large swap pushes the tick past the band. LP principal recoverable (remove not gated).
4. **[NEW][GO-FWD] Rebalance breaks shares==liquidity.** `MintwareDeFiPairVault._rebalance`
   recomputes `newLiquidity` at the new range but leaves `totalLiquidity` (share supply) unchanged →
   early redeemers over-withdraw, late redeemers locked out. **Fix priority #2.**
5. **[NEW][GO-FWD] `verifySwapTx` router allowlist skipped for `tx.to === null`** (contract-creation
   tx) → a fabricated "swap" earns rewards. `lib/rewards/swapHook.ts:151`.
6. **[NEW][GO-FWD] Fee enforcement is a naive calldata substring match** — spoofable, no real fee
   required. `swapHook.ts:161-170`.
7. **[NEW][GO-FWD] Reward math trusts client `amount_usd`** — on-chain verify never checks swapped
   value. `campaigns/swap-event/route.ts`.
8. **[NEW][GO-FWD] Stored XSS via agent service `endpoint` rendered into `href`.**
   `app/(web3)/agent/[address]/page.tsx:190` (also `javascript:` links in `CampaignHeader.tsx:159`).
9. **[NEW] Treasury auto-claim guard bypassed when `MINTWARE_TREASURY_ADDRESS` unset** → fees to the
   oracle EOA. `lib/web3/onchainPublisher.ts:267-278`.
10. **[NEW][DEPRECATED] 4626 lock tiers bypassable by transferring shares** (ERC20-transferable; no
    `_update` override). Pair vault uses a non-transferable `shares` mapping → not affected.
11. **[NEW][DEPRECATED] 4626 redemption marks executed + burns before confirming payout** → silent
    shortfall. Same stack as #2.

## 🟡 MEDIUM (13)

- [NEW][GO-FWD] `WeightedDistributor.registerVault()` permissionless → front-run funder-of-record steals swept remainders.
- [NEW] `MintwareDistributor.depositCampaign()` front-run locks wrong token / seizes creator role.
- [NEW][DEPRECATED] Rehypothecated idle capital not recalled on redemption → redeemers underpaid.
- [KNOWN] FeeVault.closeEpoch commits a raw Merkle root, no oracle attestation (dead sig machinery — oracle audit).
- [NEW][GO-FWD] External pre-init of the V4 pool bricks MatchedLiquidityVault activation (griefing DoS).
- [NEW][GO-FWD] `MWAmAuction.setEnabled(false)` freezes escrowed bidder capital (no escape path while disabled).
- [KNOWN] Rate limiting globally inactive in prod (fail-open + Upstash unset).
- [NEW][GO-FWD] `createHandler` signed-message auth doesn't bind issuedAt/action → replay within window, no action-binding.
- [KNOWN] `sweep.ts` LI.FI key fallback re-reads `NEXT_PUBLIC_LIFI_API_KEY`.
- [KNOWN] Root/merkle oracle key doubles as treasury custody key.
- [NEW][GO-FWD] Token-pool balance multiply-deductible via concurrent requests (read-then-write idempotency).
- [NEW][GO-FWD] `javascript:` URL XSS via campaign/token social links (no scheme validation).

## 🟢 LOW (10) / INFO (1)

sweep not `whenNotPaused` · unmanaged am-AMM fee not range-validated · imbalanced matched deploy
strands token · fee-on-transfer bidToken over-credits · contradictory withdraw-to-zero (dead branch) ·
configurePool can raise K/rent mid-life · non-constant-time bearer compare · signed auth in GET query
string · cross-campaign idempotency key · CSP shipped Report-Only + `unsafe-inline` · recordManagerFee
doesn't poke first (stale-manager mis-credit).

---

## Triage / fix order — STATUS (branch `fix/audit-findings`)

1. ✅ **CRIT #1** WeightedDistributor claim/sweep double-spend — `if (e.swept) revert AlreadySwept()` + test.
2. ✅ **HIGH #4** Pair-vault rebalance shares==liquidity — decoupled `positionLiquidity` from share
   supply; redeem removes `positionLiquidity*s/shares` (rounds down); 2 regression tests.
3. ✅ **HIGH #3** Circuit-breaker deadlock — permissionless `pokeOracle()` heal path (breaker still
   hard-halts; oracle catches up over blocks); self-heal + poke-noop tests.
4. ◐ **HIGH #5–7** swapHook reward integrity — #5 (tx.to null) FIXED; #6 (fee substring) + #7 (client
   amount_usd) scoped honestly: blast radius bounded by $10k cap + enforced daily wallet/pool caps +
   atomic finite-pool deduction + router allowlist; the real fix (server-recorded quotes) is a
   tracked follow-on, documented in-code — NOT faked with a shallow patch.
5. ✅ **HIGH #8** Frontend XSS — agent endpoint + CampaignHeader (prior) + CampaignCard DexScreener
   socials, all via `safeUrl()` (http(s)-only).
6. ✅ **HIGH #9** Treasury auto-claim guard — fail-closed when `MINTWARE_TREASURY_ADDRESS` unset.
7. MEDIUM go-forward: ✅ registerVault auth (owner allowlist + funder-hijack guard), ✅ setEnabled
   escrow escape (waive reserve while disabled), ✅ javascript: link XSS, ✅ pool pre-init (matched
   vault). ⏳ signed-message replay binding + ⏳ concurrency idempotency — deferred as scoped
   follow-ons (coordinated client+server / Postgres RPC changes needing dedicated testing).
8. ⏳ LOW batch + retire the deprecated 4626 stack (removes #2, #10, #11, rehyp) — frontend Phase-3B
   migration to the pair vault must land first, then delete.

Independence note: this is a rigorous FIRST layer. Before real value at scale, one independent set
of eyes (a cheap audit contest / solo auditor) remains worth it for correlated-blind-spot coverage.
