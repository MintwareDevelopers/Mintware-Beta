# Aderyn Static-Analysis Sweep — `contracts-v4/src/` (Round 3)

**Tool:** Aderyn v0.6.8 (Cyfrin, Rust) · **Date:** 2026-09-08 · **solc:** 0.8.26 · **EVM:** prague
**Scope:** all 44 `.sol` files under `contracts-v4/src/` (7,978 nSLOC) — the first time Aderyn has
compiled this tree at all. Includes `src/vaults/MintwareIdleYieldAdapter.sol`, which had **zero
prior static-analysis coverage of any kind** (it exists only on `feat/lp-gateway-idle-yield-adapter`).

---

## Summary

Aderyn previously could not run here at all: invoked from `contracts-v4/`, it never sees the
repo-root `foundry.toml` (there is no `contracts-v4/foundry.toml`), so it falls back to
auto-detecting remappings from the git-submodule `lib/*/remappings.txt` files — which define
`@uniswap/v4-core/` and `@openzeppelin/` but **never** `@uniswap/v4-periphery/`, killing the run on
the first gateway import. The fix is a **tooling-only** `contracts-v4/remappings.txt` carrying
Forge's own resolved remapping set rewritten relative to `contracts-v4/`; no `.sol` file and no
Foundry config was touched, and `forge remappings` from the repo root is byte-identical before and
after. With that in place Aderyn ingests **44/44 files, 0 compilation errors**, runs 88 detectors
and reports **532 instances across 22 detector classes (88 High-severity, 444 Low-severity)**.
Triaged, that collapses to **zero exploitable findings**: the four High detectors are all
false positives or already-mitigated by design (the 66 "reentrancy" hits are Aderyn's
pattern-only detector firing on functions that already carry `nonReentrant`, and its 42
"unchecked return" hits are almost entirely internal-helper calls plus three `adapter.withdraw`
best-effort sites where the code already re-reads the balance instead of trusting the return
value — the strictly safer pattern). The Low bucket is dominated by 155 `onlyOwner`
"centralization" hits, a known and documented accepted risk. The one genuinely **new** item this
sweep surfaces is on the brand-new `MintwareIdleYieldAdapter`, and Aderyn did *not* find it — it
came out of reading the contract Aderyn finally made reachable: **the LP-Gateway deposit rail is
the only `IYieldAdapter` consumer that ignores that interface's own "SHOULD check
`maxSuppliable()`" contract**, so the new adapter's `depositCap` (which **defaults to 0 = closed**)
reverts user deposits with a custom error the gateway does not model, and the cap is cheaply
**griefable by direct token donation**. Both are availability/UX issues, not fund-loss — the
failure mode is fail-closed — but they are real and worth fixing before the adapter carries value.

---

## 1. The remapping fix

### 1.1 Diagnosis

`forge remappings` run from `contracts-v4/` resolves the import correctly:

```
@uniswap/v4-core/=contracts-v4/lib/v4-core/
@uniswap/v4-periphery/=contracts-v4/lib/v4-periphery/          ← the line that matters
@openzeppelin/contracts/=contracts-v4/lib/openzeppelin-contracts/contracts/
@pyth-network/pyth-sdk-solidity/=contracts-v4/lib/pyth-sdk-solidity/
forge-std/=contracts-v4/lib/forge-std/src/
```

Those five come from an **explicit `remappings = [...]` array in the repo-root `foundry.toml`**
(`/foundry.toml`, which also sets `src = "contracts-v4/src"`, `libs = ["contracts-v4/lib"]`). Note
the right-hand sides are **repo-root-relative** (`contracts-v4/lib/...`). There is no
`contracts-v4/foundry.toml` and no `contracts-v4/remappings.txt`.

Aderyn, invoked as `aderyn .` from inside `contracts-v4/`, treats `contracts-v4/` as the project
root and **does not walk up to the parent `foundry.toml`**. It therefore auto-detects remappings
purely from the submodules' own files:

| Source | Provides |
|---|---|
| `lib/v4-periphery/remappings.txt` | `@uniswap/v4-core/`, `ds-test/`, `forge-std/`, `openzeppelin-contracts/`, `solmate/` |
| `lib/v4-core/remappings.txt` | `@ensdomains/`, `@openzeppelin/`, `ds-test/`, `forge-std/`, `hardhat/`, `solmate/` |
| `lib/openzeppelin-contracts/remappings.txt` | `erc4626-tests/` |

**No submodule defines `@uniswap/v4-periphery/`** — only the root `foundry.toml` does. Hence:

```
Compilation Error: Error (6275): Source "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol"
  not found: File not found. Searched the following locations: "".
 --> src/gateway/MintwareLpGatewayFactory.sol:8:1
```

Two further silent divergences existed in the auto-detected set that would have made any Aderyn
run analyse *different code than Forge compiles*, even had the run not aborted:

