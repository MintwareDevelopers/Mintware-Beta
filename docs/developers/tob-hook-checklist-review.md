# Trail-of-Bits-style Uniswap-v4 Hook Vulnerability Self-Review

> **⚠ SELF-REVIEW — NOT AN EXTERNAL AUDIT.** This is an internal, grounded read of Mintware's
> Uniswap-v4 hooks against the seven hook-vulnerability patterns Trail of Bits published in
> *"Building secure Uniswap v4 hooks"* (blog.trailofbits.com, 2026-07-30). It was written by the
> team against its own code. It is **not** an audit, carries **no** assurance, and must never be
> represented as audited. All contracts under review are **testnet + unaudited** (Base Sepolia / Arc
> testnet). External audit remains the only gate before real value. The purpose of this document is
> to **reduce external-audit cost and surface area** by pre-mapping the ToB pattern set to concrete
> code — not to substitute for that audit.

Source pattern set: <https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/>

## Scope (contracts read)

| Contract | Path |
|---|---|
| `MWHookCoordinator` (+ `MWDynamicFee`, `MWOracleGuard`) | `contracts-v4/src/hooks/` |
| `MintwareTreasuryJitHook` (JIT hook, counter-asset leg) | `contracts-v4/src/payments/MintwareTreasuryJitHook.sol` |
| `MWTreasuryPositionLib` (delegatecall position library) | `contracts-v4/src/payments/lib/MWTreasuryPositionLib.sol` |
| `MintwareTreasuryVault` (flash-accounting / settlement counterpart) | `contracts-v4/src/payments/MintwareTreasuryVault.sol` |
| `MWJitLib` (pair-vault JIT settle helper, cross-referenced) | `contracts-v4/src/vaults/lib/MWJitLib.sol` |

Evidence for "already covered" comes from the Forge suites in `contracts-v4/test/` (hook,
JIT-stack, treasury, invariant, and fork harnesses).

## Summary table

| # | Pattern (ToB) | Verdict | One-line evidence |
|---|---|---|---|
| 1 | Callback access control | **PASS** | `onlyPoolManager` on every hook callback; vault `unlockCallback` gated `_onlyPoolManager()`; `beforeInitialize` gated to `owner()` (JIT). |
| 2 | Pool/key binding (Cork class) | **PASS** | JIT hook hard-binds to `canonicalPoolId` and no-ops foreign pools; coordinator's dangerous actions are all default-OFF per-pool opt-ins. |
| 3 | Delta / settlement conservation (Bunni class) | **PARTIAL** | am-AMM skim and JIT mint-claim+sweep both net to zero; but the shared `_pay` helpers assume ERC-20 and revert on native ETH, and the class is demonstrably live here (two already-found bugs). |
| 4 | Price / oracle manipulation | **PASS** | Truncated `MWOracleGuard` tick oracle; position valued at `min(spot, oracle)`; unwind swaps band-limited to `oracle ± 500 ticks`. |
| 5 | Reentrancy | **PASS** | Money paths `nonReentrant`; `unlockCallback` correctly NOT `nonReentrant` but pool-manager-only; delegatecall only to the stateless `MWTreasuryPositionLib`. |
| 6 | Return values / selectors / hookData | **PASS** | Correct selectors + `BeforeSwapDelta` returned; `hookData` unused; exact-output rejected on the skim path. |
| 7 | Permission bits / address mining | **PASS** | Constructors call `Hooks.validateHookPermissions`; deploy scripts mine the matching flags (coordinator `0xAC8`, JIT `0x20C8`) via `HookMiner.find`. |

**Tally: 6 of 7 PASS, 1 PARTIAL (pattern 3).** No FAILs. Residual items are listed at the end.

---

## Per-pattern detail

### 1. Callback access control — PASS

Both hooks reject any caller that is not the PoolManager, on every callback:

- `MWHookCoordinator` — `modifier onlyPoolManager` (`MWHookCoordinator.sol:139-142`) reverts
  `OnlyPoolManager()`; it is applied to `beforeAddLiquidity` (`:250`), `beforeRemoveLiquidity`
  (`:257`), `beforeSwap` (`:266`), and `afterSwap` (`:423`). The coordinator never opens its own
  unlock (no `IUnlockCallback`, no `poolManager.unlock` — grep-confirmed 0 matches), so there is no
  second callback surface to guard.
