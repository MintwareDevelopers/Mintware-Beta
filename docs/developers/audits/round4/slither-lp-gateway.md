# Round 4 — Slither pass (2026-09-08, post earn-vs-lp + D-4/IA-4)

**Tool:** Slither 0.11.5, per-contract direct-solc workaround (`slither_tooling_workaround` memory —
crytic-compile doesn't understand this repo's `foundry.toml` `out` dir, so each file is analyzed
standalone: `--solc <solc-select 0.8.26> --solc-remaps "<foundry remappings>" --solc-args="--via-ir
--optimize"`). **Scope:** the 4 substantial LP Gateway V1 contracts (`IYieldAdapter.sol`/
`SeniorSharesMath.sol` are trivial and produced nothing beyond noise already covered here).

Each file is analyzed against its own full import closure (Uniswap v4-core/periphery + OpenZeppelin),
so raw result counts (216/17/220/23/22) are dominated by upstream-library noise; the table below is
filtered to findings whose location is actually inside OUR file.

## Summary

| File | Findings (ours) | Notable |
|---|---|---|
| `MintwareLpGatewayPositionManager.sol` | 71 | reentrancy-balance/no-eth ×~30 (deploy/_withdraw), incorrect-equality ×11, uninitialized-local ×7, unused-return ×5, cyclomatic-complexity ×2, timestamp ×2, pragma/too-many-digits |
| `MintwareLpGatewayStaging.sol` | 2 | unused-return (`adapter.withdraw`), pragma |
| `MintwareLpGatewayFactory.sol` | 5 | reentrancy-no-eth/benign/events ×3 (`createGateway`), pragma, low-level-calls |
| `MintwareERC4626YieldAdapter.sol` | 7 | **arbitrary-send-erc20 (High)**, incorrect-equality ×2, reentrancy-no-eth, unused-return, missing-zero-check, pragma |
| `MintwareIdleYieldAdapter.sol` | 6 | **arbitrary-send-erc20 (High)**, incorrect-equality, missing-zero-check, reentrancy-benign, pragma, low-level-calls |

## Triaged (verified against source, not taken at face value)

- **`arbitrary-send-erc20` (High) on both adapters' `deposit()`** — `asset.safeTransferFrom(vault, address(this), amount)`.
  Slither flags any `transferFrom` whose `from` isn't `msg.sender`. **FALSE POSITIVE**: `vault` is a
  fixed, owner-bound state variable (one-time `setVault`), and `deposit()` itself is `onlyVault`-gated —
  only the bound staging contract can call it, and it always pulls from itself. Same FP class already
  documented in `slither_tooling_workaround` memory ("onlyJitHook transferFrom").
- **`reentrancy-balance`/`reentrancy-no-eth` on `deploy()`/`_withdraw()`/`createGateway()`** — both
  `deploy()` and `withdraw()` (which calls `_withdraw`) are `nonReentrant` (OpenZeppelin
  `ReentrancyGuard`, one shared `_status` slot per contract — blocks cross-function reentry too, not
  just same-function). Likely the same FP class the round-3 memory already closed out ("two
  V4-unlock/re-read reentrancy FPs") — Slither's detector doesn't model `ReentrancyGuard` fully, it
  flags the external-call-then-state-write SHAPE regardless of the guard. **Not re-triaged exhaustively
  here** — this is exactly what the round-4 audit's dedicated `reentrancy-unlock` dimension (adversarial
  verified) covers properly, including the harder question of whether the in-contract zap's OWN
  `unlockCallback` could reenter a DIFFERENT guarded function before the guard's slot is set (it can't —
  the modifier wraps the entire external function body — but worth a real dimension pass, not a
  five-minute triage).
- **`incorrect-equality`** (strict `== 0`/`== ts` checks) — standard Solidity idiom for exact-zero /
  exact-match sentinel checks (e.g. `lastHolder = shares == ts`, `amount == 0` early-return guards).
  Not a real "dangerous equality" (that detector is aimed at floating-point-style comparisons, which
  don't apply to Solidity integers) — informational noise, no fix needed.
- **`uninitialized-local`** (`liq`, `idleGot`, `spot`, `lpSpotVal`, `pairedGot`, `reCredit`, `lpFailed`) —
  Solidity zero-initializes locals by default; each of these is deliberately read as its zero-value
  BEFORE being conditionally set later in the same function (e.g. `bool lpFailed` starts `false`, is
  the correct pre-branch state). Not a real bug.

## Not yet triaged (left for the round-4 dimension-hunt + adversarial verify, not resolved here)

- `unused-return` on `poolManager.unlock()` / `poolManager.settle()` / the discarded 3-of-4 `getSlot0()`
  tuple fields — worth confirming none of the discarded values (protocolFee, lpFee) ever matter to a
  correctness invariant, given the `deploy()` price logic reads only `sqrtPriceX96`.
- `missing-zero-check` on both adapters' `vault_` constructor param (currently commented `// zero
  allowed` in source) — confirm that's actually a deliberate, safe design choice (a zero vault would
  brick `onlyVault`-gated deposit/withdraw until `setVault` is called) and not a stale comment.
- `MintwareLpGatewayFactory.createGateway`'s 3 reentrancy flags and `_verifyAdapterBinding`'s low-level
  call — feeds the `access-control` and `registry-trust-root` dimensions.
- The two `cyclomatic-complexity` flags on `deploy()` (28) and `_withdraw()` (31) aren't security
  findings by themselves, but high complexity is exactly where a real bug hides — both functions get
  extra scrutiny in the dimension-hunt rather than being waved off because Slither's own severity here
  is "Informational."

## Honest caveat

Per-contract analysis means Slither never sees cross-contract call graphs in one pass (e.g. it can't
reason about `MintwareLpGatewayFactory` calling into `MintwareLpGatewayPositionManager`'s constructor
end-to-end in the same detector run) — that's a job for the manual dimension-hunt + Foundry
invariant/fork suite, not this tool. Vaults/-cluster-wide analysis is still blocked by Slither's own
file-level-enum parser bug (`VaultTypes.sol`'s `LockTier`) — irrelevant here since none of these 5 files
import it.