- `@uniswap/v4-core/` auto-resolved to `lib/v4-periphery/lib/v4-core/` (periphery's nested copy)
  instead of Forge's top-level `lib/v4-core/`.
- `@openzeppelin/contracts/` was absent; only the coarser `@openzeppelin/ = lib/v4-core/lib/openzeppelin-contracts/`
  (a *different* OZ checkout) existed. `@pyth-network/` was absent entirely.

The fix therefore had to reproduce Forge's **full** resolved set, not just add one line.

### 1.2 The fix applied

**One new file, `contracts-v4/remappings.txt`** (34 lines) — the *only* thing created or modified
under `contracts-v4/`. It is Forge's own resolved output with the `contracts-v4/` path prefix
stripped, i.e. rebased from repo-root-relative to `contracts-v4`-relative, generated by:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts-v4 && forge remappings | sed 's|contracts-v4/||g' > remappings.txt
```

Full contents of the added file:

```diff
--- /dev/null
+++ b/contracts-v4/remappings.txt
@@ -0,0 +1,34 @@
+@uniswap/v4-core/=lib/v4-core/
+@uniswap/v4-periphery/=lib/v4-periphery/
+@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
+@pyth-network/pyth-sdk-solidity/=lib/pyth-sdk-solidity/
+forge-std/=lib/forge-std/src/
+lib/v4-periphery/lib/permit2/lib/forge-gas-snapshot/lib/forge-std/:ds-test/=lib/v4-periphery/lib/permit2/lib/forge-gas-snapshot/lib/forge-std/lib/ds-test/src/
+lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/lib/forge-std/:ds-test/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/lib/forge-std/lib/ds-test/src/
+lib/v4-core/lib/openzeppelin-contracts/lib/forge-std/:ds-test/=lib/v4-core/lib/openzeppelin-contracts/lib/forge-std/lib/ds-test/src/
+lib/v4-periphery/lib/permit2/lib/forge-std/:ds-test/=lib/v4-periphery/lib/permit2/lib/forge-std/lib/ds-test/src/
+lib/v4-periphery/lib/permit2/lib/solmate/:ds-test/=lib/v4-periphery/lib/permit2/lib/solmate/lib/ds-test/src/
+lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/:erc4626-tests/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/lib/erc4626-tests/
+lib/v4-periphery/lib/v4-core/lib/solmate/:ds-test/=lib/v4-periphery/lib/v4-core/lib/solmate/lib/ds-test/src/
+lib/v4-core/lib/openzeppelin-contracts/:erc4626-tests/=lib/v4-core/lib/openzeppelin-contracts/lib/erc4626-tests/
+lib/v4-core/lib/solmate/:ds-test/=lib/v4-core/lib/solmate/lib/ds-test/src/
+lib/v4-periphery/lib/permit2/:solmate/=lib/v4-periphery/lib/permit2/lib/solmate/
+lib/v4-periphery/lib/permit2/:openzeppelin-contracts/=lib/v4-periphery/lib/permit2/lib/openzeppelin-contracts/
+lib/v4-periphery/lib/v4-core/:solmate/=lib/v4-periphery/lib/v4-core/lib/solmate/
+lib/v4-periphery/lib/v4-core/:openzeppelin-contracts/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/
+lib/openzeppelin-contracts/:erc4626-tests/=lib/openzeppelin-contracts/lib/erc4626-tests/
+lib/v4-core/:solmate/=lib/v4-core/lib/solmate/
+lib/v4-core/:openzeppelin-contracts/=lib/v4-core/lib/openzeppelin-contracts/
+lib/v4-periphery/:v4-core/=lib/v4-periphery/lib/v4-core/src/
+@ensdomains/=lib/v4-core/node_modules/@ensdomains/
+@openzeppelin/=lib/v4-core/lib/openzeppelin-contracts/
+ds-test/=lib/v4-core/lib/forge-std/lib/ds-test/src/
+erc4626-tests/=lib/openzeppelin-contracts/lib/erc4626-tests/
+forge-gas-snapshot/=lib/v4-periphery/lib/permit2/lib/forge-gas-snapshot/src/
+halmos-cheatcodes/=lib/openzeppelin-contracts/lib/halmos-cheatcodes/src/
+hardhat/=lib/v4-core/node_modules/hardhat/
+openzeppelin-contracts/=lib/openzeppelin-contracts/
+permit2/=lib/v4-periphery/lib/permit2/
+solmate/=lib/v4-core/lib/solmate/
+v4-core/=lib/v4-core/src/
+v4-periphery/=lib/v4-periphery/
```

The context-scoped entries (`<context>:<prefix>=<target>`) are preserved verbatim — they are what
keeps each nested submodule resolving `ds-test/`, `solmate/`, `openzeppelin-contracts/` against
*its own* checkout, exactly as Forge does. Dropping them would let Aderyn analyse a different
dependency graph than the one that ships.

**Alternatives considered and rejected:**

- `aderyn --help` exposes no `--remappings` / `--remappings-file` flag (only `-s/--src`,
  `-i/--path-includes`, `-x/--path-excludes`, `-o/--output`, `--highs-only`).
- `aderyn init` writes an `aderyn.toml` for *scan customisation* (include/exclude/detector
  selection), not for import resolution — it would not have fixed this.
- Running `aderyn .` from the **repo root** also resolves correctly (the root `foundry.toml` is
  then in scope), but it drags the whole Next.js/TypeScript tree into the root walk and loses the
  natural `cd contracts-v4 && aderyn .` ergonomics. `remappings.txt` makes *both* invocations work.

### 1.3 Forge regression check

`remappings.txt` inside `contracts-v4/` is **inert for Foundry**: Foundry reads `remappings.txt`
from the *project* root (the repo root, where `foundry.toml` lives) and from directories listed in
`libs` (`contracts-v4/lib`) — `contracts-v4/` itself is neither.

**Verified by A/B:** `forge remappings` was captured from the repo root with the new file present,
then with it temporarily moved aside, then restored — the two outputs are **byte-identical**
(`diff -q` clean). Since remappings are the *entire* mechanism by which this file could influence
Foundry, and Foundry's resolved set is provably unchanged, the compilation inputs to `forge build`
are unchanged by construction. (A full `forge build` was also started as a belt-and-braces check
but was cut short by the session harness before finishing — `via_ir` on this tree takes >20 min;
that is a truncated run, not a failure, and the A/B above is the stronger guarantee anyway.)

### 1.4 Result

```
Ingesting 44 compiled files [solc : v0.8.26]
Running 88 detectors
```

Exit code 0; the emitted report contains **zero** `Compilation Error` / `ParserError` lines, and
44 ingested files == 44 `.sol` files under `src/` (verified by `find src -name '*.sol' | wc -l`),
i.e. **full-tree coverage, `MintwareIdleYieldAdapter.sol` included**.

**Reproduce:**

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts-v4 && aderyn . -o ../docs/developers/audits/round3/aderyn-report.md
```

---

## 2. Findings overview

| Sev | ID | Detector | Instances | Verdict |
|---|---|---|---:|---|
| High | H-1 | `abi.encodePacked()` hash collision | 2 | **False positive** |
| High | H-2 | Reentrancy: state change after external call | 66 | **False positive** (guarded) |
| High | H-3 | Contract name reused in different files | 6 | **False positive** (Foundry) |
| High | H-4 | Unsafe casting of integers | 14 | **FP / defence-in-depth nit** |
| Low | L-1 | Centralization risk | 155 | Known + accepted |
| Low | L-2 | Costly operation inside loop | 4 | Informational |
| Low | L-3 | Empty block | 1 | **False positive** (deliberate override) |
| Low | L-4 | Internal function used only once | 3 | Style |
| Low | L-5 | Large numeric literal | 38 | Style |
| Low | L-6 | Literal instead of constant | 32 | Style |
| Low | L-7 | Local variable shadows state variable | 3 | Style (1 worth renaming) |
| Low | L-8 | Modifier invoked only once | 5 | Style |
| Low | L-9 | `nonReentrant` is not the first modifier | 41 | **False positive** |
| Low | L-10 | PUSH0 opcode | 44 | **False positive** (Base/RH support PUSH0) |
| Low | L-11 | Loop contains `require`/`revert` | 2 | Informational |
| Low | L-12 | State change without event | 21 | Mixed — 2 worth adding |
| Low | L-13 | Address state var set without zero-check | 11 | Mostly deliberate |
| Low | L-14 | State variable could be immutable | 1 | **False positive** |
| Low | L-15 | Unchecked return | 42 | **False positive / already stricter** |
| Low | L-16 | Unsafe ERC20 operation | 2 | **False positive** (Permit2, not ERC20) |
| Low | L-17 | Unspecific solidity pragma | 33 | Accepted (`^0.8.26`, pinned in config) |
| Low | L-18 | Public function not used internally | 6 | Style |
| | | **Total** | **532** | **0 exploitable** |

Real-vs-false-positive tally: **0 real exploitable**, **~496 clear false positives / accepted
design**, **~36 style-or-informational**, plus **2 genuine non-Aderyn findings** raised in §4 from
reading `MintwareIdleYieldAdapter.sol`.

**No fixes were applied to `contracts-v4/src/` — this document proposes them only.**

---

## 3. Triage by detector

### H-1 · `abi.encodePacked()` hash collision — 2 instances — FALSE POSITIVE

- `src/lib/HookMiner.sol:67` — `keccak256(abi.encodePacked(creationCode, constructorArgs))`.
  This is the **canonical CREATE2 initcode hash**; `abi.encode` here would produce a hash that
  does not match what the EVM computes, breaking hook-address mining. Both operands are `bytes`
  and the concatenation *is* the semantic intent. Required by spec, not a bug.
- `src/payments/MintwareTreasuryDeployers.sol:73` — same CREATE2 initcode-hash pattern.

Collision risk requires ≥2 *variable-length* fields whose boundary is ambiguous; here the result is
fed to CREATE2 as a literal initcode digest, where any re-encoding is simply wrong. **No action.**

### H-2 · Reentrancy: state change after external call — 66 instances — FALSE POSITIVE

Aderyn's detector is purely syntactic ("a state write appears after an external call in the same
function") and does **not** model `ReentrancyGuard`. Distribution: `MintwareTreasuryVault` 16,
`MintwareLpGatewayPositionManager` 14, `MintwareStagedLiquidityRouter` 12, `MintwareTreasuryJitHook`
12, `MintwareTreasuryFloatSettlement` 12, and 10 or fewer each across 9 other files.

Every flagged entry point checked carries `nonReentrant`:

| Entry point | Modifiers |
|---|---|
| `MintwareLpGatewayPositionManager.deposit` / `depositWithMin` | `nonReentrant` |
| `MintwareLpGatewayPositionManager.withdraw` | `nonReentrant` |
| `MintwareLpGatewayPositionManager.deploy` | `onlyOwner nonReentrant` |
| `MintwareLpGatewayPositionManager.harvest` / `compoundQuote` | `onlyOwner nonReentrant` |
| `MintwareLpGatewayStaging.stage` / `unstage` | `onlyController nonReentrant` |
| `MintwareIdleYieldAdapter.deposit` / `withdraw` | `onlyVault nonReentrant` |

The PM's 14 hits all sit inside `deploy()` (lines 665–712: `staging.unstage`, `balanceOf`,
`positionManager.nextTokenId()` preceding `deployedPrincipal += quoteUsed` and `tokenId = newId`).
`deploy` is `onlyOwner nonReentrant`; the external callees are the curated staging reserve, the
official v4 PositionManager periphery, and ERC-20 `balanceOf`. Additionally the accounting is
**measured, not assumed** — `quoteUsed` is derived from a before/after balance delta (lines
695–714), so even a hypothetically reentrant callee could not inflate the cost basis.