- `MintwareTreasuryJitHook` — `modifier onlyPoolManager` (`MintwareTreasuryJitHook.sol:199-202`) on
  `beforeSwap` (`:350`), `afterSwap` (`:484`), and `unlockCallback` (`:520`). It additionally gates
  pool creation: `beforeInitialize` reverts `UnauthorizedInitializer` unless `sender == owner()`
  (`:712-715`) — closing the front-run-the-initialize grief on a mined hook/salt.
- `MintwareTreasuryVault.unlockCallback` calls `_onlyPoolManager()` as its first statement
  (`MintwareTreasuryVault.sol:729-730`).

The unused IHooks callbacks are `pure`/selector-only or `revert HookNotImplemented()`, and the
address bits (pattern 7) ensure they are never invoked.

### 2. Pool/key binding (Cork class, ~$12M) — PASS

The JIT hook implements the canonical-pool guard explicitly. `canonicalPoolId` is an immutable
computed in the constructor from the hook's own address (`MintwareTreasuryJitHook.sol:215-221`), and
both hot-path callbacks reject any other pool that names this hook — as a **no-op, never a revert**
(a revert would brick that foreign pool for its users):

- `beforeSwap` — `if (PoolId.unwrap(key.toId()) != PoolId.unwrap(canonicalPoolId)) return (...ZERO_DELTA, 0);`
  (`:354-356`).
- `afterSwap` — mirror guard (`:487-489`).

This is the direct Cork-class defense: without it, an attacker could `initialize` a different pool
naming this hook and drive `_open`/`borrowIdleForJit` against an attacker-chosen `PoolKey`, deploying
senior USDC into an attacker pool. Covered by test
`MintwareTreasuryJitStack.t.sol:181-207` ("hook fired JIT on a NON-canonical pool (Cork-class hole)"
asserts `vault.jitBorrowed() == 0`).

`MWHookCoordinator` takes the multi-tenant approach (it serves many pools), so it does **not** bind
to one canonical id. It is nonetheless Cork-safe because every value-moving action is a per-pool,
default-OFF, owner-set opt-in, and the liquidity gate rejects non-vault senders on **any** pool:

- LP gate: `beforeAddLiquidity`/`beforeRemoveLiquidity` revert `OnlyVaultCanModifyLiquidity` unless
  `sender == vault` (`:252`, `:259`) — pool-independent.
- Manager skim only runs when `amAmmEnabled[id] && auction != address(0)` (`:283`) — both owner-set.
- JIT only fires when `jitEnabled[id] && vault != address(0)` (`:305`) — `jitEnabled` is owner-set
  per pool and documented as "only for pools whose `vault` really is the JIT bridge" (`:118-120`).
- On an unconfigured (attacker) pool, `feeParams[id].configured == false` ⇒ `dynamicFeeEnabled` and
  `guardEnabled` are false, so `beforeSwap` returns the plain selector + zero delta + zero override
  and `afterSwap`'s `if (dynamicFeeEnabled || guardEnabled)` is false ⇒ **no coordinator storage is
  written and no funds move** for a foreign pool.

Verdict PASS; see residual R1 for the hardening nuance (implicit vs explicit binding).

### 3. Delta / settlement conservation (Bunni class, ~$8.4M) — PARTIAL

**Where conservation is correctly handled:**

- **am-AMM manager skim nets to zero within the unlock.** `_beforeSwapAmAmm` takes the fee to the
  auction (books `−fee` to the hook) and returns `+fee` on the specified `BeforeSwapDelta`, which is
  booked to the hook in `afterSwap` (`MWHookCoordinator.sol:379-384`; identical structure in
  `MintwareTreasuryJitHook.sol:474-478`). `feePips < 1_000_000` is enforced (`revert FeeTooHigh`,
  `:361` / `:464`) so `fee < amt` and the specified delta can't flip the swap.
- **JIT afterSwap-timing gotcha handled with mint-claim + keeper sweep.** The swapper settles its
  input *after* `afterSwap`, so the closed JIT position can't `take()` physical tokens mid-callback.
  `_close` instead MINTs ERC-6909 claims for the owed sides (`poolManager.mint`,
  `MintwareTreasuryJitHook.sol:620-621`) and pays any negative side via `_pay` — netting the unlock
  to zero — then the permissionless `sweepJit()` redeems the claims post-settlement, swaps team→USDC,
  and returns to the vault (`:509-547`). Between phases the vault holds `jitBorrowed` at par so senior
  NAV is unaffected. This is exactly the ToB pattern-4 (timing) + settlement-conservation resolution.
