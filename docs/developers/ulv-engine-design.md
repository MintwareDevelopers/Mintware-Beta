# ULV Engine — Design & Build Plan (research-grounded)

**What this is:** the SOTA-grounded design for the ULV *engine* (idle-capital yield + JIT liquidity +
MEV recapture) and the phased build order. Synthesized from four 2025–2026 SOTA research sweeps
(Aave v3 integration · V4 JIT/rehypothecation hooks · MEV/LVR recapture · V4/vault security).
Companion to `ulv-status-and-roadmap.md`. **Read this before writing engine code.**

_Drafted 2026-08-11. Status: proposal — review before build._

---

## 0. The one insight that reshapes the build

The pitch says "pull liquidity from Aave into the pool on **every** swap." **No one ships that** — a
full Aave withdraw→mint→burn→resupply round-trip is ~650k–1M gas, so it only pays on large swaps.
The production SOTA (**Bunni v2**, Flaunch) is **buffered rehypothecation**: keep a *hot reserve* of
each token in the pool, idle the rest in Aave, and rebalance the buffer **in `afterSwap` only when it
drifts out of band**. Ordinary swaps never touch Aave.

So the engine is **two levers**, not one:
- **Lever A — buffered rehypothecation (the product).** Idle yield on the bulk; zero Aave gas on
  ordinary swaps. This is where the APY actually comes from and what we build first.
- **Lever B — size-gated true JIT (a fast path).** For swaps above a threshold, do the real
  Aave-round-trip and mint concentrated liquidity. Optional; layered on after A works.

## 1. Threat model — we are building the Bunni v2 architecture

A V4 hook that rehypothecates idle liquidity into Aave is **exactly** the design drained for **$8.4M
(Bunni v2, Sept 2025)**; Cork ($12M, May 2025) is the adjacent hook-callback-access class. Treat the
**Bunni bug as the primary test target**: *rounding direction in idle-balance `mulDiv` + an
attacker-supplied rehypothecation vault + reentrancy through the unlock guard*. Load-bearing defenses:

1. **One reentrancy guard spanning hook ↔ vault ↔ JIT rebalance** (single global guard; no
   pool-callable "unlock the guard" function — that was in Bunni).
2. **Hard-code the Aave adapter address** — never caller/hookData-supplied.
3. **NAV from settled accounting, never live balances during a swap/unlock** (the exact Bunni bug).
   Block deposit/redeem while a JIT position is open, or make NAV provably JIT-invariant.
4. **Rounding proven to favor the vault** (Halmos/Certora on the `mulDiv`s, not just fuzzing) +
   **ERC-4626 virtual/dead shares** against first-depositor/inflation.
5. **Size JIT from the swap's `amountSpecified`, never a manipulable price.** Allowlist exact PoolKeys.

## 2. Aave adapter (`AaveV3YieldAdapter`)

- **Direct `IPool.supply/withdraw`** — do **not** nest Aave's ERC-4626 wrapper (StataToken) inside;
  the vault is already the 4626 layer, nesting stacks rounding/fees/donation + a governance upgrade
  path over our funds. Resolve `Pool` via `IPoolAddressesProvider.getPool()` (never hardcode the pool).
- **`totalAssets() = aToken.balanceOf(adapter)`** — aTokens rebase, so yield accrues with **zero
  bookkeeping**. Track principal only for a yield readout, not for correctness.
- **No liquidation risk** — we only `supply`, never `borrow`/collateralize. E-mode/isolation are
  irrelevant to pure suppliers.
- **Interface (evolve the current 3-fn seam):**
  ```solidity
  interface IYieldAdapter {
      function deposit(uint256 amount) external;                            // onlyVault
      function withdraw(uint256 amount) external returns (uint256 got);     // BEST-EFFORT, returns actual
      function maxWithdrawable() external view returns (uint256);           // Aave-state-aware headroom
      function totalAssets() external view returns (uint256);               // aToken.balanceOf(self)
  }
  ```
  `withdraw` is **best-effort** (returns actual ≤ requested) so a swap never bricks when Aave is
  illiquid. `maxWithdrawable = min(aToken.balanceOf, availableLiquidity)` and **0** when the reserve
  is paused/inactive (read the `ReserveConfigurationMap` bitmask). Mirror Aave's own
  `ATokenVault._maxAssetsWithdrawableFromAave` / `_maxAssetsSuppliableToAave` (supply respects caps).
- `onlyVault`; `forceApprove` exact amounts (never `type(uint256).max`); full exit via
  `withdraw(asset, type(uint256).max, to)` (avoids 1-wei accrual-race reverts).

## 3. Buffered rehypothecation (Lever A) + JIT (Lever B)

**Lever A (default):** vault holds a **hot buffer** (~10–20% per token, a tunable
`bufferRatioBps`). Deposits split buffer/Aave; `afterSwap` checks buffer drift and does **one**
Aave `supply` or `withdraw` only when it crosses the band. This is the yield product.

**Lever B (size-gated, optional):** in `beforeSwap`, if `amountSpecified > JIT_THRESHOLD`:
withdraw **only the output-side** asset from Aave → `sync/settle` → `modifyLiquidity(+L)` a tight
range around the current tick → swap fills → `afterSwap` `modifyLiquidity(-L)` + `take` both sides +
re-`supply`. **Use `modifyLiquidity`, NOT `beforeSwapReturnDelta`** — real concentrated liquidity at
the live market tick means the swapper gets AMM pricing and *we carry no oracle/pricing risk*
(`beforeSwapReturnDelta` makes the hook the counterparty and forces us to quote). Everything runs
inside the swap's existing `unlock` — no nested unlock.