`MintwareLpGatewayPositionManager.poke()` is the one permissionless function without
`nonReentrant`; it only calls `_anchorFollow()`, which is bounded by
`if (block.number <= _refBlock) return;` — **at most one follow-step per block regardless of call
count**, so repeated `poke()` in a block cannot walk the reference. Confirmed at
`MintwareLpGatewayPositionManager.sol:342`. **No action.**

### H-3 · Contract name reused in different files — 6 instances — FALSE POSITIVE

Three duplicate *interface* declarations: `IOracleTickSource` (`MintwareEthSettlement`,
`MintwareTreasuryFloatSettlement`), `IMWWeightedDistributor` (`MintwareDeFiPairVault`,
`MintwareMatchedLiquidityVault`), `IMWWeightedDistributorFees` (`MWFeeLib`, `MWIdleLib`).

The detector's stated risk is artifact overwriting **in Truffle**. Foundry namespaces artifacts by
source path (`out/<File>.sol/<Name>.json`) and this project is Foundry-only (Hardhat was removed
with the shelved campaign stack). Optional hygiene: hoist each into a shared
`src/interfaces/*.sol` so the declarations cannot drift apart — a maintainability improvement, not
a security fix. **No security action.**

### H-4 · Unsafe casting of integers — 14 instances — FALSE POSITIVE / defence-in-depth