- **Vault-side accounting is balance-diff, not naked `balanceOf`.** `MWTreasuryPositionLib` measures
  every deploy/recover/collect leg by before-vs-after balance diff (`:88-100`, `:119-135`,
  `:141-157`) precisely because the vault co-custodies the junior reserve and buffers — the Bunni
  failure mode (accounting that satisfies settlement but mis-attributes balances) is specifically
  guarded here.

**Why PARTIAL — the class is demonstrably live in this codebase, and one gap remains:**

- The shared settle helper assumes ERC-20. `_pay` does
  `IERC20(Currency.unwrap(currency)).safeTransfer(address(pm), amount); pm.settle();` in three
  places: `MintwareTreasuryJitHook.sol:686-690`, `MWTreasuryPositionLib.sol:271-275`, and
  `MWJitLib.sol:267-271`. For a **native-ETH** currency (`Currency == address(0)`) this reverts —
  native settlement must use `pm.settle{value:...}()`. It is not exploitable in the *deployed*
  configuration (the JIT hook constructor requires USDC to be one leg and both legs are ERC-20 by
  construction — `MintwareTreasuryJitHook.sol:223-229`), so it is a **scoping limitation**, not a
  live hole today. But it means the settlement layer is silently ERC-20-only.
- This project has already found and fixed **two** bugs in exactly this class, which is why the
  pattern earns a PARTIAL rather than a clean PASS — the accounting surface is real and adversarial:
  1. **Native-ETH sweep revert** — the `_pay` limitation above (ERC-20-only settle).
  2. **Multi-venue `maxSuppliable` overflow / mis-model** — the pre-fix adapter returned
     `type(uint256).max` regardless of Aave's supply cap, so the idle guard would attempt a supply
     that reverts `SupplyCapExceeded` instead of no-oping. Fixed and proven in
     `contracts-v4/test/fork/ULVDeploymentFork.t.sol:163-176` (capped market ⇒ finite headroom;
     uncapped ⇒ max sentinel).

Bunni-class regression coverage is otherwise strong: `test/invariant/seam/MicroWithdrawInvariant.t.sol`
(the direct 44-tiny-withdrawal dust-burst analog), `TreasuryNavMonotonicInvariant.t.sol`,
`TreasuryRebalanceSeamInvariant.t.sol`, and `adapters/ERC4626AdapterInvariant.t.sol` all target the
conservation invariant.

**Recommendation:** either (a) make the native-ETH limitation explicit — `require` non-native
currencies at construction, or add a `currency.isAddressZero()` branch using `pm.settle{value:...}()`
in all three `_pay` copies — and (b) fold the three duplicated `_pay`/`_settleDelta` copies into one
audited helper so a future native-ETH fix can't land in two of three sites. Flag both to the external
auditor as known and scoped.

### 4. Price / oracle manipulation — PASS

Spot cannot be flash-pumped to inflate valuation or the JIT/skim decision:

- **Truncated tick oracle.** `MWOracleGuard.update` advances at most once per block and clamps each
  advance to `maxTickMovePerBlock × min(blocksElapsed, maxCatchupBlocks)`; intra-block calls are
  no-ops (`MWOracleGuard.sol:48-69`). A single-block spot push barely moves the reference.
- **Valuation uses `min(spot, oracle)`.** `MWTreasuryPositionLib._recoverable` marks the whole
  position at the lower of spot and oracle value (`MWTreasuryPositionLib.sol:171-178`) — a flash pump
  of spot is ignored (oracle is lower); a genuine drop is respected (spot is lower). This is the RHS
  of the vault's solvency invariant `deployedFromSenior <= recoverableUSDC() + juniorUsdcBuffer`, and
  the oracle tick is read from the JIT hook and *passed in*, not re-derived from manipulable spot
  (`:44-47`, `MintwareTreasuryVault.sol:769-770`).
- **Unwind swaps are band-limited.** Both the position lib's seniority swap and the JIT sweep clamp
  `sqrtPriceLimitX96` to `oracle ± SWEEP_BAND_TICKS` (500 ticks ≈ 5%), clamped to the executable side
  of spot so they never revert (`MWTreasuryPositionLib.sol:234-247`,
  `MintwareTreasuryJitHook.sol:654-666`). A sandwich that moved spot cannot force the unwind to
  realize at the manipulated price — worst case it converts ≈nothing and leaves claims for a later
  sweep.