**Fallback (invariant: a swap must never revert for liquidity-sourcing reasons):**
`try aave.withdraw` → on revert use the **hot buffer** → if still short, mint a smaller position or
skip JIT and fill against resting buffer liquidity. Keep a **permanent minimum buffer outside Aave**
so the fallback is never empty. Guard re-supply too (if `supply` fails on a cap/frozen reserve, leave
tokens idle rather than reverting).

**Why JIT is benign here:** the classic JIT harm needs *passive incumbent LPs* to dilute — our vault
is the **sole LP**, so JIT is just scheduling our own liquidity to be present exactly when it earns.
Residual risk = LVR/inventory while the position is live (size the range tight, hold exactly one swap).

## 4. MEV / LVR recapture

Our `MWAmAuction` (Harberger-lease am-AMM) is the **correct SOTA engine** for a self-contained V4 hook
on Base — externally validated by Bunni v2, which ships am-AMM for exactly this. Two moves, both
**defensive not additive**:

1. **Close the unmanaged-block leak.** When no manager holds the lease, LVR leaks fully. Add a
   surge/volatility-fee fallback (we already have `MWDynamicFee` — wire it as the no-manager path).
2. **Keep any oracle read-only.** Do **not** put a price oracle in the money path (manipulation +
   liveness attack surface). Use `MWOracleGuard` only as a circuit breaker (we already do). 
- **Do NOT stack a priority-fee "MEV tax" on the manager fee** — it double-taxes the same arb and
  drives volume away. (A MEV-tax is only worth prototyping in the *no-manager fallback slot*, and
  only after confirming Base's sequencer no-last-look/censorship guarantees — which Base has not
  firmly published. Out of scope for now.)
- Harden the lease against usurp-and-censor (min lease duration / rent deposit — verify `MWAmAuction`
  already enforces this) and bootstrap real bidder participation (no bidders → ~no recapture).

## 5. Invariants to fuzz (the security spec — write these first)

1. **Solvency / NAV floor:** `totalAssets() ≥ Σ redeemable`, including the Aave leg + any open JIT.
2. **No value creation in a round-trip** (deposit→withdraw, or swap A→B→A) increases no one's balance.
3. **JIT round-trip conservation:** `(idle + aToken + pool position)` before == after, ± exactly the
   accounted fee.
4. **Delta settlement + attribution:** `NonzeroDeltaCount==0` at unlock end AND every delta maps to a
   labelled bucket (principal / fees / JIT-borrowed never co-mingled).
5. **Share-price monotonicity:** never decreases except by realized fees/losses; no deposit/redeem
   moves it (inflation invariant).
6. **Aave-accounting consistency:** internal supplied-principal record == derived aToken balance.
7. **Rounding always favors the vault** (the invariant that would have caught Bunni).
8. **Fee bounds:** dynamic/manager fee ∈ [min,max] across all auction + override paths.
9. **Reentrancy safety:** malicious-token / malicious-adapter / malicious-hook handlers find no state
   change (models Bunni + Cork).
10. **No unrecoverable liquidity:** no sequence DoSes a position.

**Verification:** Foundry invariant/handler + **dual-fuzzer Echidna + Medusa** (Chimera/Recon
scaffolding — what V4 teams use) at high depth; **Halmos/Certora** to *prove* the `mulDiv` rounding
directions and share↔asset conversions; malicious-mock handlers (fee-on-transfer/rebasing/pausable
tokens, hostile Aave adapter, adversarial PoolKeys); **mainnet-fork tests against live Aave**
(real utilization, accrual, the withdraw-under-100%-utilization failure path).

## 6. Phased build (each phase = a green forge gate)

| Phase | Deliverable | Why this order |
|---|---|---|
| **1a** | `AaveV3YieldAdapter` + buffered rehypothecation wired into the pair vault (buffer ratio, `afterSwap` band-rebalance), Bunni-hardened NAV (settled accounting, virtual shares, conservative rounding) | The MVP — idle yield, the actual product, most tractable |
| **1b** | Size-gated true JIT (Lever B, `modifyLiquidity`, layered fallback) | Whale fast-path; layered on proven A |
| **1c** | MEV completeness: no-manager surge-fee fallback; verify lease-usurp hardening | am-AMM exists; close the leak |
| **2** | Invariant spec (§5) green under Echidna+Medusa + Halmos proofs on the math; Aave fork tests | Runs **concurrent** with 1a–1c, not after |
| **3** | Value-capture template: buyback/burn fee sinks; impact fee (optional) | Completes the "flexible template" |
| **4** | ≥2 independent audits (1 V4-specialist), bug bounty, guarded launch (TVL caps, timelock+multisig, circuit breaker) → mainnet | Non-negotiable for a novel high-value primitive |

**Testnet-first throughout.** Mainnet only after Phase 4.

## 7. What we already have (reuse, don't rebuild)
`MintwareDeFiPairVault` (dual-sided, solvent) · `MWHookCoordinator` (0xAC8: beforeSwap/afterSwap/
beforeSwapReturnDelta — exactly the JIT perm set) · `MWAmAuction` (am-AMM, fork-proven) ·
`MWDynamicFee` (the no-manager surge fee) · `MWOracleGuard` (read-only circuit breaker) ·
`IYieldAdapter` seam (evolve per §2) · a solvency invariant at 128k calls (extend to the Aave leg).

## 8. Key sources
Aave `ATokenVault` (max-withdrawable/suppliable pattern) · Trail of Bits "Building secure Uniswap v4
hooks" (2026) · Bunni v2 overview + exploit post-mortems (our cautionary twin) · am-AMM paper
(arXiv:2403.03367) · LVR (arXiv:2208.06046) · OZ ERC-4626 inflation defense · Recon/Chimera invariant
scaffolding · Paradigm "Priority Is All You Need" (MEV-tax, and its Base caveats). Full links in the
research briefs archived with this session.