The two in scope for this review are `MintwareLpGatewayPositionManager.sol:700` and `:703`:

```solidity
_modify(_mintCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
_modify(_increaseCalls(liquidity, uint128(amount0), uint128(amount1)), deadline);
```

`amount0` / `amount1` are the v4 `MINT_POSITION` / `INCREASE_LIQUIDITY` **`amountMax` slippage
bounds**, not transfer amounts. Truncation of a `uint256 > type(uint128).max` yields a *smaller*
bound, which makes the periphery call **revert** on slippage — it can never authorise spending
more. The direction of failure is safe. And the magnitudes are unreachable in practice:
`amount0`/`amount1` derive from `quoteGot` (bounded by the staging reserve, USDG 6dp) and
`pairedAmount` (pulled from the owner in the same tx); `> 3.4e38` base units is not a state the
gateway can reach. `liquidity` is already `uint128` from
`LiquidityAmounts.getLiquidityForAmounts`.

**Proposed (non-blocking, defence-in-depth):** use OZ `SafeCast.toUint128(...)` at both sites so the
failure is an explicit `SafeCastOverflowedUintDowncast` rather than an opaque periphery slippage
revert. Cosmetic; no exploit path.

The other 12 (`MWDynamicFee:80`, `MWOracleGuard:67`, `MintwareTreasuryJitHook:300–302`,
`MintwareTreasuryVault:461–462`) are all downcasts of values already range-checked by a preceding
timelocked risk-parameter validator (`_validateRiskParam`) or by a `bps <= 10_000` bound. Same
verdict.

