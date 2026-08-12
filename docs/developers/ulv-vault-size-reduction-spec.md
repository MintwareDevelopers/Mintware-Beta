# ULV Vault Size Reduction — EIP-170 Extraction Spec

**Problem:** `MintwareDeFiPairVault` deployed runtime = **32,098 bytes**, over the EIP-170 limit
(24,576) by **7,522**. Confirmed at `optimizer_runs` 1 and 200 + via_ir, so it's a code-size problem,
not a build flag. This blocks the testnet/mainnet deploy. Every OTHER contract fits.

**Goal:** get the vault deployed runtime **≤ 24,576 bytes** (aim ≤ ~22,500 for margin) WITHOUT any
behavioral change, then re-prove with the full invariant suite.

## Strategy — extract the JIT subsystem into an external linked library

The JIT subsystem is the newest + most self-contained ~8KB (it's what pushed the vault over). Move it
into an **external `library MWJitLib`** (deployed separately, linked, delegatecalled → shrinks the
vault). Keep **every storage write + every guard/modifier in the vault** — the library is STATELESS
(memory struct in → memory struct out). If the JIT extraction alone isn't enough, extend the same
pattern to the idle subsystem (`_supplyIdleCore`/`_refillIdleCore`).

### The pattern (safe — state stays in the vault)
The library's `external` functions run via delegatecall in the vault's context, so `poolManager`
calls act AS the vault and `token.balanceOf(address(this))` sees the vault's balance. The library
**cannot** read the vault's immutables — pass them in a `Ctx` memory struct. It does NOT touch
storage — the vault loads state into a memory `JitState`, passes it, and writes back the returned
`JitState`. This keeps all mutation auditable in the vault and behind its `nonReentrant`/`onlyHook`
guards.

```solidity
library MWJitLib {
    struct Ctx { IPoolManager pm; PoolKey key; IERC20 t0; IERC20 t1; IYieldAdapter a0; IYieldAdapter a1; }
    struct JitState {
        uint128 jitLiquidity; bool jitActive; int24 lo; int24 hi;
        uint256 jitClaim0; uint256 jitClaim1; uint256 idle0; uint256 idle1;
    }
    // moves the BODIES of jitOpen / jitClose / _takeOrClaim / _redeemClaim (sweep) + the range/
    // liquidity math + a private _settleDelta/_pay copy. Returns (JitState, extras).
    function open(Ctx memory c, JitState memory s, bool zeroForOne, uint256 want, int24 spacing,
                  int24 widthSpacings, bytes32 jitSalt, uint256 virtualFloor)
        external returns (JitState memory, uint128 L);
    function close(Ctx memory c, JitState memory s, bytes32 jitSalt)
        external returns (JitState memory, uint256 taken0, uint256 taken1, uint256 claimed0, uint256 claimed1);
    function sweep(Ctx memory c, JitState memory s)
        external returns (JitState memory, uint256 r0, uint256 r1);
}
```

### Vault wrappers (thin — keep guards + load/store)
```solidity
function jitOpen(bool zeroForOne, uint256 outputBudget) external onlyHook nonReentrant returns (uint128 L) {
    if (jitActive || !poolInitialized) return 0;
    uint256 want = _jitCap(_sizeWant(zeroForOne, outputBudget)); // keep the cap logic in the vault OR pass caps into the lib
    MWJitLib.JitState memory s = _loadJit();
    (s, L) = MWJitLib.open(_jitCtx(), s, zeroForOne, want, poolKey.tickSpacing, JIT_WIDTH_SPACINGS, JIT_SALT, VIRTUAL_LIQUIDITY);
    _storeJit(s);
}
```
`_loadJit()`/`_storeJit(s)` read/write **every** field: `jitLiquidity, jitActive, jitTickLower,
jitTickUpper, jitClaim0, jitClaim1, idle0, idle1`. **Completeness is load-bearing** — a missed
write-back = state corruption. The `_recordJitWithdraw` per-block cap counter + `_jitCap` can stay in
the vault (cheap) and pass the clamped `want` into the library.

## Hard rules (do NOT violate)
- **No behavioral change.** Same math, same rounding (toward vault), same ERC-6909 take-or-mint-claim
  shortfall handling, same fallback (`return 0` → no-op), same single-sided range, same dedicated salt.
- **State writes stay in the vault** via `_storeJit`. The library never writes vault storage.
- `nonReentrant` / `onlyHook` / `notDuringJit` stay on the vault wrappers.
- Do NOT touch deposit / redeem / `_realizeFees` / `_splitFee` / rebalance / lock accounting UNLESS
  the JIT extraction is insufficient for size — then extend the SAME stateless-library pattern to the
  idle core, and only that.
- Adapters + poolManager passed via `Ctx`; never re-read as immutables inside the lib.

## Gate (the proof — non-negotiable)
1. `export PATH="$HOME/.foundry/bin:$PATH"; forge build --sizes` → **MintwareDeFiPairVault ≤ 24,576**
   (report the exact number + margin). If still over, extend to the idle core and re-measure.
2. Full `forge test` green (target ~337 pass / 0 fail / 3 skip — same as before).
3. The JIT + buffered invariant suites at **256 runs × 128,000 calls, 0 reverts** — `forge test
   --match-contract "MintwareDeFiPairVaultJitInvariant|MintwareDeFiPairVaultInvariant"`. This is the
   Bunni-surface proof; a storage-layout slip in the load/store shows up here.

## Deliverable
Commit on this branch. Do NOT push / PR / deploy. If you must stop mid-way, commit WIP with a clear
message + report exactly: (a) vault size now, (b) what's extracted, (c) forge build/test/invariant
status, (d) anything unfinished or uncertain. Report the measured size + full invariant results.
