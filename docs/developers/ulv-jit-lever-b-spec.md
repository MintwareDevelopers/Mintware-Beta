# ULV Increment 1b — Size-Gated True JIT (Lever B) — Implementation Spec

**Builds on:** inc-1 `AaveV3YieldAdapter` (#144) + inc-2 buffered rehypothecation (#154).
**Design source of truth:** `ulv-engine-design.md` §1 (threat model), §3 (Lever B), §5 (invariants).
**Bar:** this is the exact Bunni v2 ($8.4M) surface — a V4 hook moving liquidity + Aave inside a swap
unlock. Write the invariants FIRST, execute REAL swaps through the JIT liquidity in the fuzz harness,
gate at 256×128k with zero reverts. Round every division against the user. No price/oracle in any
money-path math — the *swap itself* is the only price.

---

## 0. The one hard V4 fact this is built around

During `beforeSwap`/`afterSwap` the PoolManager is **already unlocked** (the swapper owns the unlock).
So the hook can call `poolManager.modifyLiquidity` **directly** — but it must **NOT** call any vault
path that does its own `poolManager.unlock` (deposit / redeem / rebalanceBuffer / rebalanceToProfile /
collectFees) — that is a nested unlock → revert. 1b therefore adds a **hook-only mid-swap bridge** on
the vault whose functions call `modifyLiquidity` + the Aave adapter + `_settleDelta` **directly** (no
`unlock`), because they only ever run *inside* the swap's existing unlock.

---

## 1. Vault surface (new) — `MintwareDeFiPairVault`

```solidity
address public hook;                 // the MWHookCoordinator; set-once
function setHook(address h) external onlyOwner;   // require(hook == address(0)); hard-wire, never caller-supplied

// ── transient JIT state — MUST be zero at rest (between txs). NOT part of share/redeem math. ──
uint128 public jitLiquidity;         // open JIT liquidity units currently in the pool
int24   public jitTickLower;
int24   public jitTickUpper;
bool    public jitActive;            // reentrancy/consistency flag

modifier onlyHook() { if (msg.sender != hook) revert OnlyHook(); }

/// @notice Hook calls this in beforeSwap for a size-gated swap. Withdraws ONLY the output-side asset
///         from its Aave adapter, adds a tight SINGLE-SIDED range at the live tick, settles.
/// @return L the JIT liquidity actually opened (0 ⇒ hook falls back to resting liquidity, swap proceeds)
function jitOpen(bool zeroForOne, uint256 outputBudget) external onlyHook returns (uint128 L);

/// @notice Hook calls this in afterSwap. Removes jitLiquidity, takes both sides, books the fee slice
///         into the fee accumulators, re-supplies principal to the adapters, clears JIT state.
function jitClose() external onlyHook;
```

**Reentrancy / NAV-invariance (threat model §1.1, §1.3):**
- `jitActive` is set true in `jitOpen`, false in `jitClose`. While true, **`deposit`, `requestRedeem`,
  `executeRedeem`, `collectFees`, `supplyIdle`, `recallIdle`, `rebalanceBuffer`, `rebalanceToProfile`
  all revert** (`JitInProgress`). This is the single guard spanning hook↔vault↔JIT. (In practice no
  external call can interleave within one swap tx — this defends the hostile-token-callback path.)
- `jitLiquidity` is **never** added to `positionLiquidity` and **never** enters share/redeem/deposit
  math. Shares still map only to `positionLiquidity`. Because JIT opens and closes inside a single
  swap tx, `jitLiquidity == 0` at rest, so the existing `invariant_position_backs_pooled_units`
  (on-chain liquidity == positionLiquidity) still holds between txs.

---

## 2. `jitOpen` — single-sided add (the math)

Direction: for a swap `zeroForOne == true` (trader sells token0, price ↓, tick ↓) the pool pays out
**token1** — so we add **single-sided token1** liquidity in a tight range **at/below** the current
tick. For `zeroForOne == false`, add **single-sided token0** at/above the current tick. Output-side
only (never touch the input adapter in `jitOpen`).

1. `adapter = zeroForOne ? adapter1 : adapter0`. If `address(adapter) == 0` → `return 0` (no JIT).
2. `want = min(outputBudget, adapter.maxWithdrawable())`. Cap `want` at a **per-swap ceiling** and a
   **per-block cumulative ceiling** (security rec #1: capital caps). If `want == 0` → `return 0`.
3. `got = adapter.withdraw(want)` (best-effort; `got ≤ want`). If `got == 0` → `return 0`.
4. Read live `(sqrtP, tick)` from `getSlot0`. Build a tight single-sided range aligned to
   `tickSpacing`:
   - `zeroForOne` (token1 side, below tick): `jitTickUpper = floorToSpacing(tick)`,
     `jitTickLower = jitTickUpper - JIT_WIDTH_TICKS`. (Range strictly ≤ current tick ⇒ pure token1.)
   - else (token0 side, above tick): `jitTickLower = ceilToSpacing(tick)`,
     `jitTickUpper = jitTickLower + JIT_WIDTH_TICKS`. (Range strictly ≥ current tick ⇒ pure token0.)
   - Ensure the range excludes the current tick's partial band so the position is genuinely
     single-asset (avoids needing the *other* token to add).
5. `L = zeroForOne ? getLiquidityForAmount1(sqrtLower, sqrtUpper, got) :
        getLiquidityForAmount0(sqrtLower, sqrtUpper, got)`. If `L == 0` → re-supply `got` back to the
   adapter (undo step 3) and `return 0`.
6. `modifyLiquidity(+int256(L))` at `[jitTickLower, jitTickUpper]`, salt = a dedicated JIT salt
   (e.g. `keccak256("MW_JIT")`) so the JIT position is a **separate pool position** from the main one
   (`salt = 0`) — never co-mingled. `_settleDelta(delta)` pays the `got` output token in.
7. Decrement the output-side idle counter by the principal actually deployed: `idleN -= got` (settled
   accounting — the money left Aave and is now in the pool). Set `jitLiquidity = L`,
   `jitActive = true`, record ticks.

**Fallback invariant (§3): a swap must never revert for liquidity-sourcing reasons.** Every early
`return 0` above is a clean no-op fallback: no JIT liquidity, `jitActive` stays false, the swap fills
against the resting `positionLiquidity` buffer. `jitOpen` must be `try`-safe from the hook's side too
(the hook wraps the call; a revert inside must not brick the swap — see §4).

## 3. `jitClose` — remove + attribute + re-supply

1. If `!jitActive` → return (idempotent; hook always calls, JIT may not have opened).
2. `modifyLiquidity(-int256(jitLiquidity))` at the recorded JIT ticks + salt. `_settleDelta` **takes**
   both sides → vault now holds `g0` token0 and `g1` token1 back from the JIT position (principal
   converted by the swap + LP fees the JIT position earned).
3. **Fee attribution without a price.** The JIT position was opened single-sided with `got` of the
   output token. After the swap it returns a mix. Do NOT try to value it. Instead:
   - Re-supply what came back to the adapters as **principal**, up to the idle counters' recorded
     basis, and route the **excess** (the fee/LVR the JIT captured) into the fee accumulators:
   - Simplest correct rule that rounds toward the vault: treat the **entire** returned `g0/g1` as
     principal to re-idle (`idle0 += g0'`, `idle1 += g1'` after supply), and separately harvest the
     fee via the EXISTING yield-harvest path already in the vault (`totalAssets - idleN` on the next
     harvest). **Under-crediting fees to LPs in this step is acceptable (vault-favoring); over-
     crediting is not.** Document the exact rule chosen and prove it with `jit_roundtrip_conserves`.
   - Re-supply: `token1.forceApprove(adapter1, amt); adapter1.deposit(amt)` (best-effort — if the
     reserve is capped/frozen, `maxSuppliable()==0`, leave the tokens idle in the vault rather than
     reverting; they still back idle counters via balance, so pick the counter update to match where
     the value actually sits).
4. Clear `jitLiquidity = 0; jitActive = false;` (and zero the tick records). CEI: state cleared only
   after external adapter calls complete, but the guard already prevents reentrant redeem, so ordering
   is safe either way — prefer clearing last so a mid-close reentrancy still sees `jitActive`.

**Conservation is per-token, never valued:** `(idle0 + idle1 + pool position + fee reserve)` in raw
token units before the JIT round-trip == after, ± exactly the LP fee the pool credited. No sequence
creates value.

---

## 4. Hook surface (new) — `MWHookCoordinator`

- Add `uint256 public jitThreshold` (per-pool or global) and a `mapping(PoolId=>bool) jitEnabled`
  (allowlist exact pools — threat model §1.5). Owner-set.
- **`beforeSwap`**: keep the existing am-AMM path EXACTLY. After computing the am-AMM
  `(selector, beforeSwapDelta, feeOverride)`, if `jitEnabled[id]` and
  `abs(params.amountSpecified) >= jitThreshold`, call
  `try IMWVault(vault).jitOpen(params.zeroForOne, sizeFromSpecified(params)) { } catch { }` — a revert
  or a `0` return is a silent fallback (swap proceeds on resting liquidity). The am-AMM
  `beforeSwapDelta`/fee return is **unchanged** — JIT liquidity settles on the vault's own delta
  account (separate from the hook's fee delta), both nett out by unlock end.
- **`afterSwap`**: keep the oracle update. Then `try IMWVault(vault).jitClose() { } catch { }`.
  `jitClose` must be robust — but note: if `jitOpen` succeeded and `jitClose` reverts, the JIT
  position would be left open (unsettled delta → the whole swap tx reverts, which is *safe* — no
  half-open state persists). Ensure `jitClose` cannot revert for a recoverable reason (best-effort
  re-supply); a revert here is only acceptable if it unwinds the entire swap.
- Composition proof required: a managed (am-AMM manager present) swap that ALSO triggers JIT must
  leave `NonzeroDeltaCount == 0` at unlock end and charge the manager fee correctly.

`sizeFromSpecified`: derive the output budget from `amountSpecified` (exact-in ⇒ scale the input;
exact-out ⇒ the output amount is the specified) — **never** from a spot/oracle price. Keep it
conservative (a fraction of the swap, not a multiple).

---

## 5. Invariants to write FIRST (the gate) — extend the inc-2 invariant suite

The handler must include a **real V4 swap** action that routes a swap through the pool (via a
`PoolSwapTest`-style router) with sizes that straddle `jitThreshold`, against a mock Aave adapter with
tunable liquidity (incl. the illiquid/paused path), and hostile-token / hostile-adapter mocks.

1. `invariant_jit_zero_at_rest` — `jitLiquidity == 0 && jitActive == false` between txs (always).
2. `invariant_solvency_incl_open_jit` — `adapterN.totalAssets() + poolPrincipalN + vaultBalN ≥
   Σ redeemable per token`, holding even if a handler could observe mid-JIT (model via a reentrant
   probe that must revert `JitInProgress`).
3. `invariant_jit_roundtrip_conserves` — per token, value in == value out ± exactly the credited fee;
   no net token creation across a swap-with-JIT.
4. `invariant_delta_settled` — after every swap-with-JIT, `poolManager` reports zero outstanding
   deltas for the vault and hook accounts.
5. `invariant_swap_never_bricks` — fuzz Aave illiquid / paused / partial-withdraw / add-reverts:
   the swap **always** completes (JIT silently falls back); no sequence DoSes the pool.
6. `invariant_rounding_favors_vault` — deposit→(swap-with-JIT)*→redeem never returns a depositor more
   than contributed (single- and multi-actor).
7. Keep all inc-2 invariants green (`aave_backs_idle`, `position_backs_pooled_units`,
   `shares_sum_equals_supply`, `vault_backs_fee_reserve`, `fee_accumulators_monotonic`).

Each at **256 runs × 128,000 calls, 0 reverts**. Plus focused fuzz:
`jit_open_close_single_swap`, `jit_falls_back_when_aave_dry`, `managed_swap_plus_jit_composes`.

---

## 6. Guardrails / do-not

- **No** `beforeSwapReturnDelta` for JIT liquidity — use real `modifyLiquidity` (the hook already
  reserves the bit for am-AMM; JIT does not touch it).
- **No** oracle/price in `jitOpen`/`jitClose`/`sizeFromSpecified` sizing — only `amountSpecified` +
  `maxWithdrawable`.
- Adapter addresses are **hard-wired** on the vault (already are) — never hookData/caller-supplied.
- Dedicated JIT position salt — never share the main position's `salt = 0`.
- Per-swap AND per-block capital caps on `jitOpen`.
- `jitActive` blocks every unlock-based vault entrypoint.
- Do **not** modify the inc-2 idle/redeem accounting except to decrement/increment idle counters on
  JIT open/close; the price-free share model is settled law.
- Commit, do **not** push. Leave for human review.
```