### L-1 · Centralization risk — 155 instances — KNOWN + ACCEPTED

Every `onlyOwner` / `onlyController` / role-gated function in the tree. This is the single largest
contributor to the raw count and carries no new information: owner-seat risk is already the
headline residual in the round-2 / real-funds audits and is mitigated structurally —
`Ownable2Step` everywhere, `renounceOwnership` disabled, a **dedicated Privy `gateway` signer seat**
(`0x18AE…663c`) distinct from the shared `root` seat (`0x7fD8…7E06`) with per-seat authorization
keys, `setPaused` that blocks deposits but **never** withdraw, an immutable `harvestRecipient` with
a two-step rotation, and an on-chain `MAX_DEPLOY_BPS` cost-basis cap the owner cannot raise.
**No action.**

### L-9 · `nonReentrant` is not the first modifier — 41 instances — FALSE POSITIVE

The pattern is only exploitable when a modifier *preceding* `nonReentrant` makes an external call
(so reentry happens before the lock is taken). Every preceding modifier in this codebase is a pure
storage read with no external call: `onlyOwner` (OZ `Ownable`), `onlyController`, `onlyVault`,
`onlyJitHook`, `onlyCoordinator`, `whenNotPaused` (`MWGuardianPausable`). Includes
`MintwareLpGatewayPositionManager` `deploy`/`harvest`/`compoundQuote`,
`MintwareLpGatewayStaging` `stage`/`unstage`, and `MintwareIdleYieldAdapter` `deposit`/`withdraw`.
**No action** (reordering to `nonReentrant onlyOwner` is a valid style preference, zero security
delta here).

### L-10 · PUSH0 opcode — 44 instances — FALSE POSITIVE

Fires once per file because `pragma ^0.8.26` emits PUSH0 (Shanghai+). Target chains — Base (8453),
Base Sepolia (84532), Robinhood Chain (46630/RH mainnet), Arc (5042002) — are all Shanghai-or-later
and support PUSH0. Relevant only if a pre-Shanghai chain is ever targeted. **No action; note as a
deploy-time chain-compatibility checklist item.**

### L-15 · Unchecked return — 42 instances — FALSE POSITIVE / already stricter

Breaks down into three groups, none of them a gap:

1. **Internal helper calls whose return value is genuinely unused** (~25): `_sweepFees(deadline)`,
   `_syncIdle()`, `_realizeFees()`, `_poke(id)`, `_flushProtocol()`, `_recoverFromLP(fairLp)`,
   `_grantRole(...)`. Detector noise.
2. **v4 PoolManager calls whose return is irrelevant** (~13): `poolManager.unlock("")` (returns
   `bytes`, the work happens in `unlockCallback`), `poolManager.settle()` (returns the amount
   paid; the delta accounting is the actual invariant and is asserted by the callback),
   `poolManager.initialize(...)` (returns the tick).
3. **`adapter.withdraw(...)` best-effort sites** (3) — the only ones with real substance, and all
   three are **already handled more strictly than checking the return value would be**:

   | Site | Handling |
   |---|---|
   | `MintwareLpGatewayStaging.sol:72` | Round-3 X-3, explicit: `before = balanceOf(this)` → `adapter.withdraw(amount)` → `returned = balanceOf(this) - before`. The comment states why the return value is deliberately ignored — a source over-reporting by 1 wei would brick every withdraw; one under-reporting would strand the difference outside `stagedAssets` and outside NAV, unsweepable. |
   | `MintwareTreasuryVault.sol:1248, :1289` | Re-reads `_freeSeniorBuffer()` after the call; `_pullSeniorForDeploy` then reverts `InsufficientIdleLiquidity` if the buffer is still short. |
   | `MintwareYieldVault.sol:241` | Re-reads `usdc.balanceOf(address(this))` and reverts `InsufficientIdleLiquidity` if still short. |

   Measuring the delta is the correct pattern against an adapter whose return value is untrusted.
   **No action** — "fixing" these by trusting the return would be a regression.

   Also in this bucket: `MintwareERC4626YieldAdapter.sol:111` (`yieldSource.deposit` shares
   ignored — NAV is read via `previewRedeem`, never via a cached share count, so correct) and
   `Mintwarev3ToV4Migrator.sol:206` (`npm.decreaseLiquidity` amounts ignored — a `collect` follows
   and takes the actual balances).