- **Deviation-priced fee + circuit breaker.** `beforeSwap` prices swaps by deviation from the oracle
  and trips `PriceDeviationTooHigh` at the extreme (`MWHookCoordinator.sol:274-276`,
  `MWOracleGuard.sol:37-43`). No trader identity / `tx.origin` is read, so single- and multi-address
  attackers are treated identically.

The JIT path itself reads **no** price to size the borrow — the output budget derives only from
`|amountSpecified|` (`MWHookCoordinator.sol:305-312`), removing a price input entirely from the hot
path.

### 5. Reentrancy — PASS

The layering matches the ToB guidance precisely:

- **`unlockCallback` is deliberately NOT `nonReentrant`** but is pool-manager-only. The vault
  documents why (`MintwareTreasuryVault.sol:44-53`): a senior redemption legitimately re-enters
  mid-`nonReentrant` (`redeemSenior → _pullUSDC → _recoverFromLP → poolManager.unlock → unlockCallback`),
  so a `nonReentrant` there would revert every redemption. Guarded by `_onlyPoolManager()` only.
- **All money paths ARE `nonReentrant`.** `depositSenior`/`redeemSenior`/`redeemJunior`/
  `settleSpend`/`recoverFromLP`/`accrueFees`/`fundRent`/`borrowIdleForJit`/`settleJitReturn` all
  carry `nonReentrant` (`MintwareTreasuryVault.sol:337,361,471,495,520,543,578,586,638,674,701`).
  `borrowIdleForJit` additionally enforces a single outstanding JIT slice (`jitBorrowed != 0 ⇒
  return 0`, `:679`) and a per-block cap (`:680-684`).
- **Delegatecall target is stateless.** `unlockCallback` delegatecalls only `MWTreasuryPositionLib`,
  which owns no storage (`MWTreasuryPositionLib.sol:19-48`) — under delegatecall `address(this)` and
  storage resolve as the vault, but the library adds no reentrancy surface of its own. The JIT hook
  uses no delegatecall at all (grep-confirmed 0 matches).
- **Self-swap auto-skip.** The JIT sweep's team→USDC swap is `msg.sender == self`, which v4 auto-skips
  for the hook's own callbacks, so no reentrancy guard is needed there
  (`MintwareTreasuryJitHook.sol:543`).

`MWHookCoordinator` holds no ReentrancyGuard (grep-confirmed) and correctly needs none: it never
opens an unlock, moves funds only via the zero-net am-AMM skim inside the PoolManager's own unlock,
and its JIT bridge calls (`jitOpen`/`jitClose`) are wrapped in `try/catch` best-effort
(`:310`, `:434`) so a re-entrant or reverting vault cannot brick the swap.

### 6. Return values / selectors / hookData — PASS

- Every callback returns the correct `IHooks.*.selector` and, where required, a
  `BeforeSwapDelta`/`uint24` fee override — e.g. `beforeSwap` returns
  `(IHooks.beforeSwap.selector, bsd, feeOverride)` (`MWHookCoordinator.sol:314`) and the fee override
  is tagged `| LPFeeLibrary.OVERRIDE_FEE_FLAG` only when dynamic fee is enabled (`:296`).
- `hookData` (the trailing `bytes calldata`) is **unused** in every callback of both hooks — it is
  never decoded and never treated as authority.
- Swap params are used only for legitimate sizing (fee basis, JIT output budget), never as a trust
  signal for moving third-party funds. The skim path rejects the ambiguous case:
  **exact-output reverts** unless explicitly allow-listed per pool
  (`ExactOutputNotSupported`, `MWHookCoordinator.sol:366`; `MintwareTreasuryJitHook.sol:466`) because
  the manager-fee basis is only known for the specified amount — a silent exact-output pass-through
  would let traders dodge the fee.
- Fee overrides are always clamped (`≤ maxFeePips`, or the `FALLBACK_MAX_FEE_PIPS` 10% ceiling when a
  pool is misconfigured with `maxFeePips == 0`, `:75`, `:349`) so a config slip can't return a
  swap-bricking 100% fee.

### 7. Permission bits / address mining — PASS

Both hooks assert their declared permission set in the constructor and are deployed at a mined
address carrying exactly those bits:

- `MWHookCoordinator` — `HOOK_FLAGS = 0xAC8` (`:68`); constructor calls
  `Hooks.validateHookPermissions(...)` with `beforeAddLiquidity + beforeRemoveLiquidity + beforeSwap
  + afterSwap + beforeSwapReturnDelta` true (`:148-166`). Deploy scripts mine `0xAC8` via
  `HookMiner.find` (`script/DeployPairVault.s.sol:79-80`, `DeployMatchedVault.s.sol:60-61`).
- `MintwareTreasuryJitHook` — declared `0x20C8` = `beforeInitialize + beforeSwap + afterSwap +
  beforeSwapReturnDelta`; constructor `Hooks.validateHookPermissions(...)` matches
  (`:237-248`). Deploy/soak scripts mine `0x20C8` (`script/DeployTreasuryV2.s.sol:49,100`;
  `CreateTreasuryVault.s.sol:33,78`; `SoakAmAmm*.s.sol`) and the test harness mines it too
  (`test/payments/MintwareTreasuryJitHook.t.sol:85`).

`validateHookPermissions` reverts at construction if the address bits don't match the declared
struct, so a bit mismatch cannot ship.

---

## Residual items (carry to the external audit)

1. **R1 — Coordinator pool binding is implicit, not explicit.** `MWHookCoordinator` is Cork-safe only
   because every value-moving action is a default-OFF per-pool opt-in and the LP gate is
   sender-checked on any pool; unlike the JIT hook it does not *explicitly reject* a foreign
   `PoolKey`. This is robust today but relies on the "all features default-off" invariant holding for
   every future callback added. Consider an explicit allow-list check if the coordinator ever grows a
   default-on behavior.

2. **R2 — Native-ETH settle unsupported (the "native-ETH sweep revert" already found).** The three
   duplicated `_pay` helpers (`MintwareTreasuryJitHook.sol:686`, `MWTreasuryPositionLib.sol:271`,
   `MWJitLib.sol:267`) assume ERC-20 and revert on `Currency == address(0)`. Scoped out by the
   USDC/ERC-20-only pool construction, but should be made explicit (`require` non-native, or add a
   `settle{value:...}` branch) and de-duplicated into one helper.

3. **R3 — Circuit breaker is a safe-revert, not graceful.** At extreme deviation `beforeSwap` reverts
   `PriceDeviationTooHigh` (`MWHookCoordinator.sol:274-276`), halting swaps until the permissionless
   `pokeOracle` heal path (`:458-465`) lets the truncated oracle catch up over a few blocks. This is
   the documented, deliberate resolution of the circuit-breaker-deadlock (a reverting `beforeSwap`
   would otherwise brick the pool forever), but it is still a **swap-DoS window** by design — ToB
   pattern 6 ("non-essential code blocking user exits"). Note the JIT hook takes the softer route
   (its guards no-op rather than revert). Confirm the operational band + poke cadence with the
   auditor; `maxDeviationTicks == 0` disables the breaker if the DoS window is unacceptable for a
   given pool.

4. **R4 — Keeper liveness dependency.** JIT settlement conservation relies on someone eventually
   calling the permissionless `sweepJit()` (`MintwareTreasuryJitHook.sol:509`). Value is never lost
   if the keeper stalls (the vault holds `jitBorrowed` at par and senior NAV is untouched), but claims
   accrue until swept. Worth an explicit liveness/monitoring note in the ops runbook.

5. **R5 — MEV-tax is soft / Base-only.** The `mevTaxPips` lever leans on Base's sequencer honoring
   priority ordering (`MintwareTreasuryJitHook.sol:149-152`) — not a cryptographic guarantee, and it
   does not hold under L1 builder auctions. The code already documents it as bonus revenue, never
   solvency; keep it that way and off by default.

---

## Bottom line

**6 of 7 ToB hook-vulnerability patterns are cleanly handled in code, with pattern 3 (delta /
settlement conservation) rated PARTIAL** — the conservation *mechanisms* (zero-net am-AMM skim,
JIT mint-claim + keeper sweep, balance-diff vault accounting) are correct, but the settlement layer
is silently ERC-20-only (native-ETH `_pay` revert) and the project has already found two bugs in this
exact class, so the surface is live and deserves the auditor's closest attention. There are **no
FAILs**. Residuals R1–R5 are hardening/limitation notes, not open holes in the deployed testnet
configuration.

This document is a **self-review intended to lower external-audit cost** by pre-mapping the ToB
pattern set to concrete file:line evidence and known limitations. It does not replace an external
audit, and nothing here should be represented as audited.