### L-16 · Unsafe ERC20 operation — 2 instances — FALSE POSITIVE

`MintwareLpGatewayPositionManager.sol:868` and `:874` flag `permit2.approve(...)`. `permit2` is
`IAllowanceTransfer`, **not** an ERC-20: its `approve(token, spender, amount, expiration)` is a
4-argument void function with no return value to check, and `SafeERC20` is not applicable to it.
Actual ERC-20 movement in this contract correctly uses `SafeERC20` / `forceApprove` throughout.
Note also that line 874 (`approve(..., 0, 0)`) is the finding L-04 residual-allowance revocation —
i.e. this file is already *more* careful about allowances than the baseline. **No action.**

### L-12 · State change without event — 21 instances — MIXED

Mostly hot-path internal accounting where an event per write would be prohibitive
(`MintwareDeFiPairVault` ×7, `MWHookCoordinator` ×5). Two worth emitting for off-chain
observability, both outside the gateway:

- `MintwareTreasuryJitHook.sol:262` — `setJitSkipSender(address s)` mutates a
  **trust-relevant** address with neither an event nor a zero-check (also L-13). Off-chain
  monitoring cannot observe a rotation. **Proposed:** add `event JitSkipSenderSet(address)`.
- `MintwareTreasuryDeployers.sol:28, :114` — deployer bookkeeping; an event would help indexers
  reconcile factory output.

### L-13 · Address state variable set without checks — 11 instances — MOSTLY DELIBERATE

Eight are constructor assignments explicitly commented `// zero allowed` (`AaveV3YieldAdapter:89`,
`MintwareERC4626YieldAdapter:80`, `MintwareIdleYieldAdapter:73`) — the documented deploy
chicken-and-egg, resolved by a **one-time** `setVault` that *does* zero-check. Safe: while `vault`
is zero, `onlyVault` rejects everything, so no value can enter or leave.

The one worth tightening is `MintwareTreasuryJitHook.sol:262` (`setJitSkipSender`) — a live setter
with no zero-check and no event (see L-12). **Proposed:** add a zero-check + event, or document
that zero is a meaningful "disabled" value.

### L-2 / L-11 · Loop cost & `revert` in loop — 4 / 2 instances — INFORMATIONAL

All in `MintwareMultiVenueYieldAdapter` (lines 151, 173, 198, 222) — the venue fan-out. Venue count
is owner-curated and small; the withdraw path (`:222`) is explicitly best-effort-never-revert.
`:151` / `:198` reverting inside a loop is intended (`setVenues` validation must be atomic).

### L-3 / L-4 / L-5 / L-6 / L-7 / L-8 / L-14 / L-17 / L-18 — STYLE / FALSE POSITIVE

- **L-3** `MintwareTreasuryFloatSettlement.sol:451` — empty `_validateRiskParam` override. A
  deliberate "no extra constraints for this contract" hook implementation, not dead code.
- **L-7** `MintwareLpGatewayFactory.sol:30` — a struct field named `positionManager` shadowing the
  state variable. Cosmetic; worth renaming to `pm` for readability since the factory reads both.
  `AaveV3YieldAdapter:74` (`_owner` param) and `MintwareDeFiPairVault:75` (`shares`) are the same
  class.
- **L-14** `MintwareTreasuryVault.sol:167` `address public team` — flagged as
  immutable-eligible, but the contract's own rotation path writes it. Aderyn missed the writer.
  **False positive; do not apply.**
- **L-17** `pragma ^0.8.26` on 33 files — the compiler version is pinned in `foundry.toml`
  (`solc = "0.8.26"`), so builds are deterministic. Pinning the pragma too is a defensible
  pre-mainnet hygiene step; not a finding.
- **L-5 / L-6 / L-4 / L-8 / L-18** — pure style, no action.

---

## 4. `MintwareLpGatewayPositionManager.sol` — focused review

580 nSLOC, round-3 hardened. Aderyn's ruleset produced **no finding on this contract that
Slither/the manual rounds had not already addressed**, and the round-3 defences hold up under its
different lens:

| Aderyn signal | Round-3 defence that already covers it | Verdict |
|---|---|---|
| H-2 reentrancy ×14 (all in `deploy`) | `onlyOwner nonReentrant`; `quoteUsed` from a before/after **balance delta**, never a callee-reported number | FP |
| H-4 unsafe cast ×2 (`:700`, `:703`) | Casts are v4 `amountMax` slippage bounds — truncation shrinks the bound and reverts; magnitudes unreachable | FP (SafeCast = optional hardening) |
| L-9 `nonReentrant` not first ×3 | Preceding modifiers (`onlyOwner`) make no external call | FP |
| L-15 unchecked return ×4 (`_sweepFees`, `_syncIdle`) | Internal helpers; return unused by design | FP |
| L-16 unsafe ERC20 ×2 | `permit2.approve` is `IAllowanceTransfer`, not ERC-20 | FP |
| L-1 centralization | Dedicated `gateway` Privy seat, `Ownable2Step`, renounce disabled, `MAX_DEPLOY_BPS` cost-basis cap the owner cannot lift, `setPaused` never blocks withdraw | Accepted |

Two things Aderyn cannot see that were re-verified by reading:

- **`poke()` (line 632) is permissionless and has no `nonReentrant`** — safe, because
  `_anchorFollow()` (line 342) returns early on `block.number <= _refBlock`. One bounded
  follow-step per block regardless of how many times it is called, so the clamped-follower
  reference cannot be walked within a block.
- **`_deposit` (line 431)** carries a per-sender `SameBlockAction` guard, a strict
  `_navDepositStrict()` (C-10) that reverts rather than mint against an unreadable source, and the
  `StageShortfall` check (XR-3) requiring the reserve to actually grow by ~the deposit — i.e. the
  Sonne/Hundred/Radiant class of empty-source share-inflation is closed at the *consumer* layer,
  not only the adapter layer.

**No new finding.**

---

## 5. `MintwareIdleYieldAdapter.sol` — focused review (first-ever static analysis)

70 nSLOC. **Aderyn High findings: 0.** Its only hits are the benign classes already dispatched
above:

| Aderyn ID | Line(s) | Verdict |
|---|---|---|
| L-1 centralization | 38, 82, 86, 96 | Accepted — `Ownable2Step`, renounce disabled, one-time `setVault`, owner holds only the cap lever |
| L-9 `nonReentrant` not first | 107, 118 | FP — `onlyVault` is a storage read |
| L-10 PUSH0 | 2 | FP — target chains support PUSH0 |
| L-13 address set without check | 73 | Deliberate (`// zero allowed`), and `setVault` zero-checks |
| L-17 unspecific pragma | 2 | Accepted |

The design holds up well against the class of bug that has hit the other adapters: with **no
external call in the hot path at all** (`deposit`/`withdraw` are plain `SafeERC20` transfers), there
is no yield-source solvency risk, no share-price manipulation surface and no revert-on-preview
(C-10) class. `withdraw` clamps to `min(amount, balanceOf(this))` so "best-effort" is honest,
`totalAssets`/`maxWithdrawable` read live balance (donation-inclusive, which only ever *helps*
NAV), and `setVault` is one-time so the withdraw sink cannot be repointed.

Two genuine findings, **neither caught by Aderyn** — both surfaced by reading the contract that the
remapping fix finally made reachable. Both are **availability/UX, not fund-loss**; the failure mode
is fail-closed in every case.

### IDLE-1 (Low) · `depositCap` is enforced but never pre-checked on the gateway rail

`IYieldAdapter.sol:13` states the caller *"MUST `approve` first, and **SHOULD check
`maxSuppliable()`**"*. Both YPN consumers honour it — `MintwareTreasuryVault.sol:1206` and
`MintwareYieldVault.sol:168` read `adapter.maxSuppliable()` before supplying. The **LP-Gateway rail
does not**: `MintwareLpGatewayPositionManager._deposit` → `staging.stage(quoteAmount)` →
`adapter.deposit(amount)` with no headroom read anywhere in the chain, and `maxSuppliable()` is
never called from `lib/gateway` either.

Until now this was latent — Aave and Morpho supply caps rarely bind. `MintwareIdleYieldAdapter`
changes that: `depositCap` is *designed* to bind (it is the on-chain bound for "accept a small
amount of real value while there is no external audit yet"), and it **starts at whatever the
deployer passes, with `0` meaning closed**. Consequences:

1. A deploy that forgets `setDepositCap` leaves the cap at 0 and **every user deposit reverts
   `DepositCapExceeded()`** — a custom error the PM, the staging contract and the frontend do not
   model, so it surfaces as an opaque failed transaction rather than "vault full".
2. During normal bounded rollout, the deposit that first crosses the cap reverts the *whole* user
   transaction rather than being rejected with a legible reason or partially filled.

The natspec asserts this is fine because "the same failure mode a capped real ERC-4626 source
already produces here (`ERC4626ExceededMaxDeposit`)" — accurate as far as it goes, but that path is
equally unhandled, and this is the first adapter where it is the *expected* steady state rather
than an edge case.

**Proposed (not applied):**
- Surface headroom: have `MintwareLpGatewayStaging` expose `maxStageable()` → `adapter.maxSuppliable()`
  (it already proxies `stagedAssets`/`maxUnstageable`), and have `MintwareLpGatewayPositionManager._deposit`
  check it and revert a **gateway-native** error (e.g. `DepositCapReached()`) before pulling funds.
- Map `DepositCapExceeded` / `ERC4626ExceededMaxDeposit` in the gateway ABI + `/earn/[pool]` client
  so the UI can say "vault at capacity" instead of showing an unexplained revert.
- Add a deploy-script assertion that `depositCap != 0` after standing the adapter up (fail-closed
  is correct; silently-closed is the ops hazard).

### IDLE-2 (Low / griefing) · `depositCap` measured against live balance is donation-griefable

`deposit` (line 109-110) checks `balanceOf(address(this)) + amount > depositCap` against the
**current on-chain balance**, which includes any direct token transfer. The natspec correctly
argues a donation cannot *bypass* the cap. The unexamined direction is the reverse: **anyone can
send the underlying directly to the adapter to consume the remaining headroom**, driving
`maxSuppliable()` to 0 and blocking all further deposits until the owner raises `depositCap`.

Cost to the attacker is the donated amount, which becomes NAV for existing holders (a gift, not a
protocol loss) — so this is not economically rational as an attack, but it *is* cheap enough to be
a nuisance during a deliberately small-cap bounded rollout, which is exactly the scenario this
adapter exists for. The lower the cap, the cheaper the grief: a $10k pilot cap costs $10k to
freeze.

**Proposed (not applied):** track supplied principal in a `uint256 totalSupplied` incremented in
`deposit` and decremented in `withdraw`, and enforce the cap against **that** rather than
`balanceOf`. Donations then still accrue to NAV (`totalAssets` keeps reading live balance, which is
the desired behaviour) but can no longer consume deposit headroom. `maxSuppliable()` would return
`depositCap - totalSupplied`. Note this is a deliberate divergence from the current one-liner and
would want its own unit test (donate → assert headroom unchanged → deposit still succeeds).

### IDLE-3 (Informational) · `renounceOwnership` revert is masked for non-owners

`renounceOwnership() public view override onlyOwner { revert RenounceDisabled(); }` (line 82) —
a non-owner caller gets OZ's `OwnableUnauthorizedAccount`, not `RenounceDisabled`. Identical to the
established pattern at `MintwareLpGatewayPositionManager.sol:266`; consistent, harmless, noted only
for completeness.

### Confirmed-correct (no action)

- `deposit` pulls via `safeTransferFrom(vault, ...)` rather than `msg.sender` — equivalent under
  `onlyVault`, and matches `MintwareLpGatewayStaging.stage`'s `forceApprove(adapter, amount)`.
- `withdraw` early-returns `0` without emitting when nothing is available — correct, and satisfies
  the `IYieldAdapter` "never reverts for a liquidity reason" contract trivially.
- `asset` is `immutable`; `setVault` is one-time and zero-checked; `setDepositCap` emits.
- Lowering `depositCap` below the current balance blocks new deposits but never forces a
  withdrawal — existing depositors are untouched, as documented.

---

## 6. Recommended follow-ups (none applied here)

| Pri | Item | Where |
|---|---|---|
| Med | **IDLE-1** — check `maxSuppliable()` on the gateway deposit rail; gateway-native error; deploy assertion that `depositCap != 0` | `MintwareLpGatewayStaging`, `MintwareLpGatewayPositionManager._deposit`, deploy script, `/earn/[pool]` client |
| Med | **IDLE-2** — enforce the cap against tracked supplied principal, not live balance | `MintwareIdleYieldAdapter.deposit` / `maxSuppliable` |
| Low | `setJitSkipSender` — add zero-check + event (L-12/L-13) | `MintwareTreasuryJitHook.sol:262` |
| Low | `SafeCast.toUint128` at the two v4 `amountMax` cast sites (H-4, defence-in-depth) | `MintwareLpGatewayPositionManager.sol:700, :703` |
| Info | Hoist the 3 duplicated interfaces into `src/interfaces/` (H-3, maintainability) | `IOracleTickSource`, `IMWWeightedDistributor(Fees)` |
| Info | Rename the `positionManager` struct field shadowing the state var (L-7) | `MintwareLpGatewayFactory.sol:30` |
| Info | Pin `pragma solidity 0.8.26` pre-mainnet (L-17) | tree-wide |
| Info | PUSH0 support is a deploy-time chain check (L-10) | deploy checklist |

## 7. Provenance & repo hygiene

- Only file added anywhere under `contracts-v4/`: **`contracts-v4/remappings.txt`** (§1.2). No
  `.sol` file was read-modified, no Foundry config changed, no fix applied to `contracts-v4/src/`.
- No commits, no pushes, no branch switch. This sweep ran on the working tree as found, on branch
  `feat/lp-gateway-idle-yield-adapter` (which is where `MintwareIdleYieldAdapter.sol` lives — no
  temporary checkout or `git show` copy was needed).
- Aderyn's own report artifact was written to a scratch path, not committed; regenerate with the
  command in §1.4.
